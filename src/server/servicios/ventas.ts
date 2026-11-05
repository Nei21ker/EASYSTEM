// Ventas y devoluciones. Reglas portadas de las políticas RLS 0011/0014/0016/0023:
//   · registrar una venta: cualquier rol con acceso al local (el vendedor queda como `vendedor_id` por su sesión);
//   · ver ventas: administrador, gerente y encargado las de sus locales; vendedor y técnico solo las suyas;
//   · registrar una devolución: administrador, gerente y encargado del local de la venta; nadie edita ni borra.
// El folio sale de la tabla `contadores` DENTRO del mismo lote que inserta la fila (no se repite ni con ventas simultáneas).
import { alcanceDe, condicionAlcance, esAdministrador, esGerencia, localAccesible, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { limiteSeguro, nuevoId, redondear2 } from '../util';
import { normalizarCedula, separarNombre } from './clientes';
import { marcas, registrarMovimientos, tramos, type EntradaMovimiento } from './movimientos';
import type { Devolucion, NuevaDevolucion, NuevaVenta, Venta } from '../../types/database.types';

const METODOS = ['BS_PAGO_MOVIL', 'BS_PUNTO_VENTA', 'BS_EFECTIVO', 'USD_EFECTIVO', 'BINANCE_USDT', 'MIXTO'];

const json = (valor: unknown) => (valor === null || valor === undefined ? null : JSON.stringify(valor));
const analizar = <T>(texto: unknown): T | null => (typeof texto === 'string' ? (JSON.parse(texto) as T) : null);

function aVenta(f: Record<string, unknown>): Venta {
  return {
    ...(f as unknown as Venta),
    items: analizar(f.items) ?? [],
    pagos: analizar(f.pagos),
    vuelto: analizar(f.vuelto),
    tasa_cambio: (f.tasa_cambio as number | null) ?? null,
    total_bs: (f.total_bs as number | null) ?? null,
    vendedor_id: (f.vendedor_id as string | null) ?? null,
    vendedor_nombre: (f.vendedor_nombre as string | null) ?? null,
  };
}

function aDevolucion(f: Record<string, unknown>): Devolucion {
  return {
    ...(f as unknown as Devolucion),
    items_devueltos: analizar(f.items_devueltos) ?? [],
    items_nuevos: analizar(f.items_nuevos) ?? [],
    pagos: analizar(f.pagos),
    vuelto: analizar(f.vuelto),
    reembolso: analizar(f.reembolso),
    tasa_cambio: (f.tasa_cambio as number | null) ?? null,
    registrado_nombre: (f.registrado_nombre as string | null) ?? null,
  };
}

/** La fecha que trae la venta (las hechas sin conexión conservan la suya); no se aceptan fechas del futuro. */
function fechaValida(fecha: string, mensaje: string): string {
  const t = Date.parse(fecha);
  if (!Number.isFinite(t) || t > Date.now() + 10 * 60_000) throw new ErrorApi(400, mensaje, 'datos_invalidos');
  return new Date(t).toISOString();
}

// --- Ventas ---------------------------------------------------------------------------------------------------
export async function guardarVenta(env: Entorno, sesion: Sesion, datos: NuevaVenta): Promise<Venta> {
  if (!(await localAccesible(env, sesion, datos.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');

  const cedula = normalizarCedula(datos.cliente_cedula ?? '');
  const nombre = (datos.cliente_nombre ?? '').trim().replace(/\s+/g, ' ');
  const telefono = datos.cliente_telefono?.trim() ?? '';
  if (cedula.length < 5 || cedula.length > 20 || nombre.length < 3 || nombre.length > 120 || telefono.length < 7 || telefono.length > 25) {
    throw new ErrorApi(400, 'Faltan datos del cliente (cédula, nombre y teléfono).', 'datos_invalidos');
  }
  if (!Array.isArray(datos.items) || datos.items.length === 0) throw new ErrorApi(400, 'El carrito está vacío.', 'datos_invalidos');
  if (!Number.isFinite(datos.total) || datos.total < 0) throw new ErrorApi(400, 'El total de la venta no es válido.', 'datos_invalidos');
  if (!METODOS.includes(datos.metodo_pago)) throw new ErrorApi(400, 'Tipo de cobro inválido.', 'datos_invalidos');
  const fecha = fechaValida(datos.fecha, 'La fecha de la venta no es válida.');

  const id = nuevoId();
  const db = env.DB;
  const separado = separarNombre(nombre, datos.cliente_apellido);
  const lote = await db.batch<{ valor: number }>([
    db.prepare("INSERT INTO contadores (nombre, valor) VALUES ('ventas', 1) ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1 RETURNING valor"),
    db
      .prepare(
        `INSERT INTO ventas (id, folio, fecha, local_id, cliente_cedula, cliente_nombre, cliente_telefono, metodo_pago, total, items, pagos, vuelto, tasa_cambio, total_bs, vendedor_id, vendedor_nombre)
         VALUES (?, (SELECT valor FROM contadores WHERE nombre = 'ventas'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, fecha, datos.local_id, cedula, nombre, telefono, datos.metodo_pago, redondear2(datos.total), JSON.stringify(datos.items),
        json(datos.pagos), json(datos.vuelto), datos.tasa_cambio ?? null, datos.total_bs ?? null, sesion.userId, sesion.nombre
      ),
    // El cliente queda recordado (o se actualizan sus datos) en el MISMO lote: si la venta falla, tampoco se guarda
    db
      .prepare(
        `INSERT INTO clientes (cedula, nombre, apellido, telefono, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (cedula) DO UPDATE SET nombre = excluded.nombre, apellido = excluded.apellido, telefono = excluded.telefono, updated_at = excluded.updated_at`
      )
      .bind(cedula, separado.nombre, separado.apellido, telefono, new Date().toISOString()),
    ...sentenciasCambio(db, ['ventas'], datos.local_id),
  ]);
  const folio = lote[0].results[0].valor;
  const fila = await db.prepare('SELECT * FROM ventas WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return { ...aVenta(fila!), folio };
}

export async function listarVentas(
  env: Entorno,
  sesion: Sesion,
  opciones: { desde?: string; hasta?: string; limite?: number; localId?: string }
): Promise<Venta[]> {
  const alcance = await alcanceDe(env, sesion, opciones.localId);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  // El vendedor y el técnico solo ven sus propias ventas
  if (!esGerencia(sesion.rol)) {
    condiciones.push('vendedor_id = ?');
    params.push(sesion.userId);
  }
  if (opciones.desde) {
    condiciones.push('fecha >= ?');
    params.push(opciones.desde);
  }
  if (opciones.hasta) {
    condiciones.push('fecha <= ?');
    params.push(opciones.hasta);
  }
  const limite = limiteSeguro(opciones.limite, 1000, 5000);
  const filas = await env.DB
    .prepare(`SELECT * FROM ventas WHERE ${condiciones.join(' AND ')} ORDER BY fecha DESC, rowid DESC LIMIT ?`)
    .bind(...params, limite)
    .all<Record<string, unknown>>();
  return filas.results.map(aVenta);
}

// --- Devoluciones --------------------------------------------------------------------------------------------------
export async function guardarDevolucion(env: Entorno, sesion: Sesion, datos: NuevaDevolucion): Promise<Devolucion> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador, el gerente o el encargado registran devoluciones.', 'sin_permiso');
  if (!(await localAccesible(env, sesion, datos.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');

  const motivo = (datos.motivo ?? '').trim().replace(/\s+/g, ' ');
  if (motivo.length < 3 || motivo.length > 200) throw new ErrorApi(400, 'Escribe el motivo de la devolución.', 'datos_invalidos');
  if (!Array.isArray(datos.items_devueltos) || datos.items_devueltos.length === 0) throw new ErrorApi(400, 'Indica qué producto se devuelve.', 'datos_invalidos');
  const fecha = fechaValida(datos.fecha, 'La fecha de la devolución no es válida.');

  const ventaOriginal = await env.DB.prepare('SELECT id, folio, local_id FROM ventas WHERE id = ?').bind(datos.venta_id).first<{ id: string; folio: number; local_id: string }>();
  if (!ventaOriginal) throw new ErrorApi(404, 'La venta no existe.', 'no_existe');
  if (ventaOriginal.local_id !== datos.local_id) throw new ErrorApi(400, 'La devolución debe registrarse en el local de la venta.', 'datos_invalidos');

  const id = nuevoId();
  const db = env.DB;
  const lote = await db.batch<{ valor: number }>([
    db.prepare("INSERT INTO contadores (nombre, valor) VALUES ('devoluciones', 1) ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1 RETURNING valor"),
    db
      .prepare(
        `INSERT INTO devoluciones (id, folio, fecha, local_id, venta_id, venta_folio, motivo, items_devueltos, items_nuevos, total_devuelto, total_nuevo, diferencia, tasa_cambio, pagos, vuelto, reembolso, registrado_por, registrado_nombre)
         VALUES (?, (SELECT valor FROM contadores WHERE nombre = 'devoluciones'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, fecha, datos.local_id, datos.venta_id, ventaOriginal.folio, motivo, JSON.stringify(datos.items_devueltos), JSON.stringify(datos.items_nuevos ?? []),
        redondear2(datos.total_devuelto), redondear2(datos.total_nuevo ?? 0), redondear2(datos.diferencia), datos.tasa_cambio ?? null,
        json(datos.pagos), json(datos.vuelto), json(datos.reembolso), sesion.userId, datos.registrado_nombre ?? sesion.nombre
      ),
    ...sentenciasCambio(db, ['devoluciones'], datos.local_id),
  ]);
  const fila = await db.prepare('SELECT * FROM devoluciones WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return { ...aDevolucion(fila!), folio: lote[0].results[0].valor };
}

export async function listarDevoluciones(
  env: Entorno,
  sesion: Sesion,
  opciones: { ventaId?: string; limite?: number; localId?: string }
): Promise<Devolucion[]> {
  const alcance = await alcanceDe(env, sesion, opciones.localId);
  const { sql, valores } = condicionAlcance(alcance, 'd.local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  if (opciones.ventaId) {
    condiciones.push('d.venta_id = ?');
    params.push(opciones.ventaId);
  }
  // Quien no es de gerencia solo ve las devoluciones de las ventas que puede ver (las suyas)
  if (!esGerencia(sesion.rol)) {
    condiciones.push('v.vendedor_id = ?');
    params.push(sesion.userId);
  }
  const limite = limiteSeguro(opciones.limite, 2000, 5000);
  const filas = await env.DB
    .prepare(`SELECT d.* FROM devoluciones d JOIN ventas v ON v.id = d.venta_id WHERE ${condiciones.join(' AND ')} ORDER BY d.fecha DESC, d.rowid DESC LIMIT ?`)
    .bind(...params, limite)
    .all<Record<string, unknown>>();
  return filas.results.map(aDevolucion);
}


// --- Resetear las ventas (solo el administrador) ----------------------------------------------------------------

export interface ResultadoReseteo {
  /** Ventas y devoluciones que se borraron (o que se borrarían, si fue una simulación) */
  ventas: number;
  devoluciones: number;
  /** Piezas que estaban vendidas por esas ventas y vuelven al stock */
  piezas: number;
  simulado: boolean;
}

const MOTIVO_RESETEO = 'Reseteo de ventas (restaura el stock)';
const PIEZAS_POR_TRAMO = 500; // tope de unidades por lote de movimientos
const MOVIMIENTOS_POR_TRAMO = 50;

/**
 * Borra TODAS las ventas y devoluciones y devuelve al stock las piezas que esas ventas dejaron vendidas (las de la venta y las
 * entregadas a cambio, menos las que ya se devolvieron). Es para limpiar las ventas de prueba: solo el administrador.
 *
 * Primero repone el stock (una ENTRADA "Reseteo de ventas" por producto y local, que reactiva las mismas piezas) y al final borra los
 * registros. Si algo falla a medias, volver a ejecutarlo termina el trabajo: solo repone lo que sigue vendido. Las piezas vendidas
 * por otro motivo (un repuesto de una orden de servicio) no se tocan. Con `simular` solo cuenta, sin cambiar nada.
 */
export async function resetearVentas(env: Entorno, sesion: Sesion, opciones: { simular?: boolean } = {}): Promise<ResultadoReseteo> {
  if (!esAdministrador(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador puede resetear las ventas.', 'sin_permiso');
  const db = env.DB;

  const ventas = (await db.prepare('SELECT local_id, items FROM ventas').all<{ local_id: string; items: string }>()).results;
  const devoluciones = (await db.prepare('SELECT local_id, items_nuevos FROM devoluciones').all<{ local_id: string; items_nuevos: string }>()).results;

  // Piezas que estas ventas sacaron del stock: las de cada venta y las entregadas a cambio
  const codigos = new Set<string>();
  const juntar = (texto: string) => {
    for (const item of JSON.parse(texto) as { unidades?: string[] }[]) for (const c of item.unidades ?? []) codigos.add(c);
  };
  for (const v of ventas) juntar(v.items);
  for (const d of devoluciones) juntar(d.items_nuevos);

  // De ellas, las que siguen vendidas (las devueltas ya están en el stock)
  const porGrupo = new Map<string, { productoId: string; localId: string; codigos: string[] }>();
  let piezas = 0;
  for (const tramo of tramos([...codigos])) {
    const filas = await db
      .prepare(`SELECT codigo, producto_id, local_id FROM unidades_producto WHERE estado = 'VENDIDA' AND codigo IN (${marcas(tramo.length)})`)
      .bind(...tramo)
      .all<{ codigo: string; producto_id: string; local_id: string }>();
    for (const f of filas.results) {
      const clave = `${f.producto_id}|${f.local_id}`;
      const grupo = porGrupo.get(clave) ?? { productoId: f.producto_id, localId: f.local_id, codigos: [] };
      grupo.codigos.push(f.codigo);
      porGrupo.set(clave, grupo);
      piezas++;
    }
  }

  const resultado: ResultadoReseteo = { ventas: ventas.length, devoluciones: devoluciones.length, piezas, simulado: !!opciones.simular };
  if (opciones.simular || (ventas.length === 0 && devoluciones.length === 0 && piezas === 0)) return resultado;

  // 1. Reponer el stock, por lotes que respetan los topes de movimientos y de piezas
  let lote: EntradaMovimiento[] = [];
  let enLote = 0;
  const enviar = async () => {
    if (lote.length > 0) await registrarMovimientos(env, sesion, lote);
    lote = [];
    enLote = 0;
  };
  for (const grupo of porGrupo.values()) {
    for (let i = 0; i < grupo.codigos.length; i += PIEZAS_POR_TRAMO) {
      const trozo = grupo.codigos.slice(i, i + PIEZAS_POR_TRAMO);
      if (enLote + trozo.length > PIEZAS_POR_TRAMO || lote.length >= MOVIMIENTOS_POR_TRAMO) await enviar();
      lote.push({ productoId: grupo.productoId, tipo: 'ENTRADA', cantidad: trozo.length, localId: grupo.localId, motivo: MOTIVO_RESETEO, unidadCodigos: trozo });
      enLote += trozo.length;
    }
  }
  await enviar();

  // 2. Borrar los registros (las devoluciones primero: apuntan a las ventas) y avisar a las pantallas abiertas
  const locales = new Set([...ventas.map((v) => v.local_id), ...devoluciones.map((d) => d.local_id)]);
  await db.batch([
    db.prepare('DELETE FROM devoluciones'),
    db.prepare('DELETE FROM ventas'),
    ...[...locales].flatMap((localId) => sentenciasCambio(db, ['ventas', 'devoluciones'], localId)),
  ]);
  return resultado;
}
