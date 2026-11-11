// Módulo de Inversión (migración 0021): lo que se invierte en mercancía NUEVA, anotado a mano por el gerente o el administrador, por local,
// más la lista de proveedores. NO está ligado al inventario (mucha mercancía vieja todavía no está cargada).
//   · COMPRA: lo que se compró (en dólares; se guarda la tasa BCV de esa fecha para mostrar los bolívares de referencia);
//   · PERDIDA: lo que se perdió; se muestra aparte, no se resta de la inversión.
// Permisos: solo administrador y gerente (el servicio lo exige primero; matriz en tests/server/matriz-roles.test.ts). El gerente solo
// llega a los locales con suscripción vigente (`alcanceDe`). Un registro de un local fuera del alcance responde 404, igual que si no existiera.
import { alcanceDe, condicionAlcance, exigirRol, localAccesible, type Alcance, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { limiteSeguro, nuevoId } from '../util';
import { claveProveedor, compararInversiones, diaDelNegocioDe, diaSiguiente, limpiarNombreProveedor, mermaComoPerdida, tasaParaFecha, validarDatosInversion, type DatosInversionValidados } from '../../utils/inversion';
import type { DatosInversion, DatosProveedor, Inversion, Proveedor, ProveedorResumen } from '../../types/database.types';

const ZONA_POR_DEFECTO = 'America/Caracas';
const ahora = () => new Date().toISOString();

/** El día de hoy del negocio ("aaaa-mm-dd", en la zona horaria del negocio). */
export function hoyDelNegocio(env: Entorno): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.ZONA_HORARIA ?? ZONA_POR_DEFECTO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Solo administrador y gerente; devuelve el alcance de locales con el que se consulta. */
async function acceso(env: Entorno, sesion: Sesion, localId?: string): Promise<Alcance> {
  exigirRol(sesion, ['administrador', 'gerente']);
  return alcanceDe(env, sesion, localId);
}

function validar(env: Entorno, datos: DatosInversion): DatosInversionValidados {
  try {
    return validarDatosInversion(datos, hoyDelNegocio(env));
  } catch (err) {
    throw new ErrorApi(400, err instanceof Error ? err.message : 'Los datos no son válidos.', 'datos_invalidos');
  }
}

/** La tasa BCV de una fecha (la última registrada ese día o antes; si no había, la primera que existe; sin tasas, null). */
async function tasaDeFecha(env: Entorno, fecha: string): Promise<number | null> {
  const filas = await env.DB.prepare('SELECT fecha, tasa, created_at FROM tasas_cambio ORDER BY fecha DESC, created_at DESC LIMIT 400').all<{ fecha: string; tasa: number; created_at: string }>();
  return tasaParaFecha(filas.results, fecha);
}

const SELECCION = 'id, local_id, tipo, fecha, descripcion, proveedor_id, proveedor_nombre, monto_usd, tasa_bcv, creado_por_nombre, created_at, updated_at';

export async function listarInversiones(
  env: Entorno,
  sesion: Sesion,
  opciones: { desde?: string; hasta?: string; localId?: string; tipo?: 'COMPRA' | 'PERDIDA'; limite?: number } = {}
): Promise<Inversion[]> {
  const alcance = await acceso(env, sesion, opciones.localId);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  const esFecha = (f?: string) => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f);
  if (esFecha(opciones.desde)) {
    condiciones.push('fecha >= ?');
    params.push(opciones.desde);
  }
  if (esFecha(opciones.hasta)) {
    condiciones.push('fecha <= ?');
    params.push(opciones.hasta);
  }
  if (opciones.tipo) {
    condiciones.push('tipo = ?');
    params.push(opciones.tipo);
  }
  const limite = limiteSeguro(opciones.limite, 1000, 5000);
  const filas = await env.DB
    .prepare(`SELECT ${SELECCION} FROM inversiones WHERE ${condiciones.join(' AND ')} ORDER BY fecha DESC, created_at DESC, rowid DESC LIMIT ?`)
    .bind(...params, limite)
    .all<Inversion>();
  if (opciones.tipo === 'COMPRA') return filas.results;
  const automaticas = await perdidasDeMermas(env, alcance, opciones);
  if (automaticas.length === 0) return filas.results;
  return [...filas.results, ...automaticas].sort(compararInversiones).slice(0, limite);
}

/**
 * Las mermas (vidrios defectuosos marcados al cobrar o dados de baja por cantidad en Descargo) como registros de PÉRDIDA automáticos.
 * Se leen de `mermas` en el momento (si se borra la venta que las originó, desaparecen solas). El día es el del negocio, así que se
 * piden con un día de margen y se filtran después por ese día.
 */
async function perdidasDeMermas(env: Entorno, alcance: Alcance, opciones: { desde?: string; hasta?: string }): Promise<Inversion[]> {
  const { sql, valores } = condicionAlcance(alcance, 'm.local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  const esFecha = (f?: string) => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f);
  if (esFecha(opciones.desde)) {
    condiciones.push('m.fecha >= ?');
    params.push(`${new Date(Date.parse(`${opciones.desde}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
  if (esFecha(opciones.hasta)) {
    condiciones.push('m.fecha < ?');
    params.push(`${diaSiguiente(diaSiguiente(opciones.hasta!))}T00:00:00.000Z`);
  }
  const filas = await env.DB
    .prepare(
      `SELECT m.id, m.local_id, p.nombre AS producto_nombre, m.cantidad, m.origen, m.motivo, m.nota, m.por_nombre, m.fecha, m.valor_unitario_usd
       FROM mermas m LEFT JOIN productos p ON p.id = m.producto_id
       WHERE ${condiciones.join(' AND ')} ORDER BY m.fecha DESC LIMIT 5000`
    )
    .bind(...params)
    .all<{ id: string; local_id: string; producto_nombre: string | null; cantidad: number; origen: 'VENTA' | 'DESCARGO'; motivo: string | null; nota: string | null; por_nombre: string; fecha: string; valor_unitario_usd: number | null }>();
  if (filas.results.length === 0) return [];
  const zona = env.ZONA_HORARIA ?? ZONA_POR_DEFECTO;
  const tasas = await env.DB.prepare('SELECT fecha, tasa, created_at FROM tasas_cambio ORDER BY fecha DESC, created_at DESC LIMIT 400').all<{ fecha: string; tasa: number; created_at: string }>();
  const out: Inversion[] = [];
  for (const m of filas.results) {
    const dia = diaDelNegocioDe(m.fecha, zona);
    if ((esFecha(opciones.desde) && dia < opciones.desde!) || (esFecha(opciones.hasta) && dia > opciones.hasta!)) continue;
    out.push(mermaComoPerdida(m, dia, tasaParaFecha(tasas.results, dia)));
  }
  return out;
}

async function inversionDelAlcance(env: Entorno, sesion: Sesion, id: string): Promise<Inversion> {
  if (id.startsWith('merma:')) throw new ErrorApi(400, 'Esta pérdida se anotó sola desde un vidrio defectuoso o dado de baja: no se edita ni se elimina aquí (se corrige en la venta o en Descargo).', 'registro_automatico');
  const alcance = await acceso(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const fila = await env.DB.prepare(`SELECT ${SELECCION} FROM inversiones WHERE id = ? AND ${sql}`).bind(id, ...valores).first<Inversion>();
  if (!fila) throw new ErrorApi(404, 'El registro no existe.', 'no_existe');
  return fila;
}

/**
 * El proveedor de un registro: si el nombre ya está en la lista se usa ese; si no, se agrega (la sentencia de alta va en el mismo lote
 * que el registro). Sin nombre, el registro queda sin proveedor.
 */
async function resolverProveedor(env: Entorno, sesion: Sesion, nombre: string | null): Promise<{ id: string | null; nombre: string | null; altas: D1PreparedStatement[]; nuevo: boolean }> {
  if (!nombre) return { id: null, nombre: null, altas: [], nuevo: false };
  const existente = await env.DB.prepare('SELECT id, nombre FROM proveedores WHERE nombre_normalizado = ?').bind(claveProveedor(nombre)).first<{ id: string; nombre: string }>();
  if (existente) return { id: existente.id, nombre: existente.nombre, altas: [], nuevo: false };
  const id = nuevoId();
  const marca = ahora();
  const alta = env.DB
    .prepare('INSERT INTO proveedores (id, nombre, nombre_normalizado, creado_por_nombre, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, nombre, claveProveedor(nombre), sesion.nombre, marca, marca);
  return { id, nombre, altas: [alta], nuevo: true };
}

export async function crearInversion(env: Entorno, sesion: Sesion, datos: DatosInversion): Promise<Inversion> {
  exigirRol(sesion, ['administrador', 'gerente']);
  const d = validar(env, datos);
  if (!(await localAccesible(env, sesion, d.localId))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  const proveedor = await resolverProveedor(env, sesion, d.proveedor);
  const tasa = await tasaDeFecha(env, d.fecha);
  const id = nuevoId();
  const marca = ahora();
  await env.DB.batch([
    ...proveedor.altas,
    env.DB
      .prepare(
        `INSERT INTO inversiones (id, local_id, tipo, fecha, descripcion, proveedor_id, proveedor_nombre, monto_usd, tasa_bcv, creado_por, creado_por_nombre, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, d.localId, d.tipo, d.fecha, d.descripcion, proveedor.id, proveedor.nombre, d.monto_usd, tasa, sesion.userId, sesion.nombre, marca, marca),
    ...sentenciasCambio(env.DB, ['inversiones'], d.localId),
    ...(proveedor.nuevo ? sentenciasCambio(env.DB, ['proveedores'], null) : []),
  ]);
  return inversionDelAlcance(env, sesion, id);
}

/** Corrige un registro. La tasa BCV se vuelve a tomar solo si cambió la fecha (o si no tenía). */
export async function actualizarInversion(env: Entorno, sesion: Sesion, id: string, datos: DatosInversion): Promise<Inversion> {
  const actual = await inversionDelAlcance(env, sesion, id);
  const d = validar(env, datos);
  if (!(await localAccesible(env, sesion, d.localId))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  const proveedor = await resolverProveedor(env, sesion, d.proveedor);
  const tasa = d.fecha !== actual.fecha || actual.tasa_bcv === null ? await tasaDeFecha(env, d.fecha) : actual.tasa_bcv;
  const locales = [...new Set([actual.local_id, d.localId])];
  await env.DB.batch([
    ...proveedor.altas,
    env.DB
      .prepare('UPDATE inversiones SET local_id = ?, tipo = ?, fecha = ?, descripcion = ?, proveedor_id = ?, proveedor_nombre = ?, monto_usd = ?, tasa_bcv = ?, updated_at = ? WHERE id = ?')
      .bind(d.localId, d.tipo, d.fecha, d.descripcion, proveedor.id, proveedor.nombre, d.monto_usd, tasa, ahora(), id),
    ...locales.flatMap((l) => sentenciasCambio(env.DB, ['inversiones'], l)),
    ...(proveedor.nuevo ? sentenciasCambio(env.DB, ['proveedores'], null) : []),
  ]);
  return inversionDelAlcance(env, sesion, id);
}

export async function eliminarInversion(env: Entorno, sesion: Sesion, id: string): Promise<void> {
  const actual = await inversionDelAlcance(env, sesion, id);
  await env.DB.batch([env.DB.prepare('DELETE FROM inversiones WHERE id = ?').bind(id), ...sentenciasCambio(env.DB, ['inversiones'], actual.local_id)]);
}

// --- Proveedores (lista global) ---------------------------------------------------------------------------------

const aProveedor = (f: Record<string, unknown>): Proveedor => ({
  id: String(f.id),
  nombre: String(f.nombre),
  telefono: (f.telefono as string | null) ?? null,
  nota: (f.nota as string | null) ?? null,
  creado_por_nombre: (f.creado_por_nombre as string | null) ?? null,
  created_at: String(f.created_at),
  updated_at: String(f.updated_at),
});

function datosProveedor(datos: DatosProveedor) {
  const nombre = limpiarNombreProveedor(datos.nombre);
  if (!nombre || nombre.length < 2 || nombre.length > 80) throw new ErrorApi(400, 'Escribe el nombre del proveedor (de 2 a 80 caracteres).', 'datos_invalidos');
  const telefono = (datos.telefono ?? '').trim() || null;
  const nota = (datos.nota ?? '').replace(/\s+/g, ' ').trim() || null;
  if (nota && nota.length > 300) throw new ErrorApi(400, 'La nota es demasiado larga (máximo 300 caracteres).', 'datos_invalidos');
  return { nombre, telefono, nota };
}

/** La lista de proveedores con cuántas compras y cuánto se les ha comprado (de todos los locales a los que se llega). */
export async function listarProveedores(env: Entorno, sesion: Sesion): Promise<ProveedorResumen[]> {
  const alcance = await acceso(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'i.local_id');
  const filas = await env.DB
    .prepare(
      `SELECT p.*, COUNT(i.id) AS n_compras, COALESCE(SUM(i.monto_usd), 0) AS total_usd
       FROM proveedores p LEFT JOIN inversiones i ON i.proveedor_id = p.id AND i.tipo = 'COMPRA' AND ${sql}
       GROUP BY p.id ORDER BY lower(p.nombre)`
    )
    .bind(...valores)
    .all<Record<string, unknown>>();
  return filas.results.map((f) => ({ ...aProveedor(f), n_compras: Number(f.n_compras), total_usd: Math.round(Number(f.total_usd) * 100) / 100 }));
}

export async function crearProveedor(env: Entorno, sesion: Sesion, datos: DatosProveedor): Promise<Proveedor> {
  await acceso(env, sesion);
  const p = datosProveedor(datos);
  const repetido = await env.DB.prepare('SELECT nombre FROM proveedores WHERE nombre_normalizado = ?').bind(claveProveedor(p.nombre)).first<{ nombre: string }>();
  if (repetido) throw new ErrorApi(409, `Ya existe un proveedor llamado «${repetido.nombre}».`, 'proveedor_repetido');
  const id = nuevoId();
  const marca = ahora();
  await env.DB.batch([
    env.DB
      .prepare('INSERT INTO proveedores (id, nombre, nombre_normalizado, telefono, nota, creado_por_nombre, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, p.nombre, claveProveedor(p.nombre), p.telefono, p.nota, sesion.nombre, marca, marca),
    ...sentenciasCambio(env.DB, ['proveedores'], null),
  ]);
  return aProveedor((await env.DB.prepare('SELECT * FROM proveedores WHERE id = ?').bind(id).first<Record<string, unknown>>())!);
}

/** Corrige un proveedor; los registros ya anotados con él cambian al nombre nuevo. */
export async function actualizarProveedor(env: Entorno, sesion: Sesion, id: string, datos: DatosProveedor): Promise<Proveedor> {
  await acceso(env, sesion);
  const p = datosProveedor(datos);
  const actual = await env.DB.prepare('SELECT id FROM proveedores WHERE id = ?').bind(id).first();
  if (!actual) throw new ErrorApi(404, 'El proveedor no existe.', 'no_existe');
  const otro = await env.DB.prepare('SELECT nombre FROM proveedores WHERE nombre_normalizado = ? AND id <> ?').bind(claveProveedor(p.nombre), id).first<{ nombre: string }>();
  if (otro) throw new ErrorApi(409, `Ya existe otro proveedor llamado «${otro.nombre}».`, 'proveedor_repetido');
  const locales = (await env.DB.prepare('SELECT DISTINCT local_id FROM inversiones WHERE proveedor_id = ?').bind(id).all<{ local_id: string }>()).results.map((f) => f.local_id);
  await env.DB.batch([
    env.DB.prepare('UPDATE proveedores SET nombre = ?, nombre_normalizado = ?, telefono = ?, nota = ?, updated_at = ? WHERE id = ?').bind(p.nombre, claveProveedor(p.nombre), p.telefono, p.nota, ahora(), id),
    env.DB.prepare('UPDATE inversiones SET proveedor_nombre = ? WHERE proveedor_id = ?').bind(p.nombre, id),
    ...sentenciasCambio(env.DB, ['proveedores'], null),
    ...locales.flatMap((l) => sentenciasCambio(env.DB, ['inversiones'], l)),
  ]);
  return aProveedor((await env.DB.prepare('SELECT * FROM proveedores WHERE id = ?').bind(id).first<Record<string, unknown>>())!);
}

/** Quita un proveedor de la lista; los registros ya anotados conservan su nombre. */
export async function eliminarProveedor(env: Entorno, sesion: Sesion, id: string): Promise<void> {
  await acceso(env, sesion);
  const actual = await env.DB.prepare('SELECT id FROM proveedores WHERE id = ?').bind(id).first();
  if (!actual) throw new ErrorApi(404, 'El proveedor no existe.', 'no_existe');
  const locales = (await env.DB.prepare('SELECT DISTINCT local_id FROM inversiones WHERE proveedor_id = ?').bind(id).all<{ local_id: string }>()).results.map((f) => f.local_id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM proveedores WHERE id = ?').bind(id),
    ...sentenciasCambio(env.DB, ['proveedores'], null),
    ...locales.flatMap((l) => sentenciasCambio(env.DB, ['inversiones'], l)),
  ]);
}
