// Descargo de mercancía: traslados entre locales (en dos pasos) y bajas de piezas.
//
// TRASLADO: el local de origen DESPACHA (las piezas quedan EN_TRANSITO: ya no cuentan en su stock y no se pueden vender en ningún
// local) y el local de destino RECIBE escaneando cada pieza (pasa a DISPONIBLE en el destino, con el mismo código: la etiqueta
// sirve). Lo que no llega se devuelve al origen al cerrar el traslado.
// BAJA: una pieza dañada, usada o en garantía sale del stock del local y queda BAJA.
//
// Todo va en UN db.batch (todo o nada). El stock lo mueven los triggers de los movimientos TRASLADO_SALIDA / TRASLADO_ENTRADA / BAJA
// (no cuentan como venta ni compra en los reportes). Los cambios de estado de las piezas están protegidos por el trigger
// trg_unidad_transicion: si dos operaciones chocan por la misma pieza, la segunda aborta y no cambia nada.
import { localVigente } from '../../lib/constantes-locales';
import { cargarLocales } from '../repos/locales';
import { alcanceDe, esGerencia, esGlobal, localAccesible, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { ahoraISO, nuevoId, sentenciaContador } from '../util';
import { marcas, tramos } from './movimientos';
import { MOTIVOS_BAJA, type EstadoTraslado, type MotivoBaja, type Traslado, type TrasladoUnidad } from '../../types/database.types';

const MAX_UNIDADES = 500;
const MAX_NOTA = 300;
const MSG_NO_DISPONIBLE =
  'Alguna de las piezas ya no está disponible en este local (se vendió, ya va en un traslado, está dada de baja o es de otro local).';

const sinPermiso = (texto: string) => new ErrorApi(403, texto, 'sin_permiso');

/** Rol de gerencia y suscripción vigente (un local suspendido o sin vigencia da 403 antes de revelar nada). */
async function exigirGerencia(env: Entorno, sesion: Sesion): Promise<void> {
  if (!esGerencia(sesion.rol)) throw sinPermiso('Tu rol no puede mover mercancía entre locales ni dar de baja piezas.');
  await alcanceDe(env, sesion);
}

function validarCodigos(codigos: string[]): void {
  if (codigos.length === 0) throw new ErrorApi(400, 'Escanea al menos una pieza.', 'datos_invalidos');
  if (codigos.length > MAX_UNIDADES) throw new ErrorApi(400, `Son demasiadas piezas para una sola operación (máximo ${MAX_UNIDADES}).`, 'lote_grande');
  if (new Set(codigos).size !== codigos.length) throw new ErrorApi(400, 'Hay piezas repetidas en la lista.', 'datos_invalidos');
}

function limpiarNota(nota: string | undefined | null): string | null {
  const limpia = (nota ?? '').trim();
  if (limpia.length > MAX_NOTA) throw new ErrorApi(400, `La nota admite hasta ${MAX_NOTA} caracteres.`, 'datos_invalidos');
  return limpia || null;
}

interface FilaUnidad {
  codigo: string;
  estado: string;
  producto_id: string;
  local_id: string;
  producto_nombre: string;
}

/** Las piezas con ese código (con el nombre de su producto), sin importar de quién sean: quien llama valida estado y local. */
async function leerUnidades(env: Entorno, codigos: string[]): Promise<Map<string, FilaUnidad>> {
  const mapa = new Map<string, FilaUnidad>();
  for (const tramo of tramos(codigos)) {
    const filas = await env.DB
      .prepare(
        `SELECT u.codigo, u.estado, u.producto_id, u.local_id, p.nombre AS producto_nombre
         FROM unidades_producto u JOIN productos p ON p.id = u.producto_id
         WHERE u.codigo IN (${marcas(tramo.length)})`
      )
      .bind(...tramo)
      .all<FilaUnidad>();
    for (const f of filas.results) mapa.set(f.codigo, f);
  }
  return mapa;
}

/** Agrupa piezas por (producto, local) para registrar UN movimiento por grupo. */
function agrupar(filas: { producto_id: string; local_id: string; codigo: string }[]): { producto_id: string; local_id: string; codigos: string[] }[] {
  const grupos = new Map<string, { producto_id: string; local_id: string; codigos: string[] }>();
  for (const f of filas) {
    const k = `${f.producto_id}|${f.local_id}`;
    const g = grupos.get(k) ?? { producto_id: f.producto_id, local_id: f.local_id, codigos: [] };
    g.codigos.push(f.codigo);
    grupos.set(k, g);
  }
  return [...grupos.values()];
}

function sentenciaMovimiento(db: D1Database, ahora: string, tipo: string, productoId: string, localId: string, motivo: string, codigos: string[]): D1PreparedStatement {
  return db
    .prepare('INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, fecha, motivo, local_id, unidad_codigos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(nuevoId(), productoId, tipo, codigos.length, ahora, motivo, localId, JSON.stringify(codigos));
}

/** Corre el lote y traduce los avisos de los triggers a errores claros. */
async function ejecutar(env: Entorno, sentencias: D1PreparedStatement[]): Promise<void> {
  try {
    await env.DB.batch(sentencias);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : '';
    if (/ya no está disponible|cambió de estado|no está vendida o no pertenece/.test(mensaje)) throw new ErrorApi(409, MSG_NO_DISPONIBLE, 'unidad_no_disponible');
    if (/Stock insuficiente/.test(mensaje)) throw new ErrorApi(409, 'Stock insuficiente en este local para esa operación.', 'stock_insuficiente');
    throw err;
  }
}

const folioTexto = (folio: number) => `#${String(folio).padStart(4, '0')}`;
const SQL_FOLIO = "'Traslado #' || printf('%04d', (SELECT valor FROM contadores WHERE nombre = 'traslados'))";

// --- Lectura ----------------------------------------------------------------------------------------------------------
interface FilaTraslado extends Omit<Traslado, 'unidades'> {
  origen_nombre: string | null;
  destino_nombre: string | null;
}

async function leerTraslados(env: Entorno, condicion: string, valores: unknown[], limite = 200): Promise<Traslado[]> {
  const filas = await env.DB
    .prepare(
      `SELECT t.*, lo.nombre AS origen_nombre, ld.nombre AS destino_nombre
       FROM traslados t
       LEFT JOIN locales lo ON lo.id = t.origen_local_id
       LEFT JOIN locales ld ON ld.id = t.destino_local_id
       WHERE ${condicion}
       ORDER BY t.folio DESC
       LIMIT ?`
    )
    .bind(...valores, limite)
    .all<FilaTraslado>();
  const unidades = new Map<string, TrasladoUnidad[]>();
  for (const tramo of tramos(filas.results.map((f) => f.id))) {
    const u = await env.DB
      .prepare(`SELECT traslado_id, codigo, producto_id, producto_nombre, recibida_en, devuelta_en FROM traslado_unidades WHERE traslado_id IN (${marcas(tramo.length)}) ORDER BY rowid`)
      .bind(...tramo)
      .all<TrasladoUnidad & { traslado_id: string }>();
    for (const { traslado_id, ...resto } of u.results) (unidades.get(traslado_id) ?? unidades.set(traslado_id, []).get(traslado_id)!).push(resto);
  }
  return filas.results.map((f) => ({ ...f, unidades: unidades.get(f.id) ?? [] }));
}

/** Locales a los que se puede mandar mercancía: todos los que tienen la suscripción vigente (un encargado solo ve el suyo en el resto de la app). */
export async function listarDestinos(env: Entorno, sesion: Sesion): Promise<{ id: string; nombre: string; tipo: string; sede: string | null }[]> {
  await exigirGerencia(env, sesion);
  return (await cargarLocales(env)).filter(localVigente).map((l) => ({ id: l.id, nombre: l.nombre, tipo: l.tipo, sede: l.sede ?? null }));
}

/** Los traslados donde el local del usuario es origen o destino (administrador y gerente: todos), del más reciente al más antiguo. */
export async function listarTraslados(env: Entorno, sesion: Sesion, filtro: { estado?: EstadoTraslado } = {}): Promise<Traslado[]> {
  await exigirGerencia(env, sesion);
  const alcance = await alcanceDe(env, sesion);
  const condiciones: string[] = [];
  const valores: unknown[] = [];
  if (alcance.tipo === 'locales') {
    condiciones.push(`(t.origen_local_id IN (${marcas(alcance.ids.length)}) OR t.destino_local_id IN (${marcas(alcance.ids.length)}))`);
    valores.push(...alcance.ids, ...alcance.ids);
  }
  if (filtro.estado) {
    condiciones.push('t.estado = ?');
    valores.push(filtro.estado);
  }
  return leerTraslados(env, condiciones.length ? condiciones.join(' AND ') : '1 = 1', valores);
}

async function cargarTraslado(env: Entorno, id: string): Promise<Traslado> {
  const [t] = await leerTraslados(env, 't.id = ?', [id], 1);
  if (!t) throw new ErrorApi(404, 'Ese traslado no existe.', 'no_existe');
  return t;
}

// --- Despachar --------------------------------------------------------------------------------------------------------
export interface DatosDespacho {
  origenLocalId: string;
  destinoLocalId: string;
  codigos: string[];
  notas?: string;
}

/** El local de origen despacha: las piezas quedan EN_TRANSITO y su stock sale del origen. */
export async function despacharTraslado(env: Entorno, sesion: Sesion, datos: DatosDespacho): Promise<Traslado> {
  await exigirGerencia(env, sesion);
  validarCodigos(datos.codigos);
  const notas = limpiarNota(datos.notas);
  if (datos.origenLocalId === datos.destinoLocalId) throw new ErrorApi(400, 'El local de destino debe ser distinto al de origen.', 'datos_invalidos');
  if (!(await localAccesible(env, sesion, datos.origenLocalId))) throw sinPermiso('Solo puedes despachar mercancía desde tu propio local.');
  const destino = await env.DB.prepare('SELECT id, nombre FROM locales WHERE id = ?').bind(datos.destinoLocalId).first<{ id: string; nombre: string }>();
  if (!destino) throw new ErrorApi(404, 'El local de destino no existe.', 'no_existe');

  const unidades = await leerUnidades(env, datos.codigos);
  for (const codigo of datos.codigos) {
    const u = unidades.get(codigo);
    if (!u || u.estado !== 'DISPONIBLE' || u.local_id !== datos.origenLocalId) throw new ErrorApi(409, MSG_NO_DISPONIBLE, 'unidad_no_disponible');
  }

  const id = nuevoId();
  const ahora = ahoraISO();
  const sentencias: D1PreparedStatement[] = [
    sentenciaContador(env.DB, 'traslados'),
    env.DB
      .prepare(
        `INSERT INTO traslados (id, folio, origen_local_id, destino_local_id, estado, creado_en, enviado_por, notas)
         VALUES (?, (SELECT valor FROM contadores WHERE nombre = 'traslados'), ?, ?, 'EN_TRANSITO', ?, ?, ?)`
      )
      .bind(id, datos.origenLocalId, datos.destinoLocalId, ahora, sesion.nombre, notas),
  ];
  for (const codigo of datos.codigos) {
    const u = unidades.get(codigo)!;
    sentencias.push(
      env.DB.prepare('INSERT INTO traslado_unidades (traslado_id, codigo, producto_id, producto_nombre) VALUES (?, ?, ?, ?)').bind(id, codigo, u.producto_id, u.producto_nombre)
    );
  }
  for (const g of agrupar([...unidades.values()].filter((u) => datos.codigos.includes(u.codigo)))) {
    sentencias.push(
      env.DB
        .prepare(
          `INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, fecha, motivo, local_id, unidad_codigos)
           VALUES (?, ?, 'TRASLADO_SALIDA', ?, ?, ${SQL_FOLIO} || ' → ' || ?, ?, ?)`
        )
        .bind(nuevoId(), g.producto_id, g.codigos.length, ahora, destino.nombre, g.local_id, JSON.stringify(g.codigos))
    );
  }
  // Sin filtro por estado a propósito: si otra operación ya se llevó la pieza, el trigger aborta TODO el lote
  for (const codigo of datos.codigos) sentencias.push(env.DB.prepare("UPDATE unidades_producto SET estado = 'EN_TRANSITO' WHERE codigo = ?").bind(codigo));
  sentencias.push(
    ...sentenciasCambio(env.DB, ['movimientos_inventario', 'inventario_local', 'unidades_producto', 'traslados'], datos.origenLocalId),
    ...sentenciasCambio(env.DB, ['traslados'], datos.destinoLocalId),
    ...sentenciasCambio(env.DB, ['productos'], null)
  );
  await ejecutar(env, sentencias);
  return cargarTraslado(env, id);
}

// --- Recibir ----------------------------------------------------------------------------------------------------------
/** El local de destino recibe (todas o parte de) las piezas escaneadas: pasan a DISPONIBLES en el destino. */
export async function recibirTraslado(env: Entorno, sesion: Sesion, trasladoId: string, codigos: string[]): Promise<Traslado> {
  await exigirGerencia(env, sesion);
  validarCodigos(codigos);
  const t = await cargarTraslado(env, trasladoId);
  if (!(await localAccesible(env, sesion, t.destino_local_id))) throw sinPermiso('Solo el local de destino puede recibir este traslado.');
  if (t.estado !== 'EN_TRANSITO') throw new ErrorApi(409, `El traslado ${folioTexto(t.folio)} ya está cerrado.`, 'traslado_cerrado');

  const delTraslado = new Map(t.unidades.map((u) => [u.codigo, u]));
  for (const codigo of codigos) {
    const u = delTraslado.get(codigo);
    if (!u) throw new ErrorApi(400, `La pieza ${codigo} no es de este traslado.`, 'datos_invalidos');
    if (u.recibida_en) throw new ErrorApi(409, `La pieza ${codigo} ya se recibió.`, 'ya_recibida');
    if (u.devuelta_en) throw new ErrorApi(409, `La pieza ${codigo} ya se devolvió al origen.`, 'traslado_cerrado');
  }

  const ahora = ahoraISO();
  const faltan = t.unidades.filter((u) => !u.recibida_en && !u.devuelta_en).length - codigos.length;
  const sentencias: D1PreparedStatement[] = [];
  for (const codigo of codigos) {
    sentencias.push(
      env.DB.prepare("UPDATE unidades_producto SET estado = 'DISPONIBLE', local_id = ? WHERE codigo = ?").bind(t.destino_local_id, codigo),
      env.DB.prepare('UPDATE traslado_unidades SET recibida_en = ? WHERE traslado_id = ? AND codigo = ?').bind(ahora, t.id, codigo)
    );
  }
  for (const g of agrupar(codigos.map((c) => ({ ...delTraslado.get(c)!, local_id: t.destino_local_id })))) {
    sentencias.push(
      sentenciaMovimiento(env.DB, ahora, 'TRASLADO_ENTRADA', g.producto_id, t.destino_local_id, `Traslado ${folioTexto(t.folio)} desde ${t.origen_nombre ?? 'otro local'}`, g.codigos)
    );
  }
  sentencias.push(
    faltan === 0
      ? env.DB.prepare("UPDATE traslados SET estado = 'RECIBIDO', recibido_en = ?, recibido_por = ?, cerrado_en = ? WHERE id = ?").bind(ahora, sesion.nombre, ahora, t.id)
      : env.DB.prepare('UPDATE traslados SET recibido_en = ?, recibido_por = ? WHERE id = ?').bind(ahora, sesion.nombre, t.id),
    ...sentenciasCambio(env.DB, ['movimientos_inventario', 'inventario_local', 'unidades_producto', 'traslados'], t.destino_local_id),
    ...sentenciasCambio(env.DB, ['unidades_producto', 'traslados'], t.origen_local_id),
    ...sentenciasCambio(env.DB, ['productos'], null)
  );
  await ejecutar(env, sentencias);
  return cargarTraslado(env, t.id);
}

// --- Cerrar (devolver lo que no llegó) --------------------------------------------------------------------------------
/**
 * Cierra el traslado: lo que no se recibió vuelve al local de origen (DISPONIBLE otra vez). Queda RECIBIDO si llegó algo, ANULADO si no
 * llegó nada. Lo puede hacer quien tenga acceso al origen o al destino.
 */
export async function cerrarTraslado(env: Entorno, sesion: Sesion, trasladoId: string): Promise<Traslado> {
  await exigirGerencia(env, sesion);
  const t = await cargarTraslado(env, trasladoId);
  if (!(await localAccesible(env, sesion, t.origen_local_id)) && !(await localAccesible(env, sesion, t.destino_local_id))) {
    throw sinPermiso('Solo el local de origen o el de destino pueden cerrar este traslado.');
  }
  if (t.estado !== 'EN_TRANSITO') throw new ErrorApi(409, `El traslado ${folioTexto(t.folio)} ya está cerrado.`, 'traslado_cerrado');

  const pendientes = t.unidades.filter((u) => !u.recibida_en && !u.devuelta_en);
  const recibidas = t.unidades.filter((u) => u.recibida_en).length;
  const ahora = ahoraISO();
  const sentencias: D1PreparedStatement[] = [];
  for (const u of pendientes) {
    sentencias.push(
      env.DB.prepare("UPDATE unidades_producto SET estado = 'DISPONIBLE' WHERE codigo = ?").bind(u.codigo),
      env.DB.prepare('UPDATE traslado_unidades SET devuelta_en = ? WHERE traslado_id = ? AND codigo = ?').bind(ahora, t.id, u.codigo)
    );
  }
  for (const g of agrupar(pendientes.map((u) => ({ ...u, local_id: t.origen_local_id })))) {
    sentencias.push(
      sentenciaMovimiento(env.DB, ahora, 'TRASLADO_ENTRADA', g.producto_id, t.origen_local_id, `Traslado ${folioTexto(t.folio)}: no llegó, se devolvió al origen`, g.codigos)
    );
  }
  sentencias.push(
    env.DB.prepare('UPDATE traslados SET estado = ?, cerrado_en = ? WHERE id = ?').bind(recibidas > 0 ? 'RECIBIDO' : 'ANULADO', ahora, t.id),
    ...sentenciasCambio(env.DB, ['movimientos_inventario', 'inventario_local', 'unidades_producto', 'traslados'], t.origen_local_id),
    ...sentenciasCambio(env.DB, ['traslados'], t.destino_local_id),
    ...sentenciasCambio(env.DB, ['productos'], null)
  );
  await ejecutar(env, sentencias);
  return cargarTraslado(env, t.id);
}

// --- Bajas ------------------------------------------------------------------------------------------------------------
export interface DatosBaja {
  localId: string;
  codigos: string[];
  motivo: MotivoBaja;
  nota?: string;
}

/** Retira piezas DISPONIBLES del local: salen del stock y quedan en BAJA con su motivo. */
export async function darDeBaja(env: Entorno, sesion: Sesion, datos: DatosBaja): Promise<{ codigos: string[] }> {
  await exigirGerencia(env, sesion);
  const motivo = MOTIVOS_BAJA.find((m) => m.id === datos.motivo);
  if (!motivo) throw new ErrorApi(400, 'Elige un motivo de baja válido: dañada, usada o en garantía.', 'datos_invalidos');
  validarCodigos(datos.codigos);
  const nota = limpiarNota(datos.nota);
  if (!(await localAccesible(env, sesion, datos.localId))) throw sinPermiso('Solo puedes dar de baja piezas de tu propio local.');

  const unidades = await leerUnidades(env, datos.codigos);
  for (const codigo of datos.codigos) {
    const u = unidades.get(codigo);
    if (!u || u.estado !== 'DISPONIBLE' || u.local_id !== datos.localId) throw new ErrorApi(409, MSG_NO_DISPONIBLE, 'unidad_no_disponible');
  }

  const ahora = ahoraISO();
  const texto = `Baja (${motivo.nombre})${nota ? `: ${nota}` : ''}`;
  const sentencias: D1PreparedStatement[] = [];
  for (const g of agrupar([...unidades.values()])) sentencias.push(sentenciaMovimiento(env.DB, ahora, 'BAJA', g.producto_id, g.local_id, texto, g.codigos));
  // Sin filtro por estado a propósito: si otra operación ya se llevó la pieza, el trigger aborta TODO el lote
  for (const codigo of datos.codigos) {
    sentencias.push(
      env.DB
        .prepare("UPDATE unidades_producto SET estado = 'BAJA', baja_motivo = ?, baja_nota = ?, baja_en = ?, baja_por = ? WHERE codigo = ?")
        .bind(motivo.id, nota, ahora, sesion.nombre, codigo)
    );
  }
  sentencias.push(...sentenciasCambio(env.DB, ['movimientos_inventario', 'inventario_local', 'unidades_producto'], datos.localId), ...sentenciasCambio(env.DB, ['productos'], null));
  await ejecutar(env, sentencias);
  return { codigos: datos.codigos };
}

/** Devuelve al stock piezas dadas de baja (por si se escanearon por error). Solo administrador y gerente. */
export async function revertirBaja(env: Entorno, sesion: Sesion, codigos: string[]): Promise<number> {
  if (!esGlobal(sesion.rol)) throw sinPermiso('Solo el administrador o el gerente pueden revertir una baja.');
  await alcanceDe(env, sesion);
  validarCodigos(codigos);
  const unidades = await leerUnidades(env, codigos);
  for (const codigo of codigos) {
    if (unidades.get(codigo)?.estado !== 'BAJA') throw new ErrorApi(409, `La pieza ${codigo} no está dada de baja.`, 'unidad_no_disponible');
  }
  const ahora = ahoraISO();
  const sentencias: D1PreparedStatement[] = [];
  for (const g of agrupar([...unidades.values()])) sentencias.push(sentenciaMovimiento(env.DB, ahora, 'ENTRADA', g.producto_id, g.local_id, 'Reversión de baja', g.codigos));
  for (const codigo of codigos) {
    sentencias.push(
      env.DB.prepare("UPDATE unidades_producto SET estado = 'DISPONIBLE', baja_motivo = NULL, baja_nota = NULL, baja_en = NULL, baja_por = NULL WHERE codigo = ?").bind(codigo)
    );
  }
  for (const localId of new Set([...unidades.values()].map((u) => u.local_id))) {
    sentencias.push(...sentenciasCambio(env.DB, ['movimientos_inventario', 'inventario_local', 'unidades_producto'], localId));
  }
  sentencias.push(...sentenciasCambio(env.DB, ['productos'], null));
  await ejecutar(env, sentencias);
  return codigos.length;
}
