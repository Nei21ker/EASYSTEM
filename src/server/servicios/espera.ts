// Venta EN ESPERA (Local Vidrios): un promotor apurado se lleva el vidrio «prestado» y vuelve a pagar. Quien atiende deja el carrito
// en espera con un toque (queda como mercancía pendiente del promotor, con sus productos) y sigue con el siguiente cliente; cuando
// el promotor regresa se retoma desde el POS (o desde Pendientes → «Cobrar ahora») y se cobra como una venta normal, con su cobro,
// su comisión y su entrada al cuadre.
//   · Es el MISMO registro que la mercancía pendiente de Pendientes (`pendientes`, tipo MERCANCIA con `items`): una sola lista.
//   · Mientras está en espera el stock queda RESERVADO a nivel de pantalla (el POS resta lo reservado de lo que ofrece): no es un
//     bloqueo en la base, los movimientos de stock siguen siendo la única fuente de verdad.
//   · Al cobrar, `guardarVenta` (con `espera_id`) cierra el pendiente en el MISMO lote que la venta, sin mover stock una segunda vez.
// Permisos (matriz en tests/server/matriz-roles.test.ts): administrador, gerente, encargado y vendedor del local (el técnico y el contador no).
import { alcanceDe, condicionAlcance, localAccesible, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { nuevoId, redondear2 } from '../util';
import { consultarPendientes } from './pendientes';
import { descripcionDePendiente, normalizarItemsPendiente } from '../../utils/pendienteItems';
import type { NuevaEspera, Pendiente, PendienteItem } from '../../types/database.types';

const ahora = () => new Date().toISOString();

function exigirRolDeVenta(sesion: Sesion): void {
  if (sesion.rol === 'tecnico' || sesion.rol === 'contador') throw new ErrorApi(403, 'Tu rol no tiene permiso para dejar ventas en espera.', 'sin_permiso');
}

/** Las ventas en espera de un local (o de los que ve quien consulta): mercancía pendiente abierta con productos del inventario. */
export async function listarEspera(env: Entorno, sesion: Sesion, localId?: string): Promise<Pendiente[]> {
  exigirRolDeVenta(sesion);
  const alcance = await alcanceDe(env, sesion, localId);
  return consultarPendientes(env, alcance, { estado: 'PENDIENTE', tipo: 'MERCANCIA', soloConProductos: true });
}

/** Unidades de cada producto que están reservadas por ventas en espera de ese local (menos la que se excluye). */
export async function reservadoPorEspera(env: Entorno, localId: string, excluirId?: string): Promise<Map<string, number>> {
  const filas = await env.DB
    .prepare("SELECT id, items FROM pendientes WHERE local_id = ? AND tipo = 'MERCANCIA' AND estado = 'PENDIENTE' AND items IS NOT NULL")
    .bind(localId)
    .all<{ id: string; items: string }>();
  const reservado = new Map<string, number>();
  for (const f of filas.results) {
    if (f.id === excluirId) continue;
    let items: PendienteItem[] = [];
    try {
      items = JSON.parse(f.items) as PendienteItem[];
    } catch {
      continue;
    }
    for (const i of items) reservado.set(i.producto_id, (reservado.get(i.producto_id) ?? 0) + i.cantidad);
  }
  return reservado;
}

/** Deja el carrito en espera: guarda los productos como mercancía pendiente (sin tocar el stock) y los reserva. */
export async function crearEspera(env: Entorno, sesion: Sesion, datos: NuevaEspera): Promise<Pendiente> {
  exigirRolDeVenta(sesion);
  if (!(await localAccesible(env, sesion, datos.localId))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  const local = await env.DB.prepare('SELECT tipo FROM locales WHERE id = ?').bind(datos.localId).first<{ tipo: string }>();
  if (local?.tipo !== 'vidrios') throw new ErrorApi(400, 'Por ahora las ventas en espera solo se usan en el Local Vidrios.', 'solo_vidrios');

  let lista: { producto_id: string; cantidad: number }[];
  try {
    lista = normalizarItemsPendiente(datos.items);
  } catch (err) {
    throw new ErrorApi(400, err instanceof Error ? err.message : 'Los productos no son válidos.', 'datos_invalidos');
  }
  if (lista.length === 0) throw new ErrorApi(400, 'El carrito está vacío: no hay nada que dejar en espera.', 'datos_invalidos');
  const quien = (datos.promotor_nombre ?? '').trim().replace(/\s+/g, ' ');
  if (quien.length > 80) throw new ErrorApi(400, 'El nombre del promotor es muy largo (máximo 80 caracteres).', 'datos_invalidos');
  const nota = (datos.nota ?? '').trim().replace(/\s+/g, ' ');
  if (nota.length > 200) throw new ErrorApi(400, 'La nota es muy larga (máximo 200 caracteres).', 'datos_invalidos');

  // Cada producto debe existir y alcanzar: lo que hay en el local menos lo ya reservado por otras ventas en espera
  const reservado = await reservadoPorEspera(env, datos.localId);
  const items: PendienteItem[] = [];
  for (const l of lista) {
    const fila = await env.DB
      .prepare(
        `SELECT p.id, p.nombre, p.referencia, p.codigo_barras, p.precio_venta, COALESCE(inv.stock_actual, 0) AS stock
           FROM productos p LEFT JOIN inventario_local inv ON inv.producto_id = p.id AND inv.local_id = ? WHERE p.id = ?`
      )
      .bind(datos.localId, l.producto_id)
      .first<{ id: string; nombre: string; referencia: string | null; codigo_barras: string; precio_venta: number; stock: number }>();
    if (!fila) throw new ErrorApi(400, 'Uno de los productos del carrito ya no existe en el inventario.', 'datos_invalidos');
    const libre = fila.stock - (reservado.get(fila.id) ?? 0);
    if (l.cantidad > libre) {
      throw new ErrorApi(409, `De «${fila.nombre}» solo quedan ${Math.max(0, libre)} sin reservar en este local.`, 'stock_insuficiente');
    }
    items.push({ producto_id: fila.id, nombre: fila.nombre, codigo: fila.referencia ?? fila.codigo_barras, cantidad: l.cantidad, precio_unitario: redondear2(fila.precio_venta) });
  }
  const monto = redondear2(items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0));
  const descripcion = descripcionDePendiente(items, nota ? `En espera: ${nota}` : 'En espera desde el POS').slice(0, 500);

  const id = nuevoId();
  const db = env.DB;
  await db.batch([
    db
      .prepare(
        `INSERT INTO pendientes (id, local_id, tipo, promotor_id, promotor_cedula, promotor_nombre, promotor_telefono, promotor_banco, descripcion, monto_usd, creado_por, creado_por_nombre, fecha, items)
         VALUES (?, ?, 'MERCANCIA', NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, datos.localId, quien || null, descripcion, monto, sesion.userId, sesion.nombre, ahora(), JSON.stringify(items)),
    ...sentenciasCambio(db, ['pendientes'], datos.localId),
  ]);
  const creada = (await listarEspera(env, sesion, datos.localId)).find((x) => x.id === id);
  return creada!;
}

/** Suelta una venta en espera (el promotor no volvió o fue un error): deja de reservar el stock. No mueve nada. */
export async function liberarEspera(env: Entorno, sesion: Sesion, id: string): Promise<{ id: string; estado: 'ANULADO' }> {
  exigirRolDeVenta(sesion);
  const alcance = await alcanceDe(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'x.local_id');
  // Fuera del alcance se responde igual que si no existiera: no se pueden tantear ids de otros locales
  const fila = await env.DB
    .prepare(`SELECT x.id, x.local_id, x.estado FROM pendientes x WHERE x.id = ? AND x.tipo = 'MERCANCIA' AND x.items IS NOT NULL AND ${sql}`)
    .bind(id, ...valores)
    .first<{ id: string; local_id: string; estado: string }>();
  if (!fila) throw new ErrorApi(404, 'La venta en espera no existe.', 'no_existe');
  if (fila.estado !== 'PENDIENTE') throw new ErrorApi(409, 'Esa venta en espera ya se cerró.', 'espera_cerrada');
  const db = env.DB;
  const [r] = await db.batch([
    db
      .prepare("UPDATE pendientes SET estado = 'ANULADO', cerrado_en = ?, cerrado_por_nombre = ?, nota_cierre = 'Liberada desde el POS' WHERE id = ? AND estado = 'PENDIENTE'")
      .bind(ahora(), sesion.nombre, id),
    ...sentenciasCambio(db, ['pendientes'], fila.local_id),
  ]);
  if (!r.meta.changes) throw new ErrorApi(409, 'Otra persona acaba de cerrar esa venta en espera.', 'espera_cerrada');
  return { id, estado: 'ANULADO' };
}
