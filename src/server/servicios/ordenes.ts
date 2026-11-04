// Órdenes de servicio técnico. Reglas portadas de la migración 0016/0021: cualquier rol con acceso al local las ve,
// las crea y las actualiza; el trigger de la base de datos exige que el local sea de servicio técnico y sella las fechas
// (listo_en, entregada_en, actualizada_en). Una orden Entregada es final.
import { alcanceDe, condicionAlcance, localAccesible, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { ahoraISO, nuevoId, redondear2 } from '../util';
import type { EstadoOrdenServicio, NuevaOrdenServicio, OrdenServicio, RepuestoOrden } from '../../types/database.types';

const ESTADOS: EstadoOrdenServicio[] = ['pendiente', 'en_reparacion', 'listo', 'entregado'];

function aOrden(f: Record<string, unknown>): OrdenServicio {
  return {
    ...(f as unknown as OrdenServicio),
    repuestos: typeof f.repuestos === 'string' ? (JSON.parse(f.repuestos) as RepuestoOrden[]) : [],
  };
}

const totalDeOrden = (repuestos: RepuestoOrden[], manoDeObra: number): number =>
  redondear2(repuestos.reduce((suma, r) => suma + r.precio_unitario * r.cantidad, 0) + manoDeObra);

export async function listarOrdenes(env: Entorno, sesion: Sesion, opciones: { limite?: number; localId?: string }): Promise<OrdenServicio[]> {
  const alcance = await alcanceDe(env, sesion, opciones.localId);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const limite = Math.min(Math.max(1, Math.floor(opciones.limite ?? 500)), 2000);
  const filas = await env.DB
    .prepare(`SELECT * FROM ordenes_servicio WHERE ${sql} ORDER BY recibida_en DESC, rowid DESC LIMIT ?`)
    .bind(...valores, limite)
    .all<Record<string, unknown>>();
  return filas.results.map(aOrden);
}

/** La orden, o null si no existe o es de un local al que no se accede. */
export async function obtenerOrden(env: Entorno, sesion: Sesion, id: string): Promise<OrdenServicio | null> {
  const alcance = await alcanceDe(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const fila = await env.DB.prepare(`SELECT * FROM ordenes_servicio WHERE id = ? AND ${sql}`).bind(id, ...valores).first<Record<string, unknown>>();
  return fila ? aOrden(fila) : null;
}

export async function crearOrden(env: Entorno, sesion: Sesion, datos: NuevaOrdenServicio): Promise<OrdenServicio> {
  if (!(await localAccesible(env, sesion, datos.local_id))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');

  const texto = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');
  const cliente = { cedula: texto(datos.cliente_cedula), nombre: texto(datos.cliente_nombre), telefono: texto(datos.cliente_telefono) };
  if (!cliente.cedula || !cliente.nombre || !cliente.telefono) throw new ErrorApi(400, 'Faltan datos del cliente (cédula, nombre y teléfono).', 'datos_invalidos');
  const marca = texto(datos.equipo_marca);
  const modelo = texto(datos.equipo_modelo);
  if (!marca || !modelo) throw new ErrorApi(400, 'Indica la marca y el modelo del equipo.', 'datos_invalidos');
  const falla = texto(datos.falla_reportada);
  if (falla.length < 3) throw new ErrorApi(400, 'Describe la falla que reporta el cliente.', 'datos_invalidos');

  const id = nuevoId();
  const ahora = ahoraISO();
  const db = env.DB;
  try {
    const lote = await db.batch<{ valor: number }>([
      db.prepare("INSERT INTO contadores (nombre, valor) VALUES ('ordenes_servicio', 1) ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1 RETURNING valor"),
      db
        .prepare(
          `INSERT INTO ordenes_servicio (id, folio, local_id, cliente_cedula, cliente_nombre, cliente_telefono, equipo_marca, equipo_modelo, equipo_imei, accesorios_recibidos, falla_reportada, recibida_en, actualizada_en, registrado_por, registrado_nombre)
           VALUES (?, (SELECT valor FROM contadores WHERE nombre = 'ordenes_servicio'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id, datos.local_id, cliente.cedula, cliente.nombre, cliente.telefono, marca, modelo, texto(datos.equipo_imei) || null,
          texto(datos.accesorios_recibidos) || null, falla, ahora, ahora, sesion.userId, datos.registrado_nombre ?? sesion.nombre
        ),
      ...sentenciasCambio(db, ['ordenes_servicio'], datos.local_id),
    ]);
    const fila = await db.prepare('SELECT * FROM ordenes_servicio WHERE id = ?').bind(id).first<Record<string, unknown>>();
    return { ...aOrden(fila!), folio: lote[0].results[0].valor };
  } catch (err) {
    if (err instanceof Error && /solo se registran en un local de servicio técnico/.test(err.message)) {
      throw new ErrorApi(400, 'Las órdenes de servicio solo se registran en un local de servicio técnico', 'local_invalido');
    }
    throw err;
  }
}

export type CambiosOrden = Partial<Pick<OrdenServicio, 'diagnostico' | 'estado' | 'tecnico_id' | 'tecnico_nombre' | 'repuestos' | 'mano_de_obra_usd'>> & { total_usd?: number };

/** Cambia estado, diagnóstico, técnico, repuestos o mano de obra. El total se recalcula SIEMPRE aquí. Una orden entregada es final. */
export async function actualizarOrden(env: Entorno, sesion: Sesion, id: string, cambios: CambiosOrden): Promise<OrdenServicio> {
  await alcanceDe(env, sesion); // 403 si no tiene acceso a ningún local (p. ej. contador)
  const actual = await obtenerOrden(env, sesion, id);
  if (!actual) throw new ErrorApi(404, 'La orden no existe.', 'no_existe');
  if (actual.estado === 'entregado') throw new ErrorApi(409, 'Esa orden ya fue entregada y no se puede modificar.', 'orden_entregada');

  if (cambios.estado !== undefined && !ESTADOS.includes(cambios.estado)) throw new ErrorApi(400, 'Estado de orden inválido.', 'datos_invalidos');
  if (cambios.mano_de_obra_usd !== undefined && !(Number.isFinite(cambios.mano_de_obra_usd) && cambios.mano_de_obra_usd >= 0)) {
    throw new ErrorApi(400, 'La mano de obra debe ser un número mayor o igual a 0.', 'datos_invalidos');
  }
  const repuestos = cambios.repuestos ?? actual.repuestos;
  const manoDeObra = redondear2(cambios.mano_de_obra_usd ?? actual.mano_de_obra_usd);
  const diagnostico = cambios.diagnostico !== undefined ? (cambios.diagnostico ?? '').trim().slice(0, 1000) || null : actual.diagnostico;

  await env.DB.batch([
    env.DB
      .prepare('UPDATE ordenes_servicio SET estado = ?, diagnostico = ?, tecnico_id = ?, tecnico_nombre = ?, repuestos = ?, mano_de_obra_usd = ?, total_usd = ? WHERE id = ?')
      .bind(
        cambios.estado ?? actual.estado, diagnostico, cambios.tecnico_id !== undefined ? cambios.tecnico_id : (actual.tecnico_id ?? null),
        cambios.tecnico_nombre !== undefined ? cambios.tecnico_nombre : (actual.tecnico_nombre ?? null), JSON.stringify(repuestos), manoDeObra,
        totalDeOrden(repuestos, manoDeObra), id
      ),
    ...sentenciasCambio(env.DB, ['ordenes_servicio'], actual.local_id),
  ]);
  return (await obtenerOrden(env, sesion, id))!;
}
