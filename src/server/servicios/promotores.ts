// Directorio de promotores (migración 0018). Un promotor es quien trae clientes (y cobra una comisión por la diferencia de precio) o se
// lleva mercancía para revenderla. NO es un usuario ni un empleado: es un registro con cédula, nombre, apellido, teléfono y banco receptor.
//   · se agrega desde Pendientes (encargado, gerente, administrador) o desde Nómina (gerente, administrador, contador);
//   · también se crea solo cuando se vende con precio de promotor y se anota su cédula (ver `guardarVenta`);
//   · el POS lo busca por cédula para completar los datos al escribirla (cualquier rol que venda).
import { alcanceDe, alcanceNomina, condicionAlcance, esGerencia, type Alcance, type Sesion } from '../authz';
import { avisarCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { limiteSeguro, nuevoId } from '../util';
import { normalizarPromotor } from '../../utils/promotor';
import type { DatosNuevoPromotor, Promotor, PromotorResumen } from '../../types/database.types';

const ahora = () => new Date().toISOString();

/**
 * Alcance con el que se consultan los pendientes y el directorio: el encargado, el gerente y el administrador por su local; el contador
 * por el de la nómina. Cualquier otro rol (vendedor, técnico) no los ve.
 */
export async function alcanceDePendientes(env: Entorno, sesion: Sesion, localId?: string): Promise<Alcance> {
  if (sesion.rol === 'contador') return alcanceNomina(env, sesion, localId);
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Tu rol no tiene acceso a los pendientes ni a los promotores.', 'sin_permiso');
  return alcanceDe(env, sesion, localId);
}

const aPromotor = (f: Record<string, unknown>): Promotor => ({
  id: String(f.id),
  cedula: String(f.cedula),
  nombre: String(f.nombre ?? ''),
  apellido: String(f.apellido ?? ''),
  telefono: (f.telefono as string | null) ?? null,
  banco: (f.banco as string | null) ?? null,
  creado_por_nombre: (f.creado_por_nombre as string | null) ?? null,
  created_at: String(f.created_at),
  updated_at: String(f.updated_at),
});

/** Valida los datos de un promotor del directorio: cédula, nombre y apellido son obligatorios. */
function datosDelDirectorio(datos: DatosNuevoPromotor) {
  const r = normalizarPromotor(datos);
  if (!r.ok) throw new ErrorApi(400, r.mensaje, 'promotor_invalido');
  const p = r.promotor;
  if (!p.cedula) throw new ErrorApi(400, 'Escribe la cédula del promotor.', 'datos_invalidos');
  if (p.nombrePropio.length < 2 || p.apellido.length < 2) throw new ErrorApi(400, 'Escribe el nombre y el apellido del promotor.', 'datos_invalidos');
  return p;
}

/** Busca un promotor por cédula (para completar sus datos al vender). Roles que venden: administrador, gerente, encargado y vendedor. */
export async function buscarPromotorPorCedula(env: Entorno, sesion: Sesion, cedulaTexto: string): Promise<Promotor | null> {
  if (sesion.rol === 'tecnico') throw new ErrorApi(403, 'Tu rol no tiene permiso para hacer esto.', 'sin_permiso');
  await alcanceDe(env, sesion); // contador, usuario sin local o local suspendido: 403
  const r = normalizarPromotor({ cedula: cedulaTexto });
  if (!r.ok) throw new ErrorApi(400, r.mensaje, 'promotor_invalido');
  if (!r.promotor.cedula) return null;
  const fila = await env.DB.prepare('SELECT * FROM promotores WHERE cedula = ?').bind(r.promotor.cedula).first<Record<string, unknown>>();
  return fila ? aPromotor(fila) : null;
}

/**
 * Los promotores registrados en el local donde se vende (selector del cobro con precio de promotor). Cualquier rol que venda
 * (administrador, gerente, encargado y vendedor); el administrador y el gerente piden el local con `localId`.
 */
export async function listarPromotoresDelLocal(env: Entorno, sesion: Sesion, localId?: string): Promise<Promotor[]> {
  if (sesion.rol === 'tecnico') throw new ErrorApi(403, 'Tu rol no tiene permiso para hacer esto.', 'sin_permiso');
  const alcance = await alcanceDe(env, sesion, localId); // contador, sin local o local suspendido: 403
  if (alcance.tipo === 'locales' && alcance.ids.length === 1) {
    const filas = await env.DB
      .prepare('SELECT p.* FROM promotores p JOIN promotor_locales pl ON pl.promotor_id = p.id WHERE pl.local_id = ? ORDER BY lower(p.nombre), lower(p.apellido) LIMIT 500')
      .bind(alcance.ids[0])
      .all<Record<string, unknown>>();
    return filas.results.map(aPromotor);
  }
  // Administrador o gerente sin elegir un local: el directorio completo
  const filas = await env.DB.prepare('SELECT * FROM promotores ORDER BY lower(nombre), lower(apellido) LIMIT 500').all<Record<string, unknown>>();
  return filas.results.map(aPromotor);
}

/** El directorio, con lo que queda pendiente con cada promotor dentro del alcance de quien consulta. */
export async function listarPromotores(env: Entorno, sesion: Sesion, opciones: { localId?: string; buscar?: string; limite?: number } = {}): Promise<PromotorResumen[]> {
  const alcance = await alcanceDePendientes(env, sesion, opciones.localId);
  const { sql, valores } = condicionAlcance(alcance, 'x.local_id');
  const params: unknown[] = [...valores];
  let filtro = '';
  const texto = (opciones.buscar ?? '').trim().toLowerCase();
  if (texto) {
    filtro = `WHERE lower(p.nombre || ' ' || p.apellido) LIKE ? OR lower(p.cedula) LIKE ? OR coalesce(p.telefono, '') LIKE ?`;
    const comodin = `%${texto.replace(/[%_]/g, '')}%`;
    params.push(comodin, comodin, comodin);
  }
  const filas = await env.DB
    .prepare(
      `SELECT p.*,
              COALESCE(SUM(CASE WHEN x.tipo = 'COMISION' AND x.estado = 'PENDIENTE' THEN x.monto_usd END), 0) AS comision_pendiente,
              COALESCE(SUM(CASE WHEN x.tipo = 'MERCANCIA' AND x.estado = 'PENDIENTE' THEN x.monto_usd END), 0) AS mercancia_pendiente,
              COUNT(CASE WHEN x.estado = 'PENDIENTE' THEN 1 END) AS n_pendientes
       FROM promotores p LEFT JOIN pendientes x ON x.promotor_id = p.id AND ${sql}
       ${filtro}
       GROUP BY p.id
       ORDER BY lower(p.nombre), lower(p.apellido)
       LIMIT ?`
    )
    .bind(...params, limiteSeguro(opciones.limite, 500, 2000))
    .all<Record<string, unknown>>();
  return filas.results.map((f) => ({
    ...aPromotor(f),
    comision_pendiente: Math.round(Number(f.comision_pendiente) * 100) / 100,
    mercancia_pendiente: Math.round(Number(f.mercancia_pendiente) * 100) / 100,
    n_pendientes: Number(f.n_pendientes),
  }));
}

/** Agrega un promotor al directorio. La cédula es única: si ya existe se avisa quién es. */
export async function crearPromotor(env: Entorno, sesion: Sesion, datos: DatosNuevoPromotor): Promise<Promotor> {
  const alcance = await alcanceDePendientes(env, sesion, datos.local_id ?? undefined);
  // El promotor queda en la lista del local donde se registra (si no se sabe cuál, el único local de quien lo crea)
  const localDestino = alcance.tipo === 'locales' && alcance.ids.length === 1 ? alcance.ids[0] : null;
  const p = datosDelDirectorio(datos);
  const existente = await env.DB.prepare('SELECT nombre, apellido FROM promotores WHERE cedula = ?').bind(p.cedula).first<{ nombre: string; apellido: string }>();
  if (existente) {
    throw new ErrorApi(409, `Ya hay un promotor con la cédula ${p.cedula}: ${`${existente.nombre} ${existente.apellido}`.trim() || 'sin nombre'}. Búscalo en la lista.`, 'promotor_repetido');
  }
  const id = nuevoId();
  const marca = ahora();
  const sentencias = [
    env.DB
      .prepare('INSERT INTO promotores (id, cedula, nombre, apellido, telefono, banco, creado_por_nombre, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, p.cedula, p.nombrePropio, p.apellido, p.telefono, p.banco, sesion.nombre, marca, marca),
  ];
  if (localDestino) sentencias.push(env.DB.prepare('INSERT OR IGNORE INTO promotor_locales (promotor_id, local_id) VALUES (?, ?)').bind(id, localDestino));
  await env.DB.batch(sentencias);
  await avisarCambio(env.DB, ['promotores']);
  const fila = await env.DB.prepare('SELECT * FROM promotores WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return aPromotor(fila!);
}

/** Corrige los datos de un promotor (también la cédula, mientras no choque con la de otro). */
export async function actualizarPromotor(env: Entorno, sesion: Sesion, id: string, datos: DatosNuevoPromotor): Promise<Promotor> {
  await alcanceDePendientes(env, sesion);
  const p = datosDelDirectorio(datos);
  const actual = await env.DB.prepare('SELECT id FROM promotores WHERE id = ?').bind(id).first();
  if (!actual) throw new ErrorApi(404, 'El promotor no existe.', 'no_existe');
  const otro = await env.DB.prepare('SELECT nombre, apellido FROM promotores WHERE cedula = ? AND id <> ?').bind(p.cedula, id).first<{ nombre: string; apellido: string }>();
  if (otro) throw new ErrorApi(409, `Esa cédula ya es de otro promotor: ${`${otro.nombre} ${otro.apellido}`.trim()}.`, 'promotor_repetido');
  // Si el promotor ya cobra por día, su fila de nómina (migración 0020) lleva los mismos datos: no puede chocar con la cédula de un empleado
  const choque = await env.DB.prepare('SELECT 1 AS x FROM empleados WHERE cedula = ? AND (promotor_id IS NULL OR promotor_id <> ?)').bind(p.cedula, id).first();
  if (choque) throw new ErrorApi(409, `La cédula ${p.cedula} ya está registrada como empleado de nómina.`, 'cedula_repetida');
  await env.DB.batch([
    env.DB
      .prepare('UPDATE promotores SET cedula = ?, nombre = ?, apellido = ?, telefono = ?, banco = ?, updated_at = ? WHERE id = ?')
      .bind(p.cedula, p.nombrePropio, p.apellido, p.telefono, p.banco, ahora(), id),
    env.DB.prepare('UPDATE empleados SET cedula = ?, nombre = ?, apellido = ? WHERE promotor_id = ?').bind(p.cedula, p.nombrePropio, p.apellido, id),
  ]);
  await avisarCambio(env.DB, ['promotores']);
  const sombra = await env.DB.prepare('SELECT local_id FROM empleados WHERE promotor_id = ?').bind(id).first<{ local_id: string }>();
  if (sombra) await avisarCambio(env.DB, ['empleados'], sombra.local_id);
  const fila = await env.DB.prepare('SELECT * FROM promotores WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return aPromotor(fila!);
}
