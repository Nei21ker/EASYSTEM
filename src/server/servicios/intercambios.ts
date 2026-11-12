// Cambio de mercancía con otro local (Local Vidrios, migración 0025): se entrega mercancía a cambio de otra (p. ej. 5 vidrios de un modelo
// por 5 de otro). Pueden hacerlo administrador, gerente y encargado del local; revertirlo, solo administrador y gerente.
//
// · Los movimientos de inventario se guardan como TRASLADO_SALIDA (lo que entregamos) y TRASLADO_ENTRADA (lo que recibimos) con el motivo
//   «Cambio #N con <contraparte>»: mueven el stock y las piezas pero NO cuentan como venta ni compra en los reportes ni en Inversión.
// · Las piezas con código se entregan por orden de llegada o las indicadas (escaneadas); las que se reciben nacen con código nuevo
//   (sin etiqueta impresa: se imprimen desde Ingreso). Los productos por cantidad solo mueven el número.
// · EN_ESPERA: solo uno de los dos lados se mueve al anotarlo (`lado_pendiente` = el que falta) y el otro se mueve al «Completar».
//   Ese cierre y la reversión toman primero el estado con un UPDATE protegido (nadie más lo repite) y revierten ese estado si el
//   movimiento falla (sin stock, piezas ya vendidas…).
import { alcanceDe, condicionAlcance, esGerencia, esGlobal, localAccesible, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { nuevoId, rangoDelDiaUTC, sentenciaContador } from '../util';
import { marcas, registrarMovimientos, type EntradaMovimiento } from './movimientos';
import { ladosMovidos, normalizarContraparte, normalizarLineasIntercambio, valorDeItems, type LineaIntercambio } from '../../utils/intercambio';
import type { EstadoIntercambio, Intercambio, IntercambioItem, NuevoIntercambio } from '../../types/database.types';

const ZONA_POR_DEFECTO = 'America/Caracas';
const ahora = () => new Date().toISOString();
const sinPermiso = (texto: string) => new ErrorApi(403, texto, 'sin_permiso');

interface FilaIntercambio extends Omit<Intercambio, 'salen' | 'entran'> {
  salen: string;
  entran: string;
}

const aIntercambio = (f: FilaIntercambio): Intercambio => ({ ...f, salen: JSON.parse(f.salen) as IntercambioItem[], entran: JSON.parse(f.entran) as IntercambioItem[] });
const folioTexto = (folio: number) => `#${String(folio).padStart(4, '0')}`;

async function exigirGerencia(env: Entorno, sesion: Sesion): Promise<void> {
  if (!esGerencia(sesion.rol)) throw sinPermiso('Solo el administrador, el gerente o el encargado hacen cambios de mercancía.');
  await alcanceDe(env, sesion); // un local suspendido da 403 antes de revelar nada
}

// --- Lectura ----------------------------------------------------------------------------------------------------------
export async function listarIntercambios(
  env: Entorno,
  sesion: Sesion,
  filtro: { desde?: string; hasta?: string; estado?: EstadoIntercambio; localId?: string } = {},
  limite = 500
): Promise<Intercambio[]> {
  if (!esGerencia(sesion.rol)) throw sinPermiso('Solo el administrador, el gerente o el encargado ven los cambios de mercancía.');
  const alcance = await alcanceDe(env, sesion, filtro.localId);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  const zona = env.ZONA_HORARIA ?? ZONA_POR_DEFECTO;
  try {
    if (filtro.desde) {
      condiciones.push('fecha >= ?');
      params.push(rangoDelDiaUTC(filtro.desde, zona).desde);
    }
    if (filtro.hasta) {
      condiciones.push('fecha < ?');
      params.push(rangoDelDiaUTC(filtro.hasta, zona).hasta);
    }
  } catch {
    throw new ErrorApi(400, 'Las fechas deben ser aaaa-mm-dd.', 'datos_invalidos');
  }
  if (filtro.estado) {
    condiciones.push('estado = ?');
    params.push(filtro.estado);
  }
  const filas = await env.DB
    .prepare(`SELECT * FROM intercambios WHERE ${condiciones.join(' AND ')} ORDER BY folio DESC LIMIT ?`)
    .bind(...params, Math.min(Math.max(1, Math.floor(limite)), 1000))
    .all<FilaIntercambio>();
  return filas.results.map(aIntercambio);
}

/** Un cambio del alcance del usuario; 404 si no existe o es de un local al que no llega. */
async function cargar(env: Entorno, sesion: Sesion, id: string): Promise<Intercambio> {
  const alcance = await alcanceDe(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const fila = await env.DB.prepare(`SELECT * FROM intercambios WHERE id = ? AND ${sql}`).bind(id, ...valores).first<FilaIntercambio>();
  if (!fila) throw new ErrorApi(404, 'Ese cambio no existe.', 'no_existe');
  return aIntercambio(fila);
}

// --- Armado de los lados ----------------------------------------------------------------------------------------------
interface FilaProducto {
  id: string;
  nombre: string;
  referencia: string | null;
  codigo_barras: string;
  precio_venta: number;
  control_por_cantidad: number;
}

async function armarItems(env: Entorno, lineas: LineaIntercambio[], lado: string): Promise<IntercambioItem[]> {
  const items: IntercambioItem[] = [];
  for (const l of lineas) {
    const p = await env.DB
      .prepare('SELECT id, nombre, referencia, codigo_barras, precio_venta, control_por_cantidad FROM productos WHERE id = ?')
      .bind(l.producto_id)
      .first<FilaProducto>();
    if (!p) throw new ErrorApi(400, `Uno de los productos que ${lado} ya no existe en el inventario.`, 'datos_invalidos');
    if (p.control_por_cantidad === 1 && l.unidades?.length) {
      throw new ErrorApi(400, `«${p.nombre}» se controla por cantidad: no lleva código por pieza.`, 'datos_invalidos');
    }
    items.push({
      producto_id: p.id,
      nombre: p.nombre,
      codigo: p.referencia ?? p.codigo_barras,
      cantidad: l.cantidad,
      precio_unitario: Math.round(p.precio_venta * 100) / 100,
      unidades: l.unidades?.length ? l.unidades : null,
    });
  }
  return items;
}

function normalizar(lineas: NuevoIntercambio['salen'] | NuevoIntercambio['entran'], lado: string): LineaIntercambio[] {
  try {
    return normalizarLineasIntercambio(lineas as LineaIntercambio[], lado);
  } catch (err) {
    throw new ErrorApi(400, err instanceof Error ? err.message : 'La lista de productos no es válida.', 'datos_invalidos');
  }
}

const entradasDe = (items: IntercambioItem[], tipo: 'CAMBIO_SALIDA' | 'CAMBIO_ENTRADA', localId: string, motivo?: string): EntradaMovimiento[] =>
  items.map((i) => ({ productoId: i.producto_id, tipo, cantidad: i.cantidad, localId, motivo, unidadCodigos: i.unidades?.length ? i.unidades : undefined }));

/** Guarda en cada item las piezas que de verdad se movieron (las que se eligieron solas, o las nuevas que nacieron al recibir). */
function conPiezas(items: IntercambioItem[], codigos: string[][]): IntercambioItem[] {
  return items.map((i, n) => ({ ...i, unidades: codigos[n]?.length ? codigos[n] : null }));
}

const SQL_FOLIO = "(SELECT valor FROM contadores WHERE nombre = 'intercambios')";

// --- Anotar -----------------------------------------------------------------------------------------------------------
export async function crearIntercambio(env: Entorno, sesion: Sesion, datos: NuevoIntercambio): Promise<Intercambio> {
  await exigirGerencia(env, sesion);
  if (!(await localAccesible(env, sesion, datos.localId))) throw sinPermiso('No tienes acceso a ese local.');
  const local = await env.DB.prepare('SELECT tipo FROM locales WHERE id = ?').bind(datos.localId).first<{ tipo: string }>();
  if (!local) throw new ErrorApi(404, 'El local no existe.', 'no_existe');
  if (local.tipo !== 'vidrios') throw new ErrorApi(400, 'Por ahora los cambios de mercancía solo se hacen en el Local Vidrios.', 'solo_vidrios');

  const contraparte = normalizarContraparte(datos.contraparte);
  if (!contraparte) throw new ErrorApi(400, 'Escribe con quién se hace el cambio (de 2 a 80 caracteres).', 'datos_invalidos');
  const nota = (datos.nota ?? '').trim();
  if (nota.length > 300) throw new ErrorApi(400, 'La nota admite hasta 300 caracteres.', 'datos_invalidos');
  const pendiente = datos.lado_pendiente ?? null;
  if (pendiente !== null && pendiente !== 'SALEN' && pendiente !== 'ENTRAN') throw new ErrorApi(400, 'El lado pendiente no es válido.', 'datos_invalidos');

  const lineasSalen = normalizar(datos.salen, 'entregas');
  const lineasEntran = normalizar(datos.entran, 'recibes');
  if (lineasSalen.length === 0 || lineasEntran.length === 0) {
    throw new ErrorApi(400, 'Agrega al menos un producto en cada lado: lo que entregas y lo que recibes.', 'datos_invalidos');
  }
  if (lineasEntran.some((l) => l.unidades?.length)) throw new ErrorApi(400, 'Lo que se recibe nace con códigos nuevos: no se indican piezas.', 'datos_invalidos');

  const salen = await armarItems(env, lineasSalen, 'entregas');
  const entran = await armarItems(env, lineasEntran, 'recibes');
  const mueveSalen = pendiente !== 'SALEN';
  const mueveEntran = pendiente !== 'ENTRAN';
  const movimientos = [...(mueveSalen ? entradasDe(salen, 'CAMBIO_SALIDA', datos.localId) : []), ...(mueveEntran ? entradasDe(entran, 'CAMBIO_ENTRADA', datos.localId) : [])];

  const id = nuevoId();
  const fecha = ahora();
  let finalSalen = salen;
  let finalEntran = entran;
  await registrarMovimientos(env, sesion, movimientos, (resultados) => {
    const codigos = resultados.map((r) => r.unidadCodigos);
    finalSalen = mueveSalen ? conPiezas(salen, codigos.slice(0, salen.length)) : salen;
    finalEntran = mueveEntran ? conPiezas(entran, codigos.slice(mueveSalen ? salen.length : 0)) : entran;
    return [
      sentenciaContador(env.DB, 'intercambios'),
      env.DB
        .prepare(
          `INSERT INTO intercambios (id, folio, local_id, contraparte, nota, estado, lado_pendiente, salen, entran, valor_sale_usd, valor_entra_usd, creado_por, creado_por_nombre, fecha, completado_en, completado_por_nombre)
           VALUES (?, ${SQL_FOLIO}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id, datos.localId, contraparte, nota || null, pendiente ? 'EN_ESPERA' : 'COMPLETADO', pendiente,
          JSON.stringify(finalSalen), JSON.stringify(finalEntran), valorDeItems(salen), valorDeItems(entran),
          sesion.userId, sesion.nombre, fecha, pendiente ? null : fecha, pendiente ? null : sesion.nombre
        ),
      env.DB
        .prepare(`UPDATE movimientos_inventario SET motivo = 'Cambio #' || printf('%04d', ${SQL_FOLIO}) || ' con ' || ? WHERE id IN (${marcas(resultados.length)})`)
        .bind(contraparte, ...resultados.map((r) => r.movimiento.id)),
      ...sentenciasCambio(env.DB, ['intercambios'], datos.localId),
    ];
  });
  return cargar(env, sesion, id);
}

// --- Completar (cambio en espera) --------------------------------------------------------------------------------------
export async function completarIntercambio(env: Entorno, sesion: Sesion, id: string): Promise<Intercambio> {
  await exigirGerencia(env, sesion);
  const c = await cargar(env, sesion, id);
  if (!(await localAccesible(env, sesion, c.local_id))) throw sinPermiso('No tienes acceso a ese local.');
  if (c.estado !== 'EN_ESPERA' || !c.lado_pendiente) throw new ErrorApi(409, `El cambio ${folioTexto(c.folio)} no está en espera.`, 'intercambio_cerrado');

  const lado = c.lado_pendiente;
  const motivo = `Cambio ${folioTexto(c.folio)} con ${c.contraparte}`;
  const marca = ahora();
  const reclamo = await env.DB
    .prepare("UPDATE intercambios SET estado = 'COMPLETADO', lado_pendiente = NULL, completado_en = ?, completado_por_nombre = ? WHERE id = ? AND estado = 'EN_ESPERA'")
    .bind(marca, sesion.nombre, id)
    .run();
  if (!reclamo.meta.changes) throw new ErrorApi(409, 'Otra persona acaba de completar o cancelar este cambio.', 'intercambio_cerrado');

  try {
    await registrarMovimientos(
      env,
      sesion,
      lado === 'ENTRAN' ? entradasDe(c.entran, 'CAMBIO_ENTRADA', c.local_id, motivo) : entradasDe(c.salen, 'CAMBIO_SALIDA', c.local_id, motivo),
      (resultados) => {
        const codigos = resultados.map((r) => r.unidadCodigos);
        const columna = lado === 'ENTRAN' ? 'entran' : 'salen';
        const items = conPiezas(lado === 'ENTRAN' ? c.entran : c.salen, codigos);
        return [env.DB.prepare(`UPDATE intercambios SET ${columna} = ? WHERE id = ?`).bind(JSON.stringify(items), id), ...sentenciasCambio(env.DB, ['intercambios'], c.local_id)];
      }
    );
  } catch (err) {
    await env.DB
      .prepare("UPDATE intercambios SET estado = 'EN_ESPERA', lado_pendiente = ?, completado_en = NULL, completado_por_nombre = NULL WHERE id = ? AND estado = 'COMPLETADO'")
      .bind(lado, id)
      .run();
    await env.DB.batch(sentenciasCambio(env.DB, ['intercambios'], c.local_id));
    throw err;
  }
  return cargar(env, sesion, id);
}

// --- Revertir / cancelar ------------------------------------------------------------------------------------------------
/** Revierte lo que ya se movió (devuelve las piezas entregadas y saca las recibidas) y deja el cambio ANULADO. Solo administrador y gerente. */
export async function anularIntercambio(env: Entorno, sesion: Sesion, id: string, notaTexto?: string | null): Promise<Intercambio> {
  if (!esGlobal(sesion.rol)) throw sinPermiso('Solo el administrador o el gerente pueden revertir un cambio de mercancía.');
  await alcanceDe(env, sesion);
  const c = await cargar(env, sesion, id);
  const nota = (notaTexto ?? '').trim().replace(/\s+/g, ' ');
  if (nota.length > 300) throw new ErrorApi(400, 'La nota admite hasta 300 caracteres.', 'datos_invalidos');
  if (c.estado === 'ANULADO') throw new ErrorApi(409, `El cambio ${folioTexto(c.folio)} ya está anulado.`, 'intercambio_cerrado');

  const movidos = ladosMovidos(c.estado, c.lado_pendiente);
  const motivo = `Reversión del cambio ${folioTexto(c.folio)} con ${c.contraparte}`;
  const reclamo = await env.DB
    .prepare("UPDATE intercambios SET estado = 'ANULADO', anulado_en = ?, anulado_por_nombre = ?, nota_cierre = ? WHERE id = ? AND estado = ?")
    .bind(ahora(), sesion.nombre, nota || null, id, c.estado)
    .run();
  if (!reclamo.meta.changes) throw new ErrorApi(409, 'Otra persona acaba de cambiar este cambio. Recarga la lista.', 'intercambio_cerrado');

  try {
    await registrarMovimientos(env, sesion, [
      // Lo que entregamos vuelve al stock (las MISMAS piezas); lo que recibimos sale otra vez
      ...(movidos.salen ? entradasDe(c.salen, 'CAMBIO_ENTRADA', c.local_id, motivo) : []),
      ...(movidos.entran ? entradasDe(c.entran, 'CAMBIO_SALIDA', c.local_id, motivo) : []),
    ], () => sentenciasCambio(env.DB, ['intercambios'], c.local_id));
  } catch (err) {
    await env.DB
      .prepare("UPDATE intercambios SET estado = ?, lado_pendiente = ?, anulado_en = NULL, anulado_por_nombre = NULL, nota_cierre = NULL WHERE id = ? AND estado = 'ANULADO'")
      .bind(c.estado, c.lado_pendiente, id)
      .run();
    await env.DB.batch(sentenciasCambio(env.DB, ['intercambios'], c.local_id));
    if (err instanceof ErrorApi && err.status === 409) {
      throw new ErrorApi(409, 'No se puede revertir: parte de lo que se recibió ya no está en el local (se vendió o se movió) o falta stock. Anótalo con una nota en vez de revertirlo.', 'no_se_puede_revertir');
    }
    throw err;
  }
  return cargar(env, sesion, id);
}
