// Pendientes con promotores (migración 0018): lo que queda por cobrar o pagar.
//   · MERCANCIA: el promotor se llevó mercancía y vendrá a pagarla. Lo anota el encargado (o gerente/administrador) con lo que debe.
//     Se pueden elegir productos del inventario (`items`): quedan EN ESPERA (no tocan el stock) y, al marcar el pendiente como pagado,
//     se descuentan del inventario del local con una SALIDA por producto (si no alcanza el stock, no se cierra).
//   · COMISION : un promotor trajo un cliente y se le debe la comisión de la venta. La crea sola `guardarVenta` (precio de promotor).
// Estados: PENDIENTE → PAGADO (se pagó) o ANULADO (se creó por error). Un pendiente cerrado no se vuelve a abrir.
// Permisos (el servicio los vuelve a exigir; matriz en tests/server/matriz-roles.test.ts):
//   · ver: administrador, gerente y encargado (su local); el contador ve los de la nómina;
//   · crear mercancía y cerrar mercancía: administrador, gerente y encargado de ese local;
//   · pagar una comisión: administrador, gerente y contador (el pago de promotores es de nómina); anularla: administrador y gerente.
import { condicionAlcance, esGerencia, localAccesible, type Alcance, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { limiteSeguro, nuevoId, redondear2 } from '../util';
import { alcanceDePendientes } from './promotores';
import { registrarMovimientos } from './movimientos';
import { descripcionDePendiente, leerItemsPendiente, normalizarItemsPendiente } from '../../utils/pendienteItems';
import type { EstadoPendiente, NuevoPendienteMercancia, Pendiente, PendienteItem, TipoPendiente } from '../../types/database.types';

const ahora = () => new Date().toISOString();

// Los datos del promotor salen del directorio cuando está registrado (así un banco corregido vale para lo que aún se debe); si no, de la
// copia que se anotó al crear el pendiente.
const SELECCION = `
  x.id, x.local_id, x.tipo, x.promotor_id,
  COALESCE(p.cedula, x.promotor_cedula) AS promotor_cedula,
  CASE WHEN p.id IS NOT NULL THEN trim(p.nombre || ' ' || p.apellido) ELSE x.promotor_nombre END AS promotor_nombre,
  COALESCE(p.telefono, x.promotor_telefono) AS promotor_telefono,
  COALESCE(p.banco, x.promotor_banco) AS promotor_banco,
  x.descripcion, x.monto_usd, x.estado, x.venta_id, x.venta_folio, x.creado_por_nombre, x.fecha, x.cerrado_en, x.cerrado_por_nombre, x.nota_cierre, x.items`;
const DESDE = 'FROM pendientes x LEFT JOIN promotores p ON p.id = x.promotor_id';

type FilaPendiente = Omit<Pendiente, 'items'> & { items: string | null };
const aPendiente = (f: FilaPendiente): Pendiente => ({ ...f, monto_usd: redondear2(f.monto_usd), items: leerItemsPendiente(f.items) });

export async function listarPendientes(
  env: Entorno,
  sesion: Sesion,
  opciones: { estado?: EstadoPendiente; tipo?: TipoPendiente; promotorId?: string; localId?: string; limite?: number } = {}
): Promise<Pendiente[]> {
  return consultarPendientes(env, await alcanceDePendientes(env, sesion, opciones.localId), opciones);
}

/** La consulta de pendientes con un alcance ya resuelto (la comparten Pendientes y las ventas en espera del POS). */
export async function consultarPendientes(
  env: Entorno,
  alcance: Alcance,
  opciones: { estado?: EstadoPendiente; tipo?: TipoPendiente; promotorId?: string; limite?: number; soloConProductos?: boolean } = {}
): Promise<Pendiente[]> {
  const { sql, valores } = condicionAlcance(alcance, 'x.local_id');
  const condiciones = [sql];
  const params: unknown[] = [...valores];
  if (opciones.estado) {
    condiciones.push('x.estado = ?');
    params.push(opciones.estado);
  }
  if (opciones.tipo) {
    condiciones.push('x.tipo = ?');
    params.push(opciones.tipo);
  }
  if (opciones.promotorId) {
    condiciones.push('x.promotor_id = ?');
    params.push(opciones.promotorId);
  }
  if (opciones.soloConProductos) condiciones.push('x.items IS NOT NULL');
  const filas = await env.DB
    .prepare(`SELECT ${SELECCION} ${DESDE} WHERE ${condiciones.join(' AND ')} ORDER BY x.fecha DESC, x.rowid DESC LIMIT ?`)
    .bind(...params, limiteSeguro(opciones.limite, 500, 3000))
    .all<FilaPendiente>();
  return filas.results.map(aPendiente);
}

async function pendienteDelAlcance(env: Entorno, sesion: Sesion, id: string): Promise<Pendiente> {
  const alcance = await alcanceDePendientes(env, sesion);
  const { sql, valores } = condicionAlcance(alcance, 'x.local_id');
  // Fuera del alcance se responde igual que si no existiera: no se pueden tantear ids de otros locales
  const fila = await env.DB.prepare(`SELECT ${SELECCION} ${DESDE} WHERE x.id = ? AND ${sql}`).bind(id, ...valores).first<FilaPendiente>();
  if (!fila) throw new ErrorApi(404, 'El pendiente no existe.', 'no_existe');
  return aPendiente(fila);
}

/** Anota la mercancía que un promotor se llevó y que luego vendrá a pagar. */
export async function crearPendienteMercancia(env: Entorno, sesion: Sesion, datos: NuevoPendienteMercancia): Promise<Pendiente> {
  if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Solo el administrador, el gerente o el encargado anotan pendientes.', 'sin_permiso');
  if (!(await localAccesible(env, sesion, datos.localId))) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  // Productos del inventario (en espera): se guardan con su nombre y su precio de catálogo de hoy
  let lista: { producto_id: string; cantidad: number }[];
  try {
    lista = normalizarItemsPendiente(datos.items);
  } catch (err) {
    throw new ErrorApi(400, err instanceof Error ? err.message : 'Los productos no son válidos.', 'datos_invalidos');
  }
  const items: PendienteItem[] = [];
  for (const l of lista) {
    const prod = await env.DB
      .prepare('SELECT id, nombre, referencia, codigo_barras, precio_venta FROM productos WHERE id = ?')
      .bind(l.producto_id)
      .first<{ id: string; nombre: string; referencia: string | null; codigo_barras: string; precio_venta: number }>();
    if (!prod) throw new ErrorApi(400, 'Uno de los productos elegidos ya no existe en el inventario.', 'datos_invalidos');
    items.push({ producto_id: prod.id, nombre: prod.nombre, codigo: prod.referencia ?? prod.codigo_barras, cantidad: l.cantidad, precio_unitario: redondear2(prod.precio_venta) });
  }
  const descripcion = descripcionDePendiente(items, datos.descripcion ?? '');
  if (descripcion.length < 3) throw new ErrorApi(400, 'Elige qué productos se llevó o descríbelo (mínimo 3 caracteres).', 'datos_invalidos');
  if (descripcion.length > 500) throw new ErrorApi(400, 'Es demasiado texto para una sola nota (máximo 500 caracteres): divide la mercancía en dos pendientes.', 'datos_invalidos');
  if (!Number.isFinite(datos.monto_usd) || datos.monto_usd <= 0 || datos.monto_usd > 1_000_000) throw new ErrorApi(400, 'El monto que debe pagar debe ser mayor a 0.', 'datos_invalidos');
  const promotor = await env.DB
    .prepare('SELECT id, cedula, nombre, apellido, telefono, banco FROM promotores WHERE id = ?')
    .bind(datos.promotorId)
    .first<{ id: string; cedula: string; nombre: string; apellido: string; telefono: string | null; banco: string | null }>();
  if (!promotor) throw new ErrorApi(400, 'Elige un promotor de la lista, o agrégalo primero.', 'datos_invalidos');

  const id = nuevoId();
  const db = env.DB;
  await db.batch([
    db
      .prepare(
        `INSERT INTO pendientes (id, local_id, tipo, promotor_id, promotor_cedula, promotor_nombre, promotor_telefono, promotor_banco, descripcion, monto_usd, creado_por, creado_por_nombre, fecha, items)
         VALUES (?, ?, 'MERCANCIA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, datos.localId, promotor.id, promotor.cedula, `${promotor.nombre} ${promotor.apellido}`.trim(), promotor.telefono, promotor.banco, descripcion, redondear2(datos.monto_usd), sesion.userId, sesion.nombre, ahora(), items.length > 0 ? JSON.stringify(items) : null),
    ...sentenciasCambio(db, ['pendientes'], datos.localId),
  ]);
  return pendienteDelAlcance(env, sesion, id);
}

/** Quién puede cerrar (pagar o anular) un pendiente según su tipo. */
function puedeCerrar(sesion: Sesion, tipo: TipoPendiente, accion: 'pagar' | 'anular'): boolean {
  if (tipo === 'MERCANCIA') return esGerencia(sesion.rol);
  if (accion === 'pagar') return sesion.rol === 'administrador' || sesion.rol === 'gerente' || sesion.rol === 'contador';
  return sesion.rol === 'administrador' || sesion.rol === 'gerente';
}

/** Marca un pendiente como pagado (la mercancía se pagó / la comisión se pagó) o lo anula (fue un error). */
export async function cerrarPendiente(env: Entorno, sesion: Sesion, id: string, accion: 'pagar' | 'anular', notaTexto?: string | null): Promise<Pendiente> {
  const pendiente = await pendienteDelAlcance(env, sesion, id);
  if (!puedeCerrar(sesion, pendiente.tipo, accion)) {
    throw new ErrorApi(
      403,
      pendiente.tipo === 'COMISION' ? 'Las comisiones las paga el gerente, el administrador o el contador desde Nómina; anularlas, solo el gerente o el administrador.' : 'No puedes cambiar este pendiente.',
      'sin_permiso'
    );
  }
  const nota = (notaTexto ?? '').trim().replace(/\s+/g, ' ');
  if (nota.length > 300) throw new ErrorApi(400, 'La nota es muy larga (máximo 300 caracteres).', 'datos_invalidos');
  if (pendiente.estado !== 'PENDIENTE') throw new ErrorApi(409, `Este pendiente ya está ${pendiente.estado === 'PAGADO' ? 'pagado' : 'anulado'}.`, 'pendiente_cerrado');

  // Cobrar mercancía con productos del inventario: antes de cerrar se comprueba que haya stock en el local (si no, queda pendiente)
  const descontar = accion === 'pagar' && pendiente.tipo === 'MERCANCIA' && (pendiente.items?.length ?? 0) > 0;
  if (descontar) await comprobarStockDelPendiente(env, pendiente);

  const db = env.DB;
  const [resultado] = await db.batch([
    db
      .prepare("UPDATE pendientes SET estado = ?, cerrado_en = ?, cerrado_por_nombre = ?, nota_cierre = ? WHERE id = ? AND estado = 'PENDIENTE'")
      .bind(accion === 'pagar' ? 'PAGADO' : 'ANULADO', ahora(), sesion.nombre, nota || null, id),
    ...sentenciasCambio(db, ['pendientes'], pendiente.local_id),
  ]);
  if (!resultado.meta.changes) throw new ErrorApi(409, 'Otra persona acaba de cerrar este pendiente.', 'pendiente_cerrado');

  if (descontar) {
    // Ya quedó cobrado (nadie más puede cobrarlo dos veces): ahora sale del inventario. Si eso falla, vuelve a quedar en espera.
    try {
      await registrarMovimientos(
        env,
        sesion,
        pendiente.items!.map((i) => ({
          productoId: i.producto_id,
          tipo: 'SALIDA' as const,
          cantidad: i.cantidad,
          localId: pendiente.local_id,
          motivo: `Mercancía de promotor cobrada${pendiente.promotor_nombre ? ` (${pendiente.promotor_nombre})` : ''}`,
        }))
      );
    } catch (err) {
      await db.batch([
        db.prepare("UPDATE pendientes SET estado = 'PENDIENTE', cerrado_en = NULL, cerrado_por_nombre = NULL, nota_cierre = NULL WHERE id = ? AND estado = 'PAGADO'").bind(id),
        ...sentenciasCambio(db, ['pendientes'], pendiente.local_id),
      ]);
      throw err;
    }
  }
  return pendienteDelAlcance(env, sesion, id);
}

/** Que cada producto de la mercancía exista y tenga stock suficiente en el local del pendiente; si no, 409 diciendo cuál falta. */
async function comprobarStockDelPendiente(env: Entorno, pendiente: Pendiente): Promise<void> {
  for (const i of pendiente.items ?? []) {
    const fila = await env.DB
      .prepare('SELECT p.id, COALESCE(inv.stock_actual, 0) AS stock FROM productos p LEFT JOIN inventario_local inv ON inv.producto_id = p.id AND inv.local_id = ? WHERE p.id = ?')
      .bind(pendiente.local_id, i.producto_id)
      .first<{ id: string; stock: number }>();
    if (!fila) {
      throw new ErrorApi(409, `«${i.nombre}» ya no existe en el inventario: no se puede descontar. Anula este pendiente y anota uno nuevo.`, 'producto_no_existe');
    }
    if (fila.stock < i.cantidad) {
      throw new ErrorApi(
        409,
        `No alcanza el stock para marcarla cobrada: de «${i.nombre}» el promotor se llevó ${i.cantidad} y en este local hay ${fila.stock}. Ingresa la mercancía o corrige el stock y vuelve a intentarlo.`,
        'stock_insuficiente'
      );
    }
  }
}

/** Ata a un promotor registrado un pendiente que se creó sin sus datos (p. ej. una comisión cuya venta no anotó la cédula). */
export async function asignarPromotorAPendiente(env: Entorno, sesion: Sesion, id: string, promotorId: string): Promise<Pendiente> {
  const pendiente = await pendienteDelAlcance(env, sesion, id);
  const permitido = pendiente.tipo === 'COMISION' ? sesion.rol !== 'vendedor' && sesion.rol !== 'tecnico' : esGerencia(sesion.rol);
  if (!permitido) throw new ErrorApi(403, 'No puedes cambiar este pendiente.', 'sin_permiso');
  if (pendiente.estado !== 'PENDIENTE') throw new ErrorApi(409, 'Solo se puede cambiar el promotor de un pendiente abierto.', 'pendiente_cerrado');
  const promotor = await env.DB
    .prepare('SELECT id, cedula, nombre, apellido, telefono, banco FROM promotores WHERE id = ?')
    .bind(promotorId)
    .first<{ id: string; cedula: string; nombre: string; apellido: string; telefono: string | null; banco: string | null }>();
  if (!promotor) throw new ErrorApi(400, 'Elige un promotor de la lista, o agrégalo primero.', 'datos_invalidos');
  const db = env.DB;
  await db.batch([
    db
      .prepare("UPDATE pendientes SET promotor_id = ?, promotor_cedula = ?, promotor_nombre = ?, promotor_telefono = ?, promotor_banco = ? WHERE id = ? AND estado = 'PENDIENTE'")
      .bind(promotor.id, promotor.cedula, `${promotor.nombre} ${promotor.apellido}`.trim(), promotor.telefono, promotor.banco, id),
    ...sentenciasCambio(db, ['pendientes'], pendiente.local_id),
  ]);
  return pendienteDelAlcance(env, sesion, id);
}

// --- Lo que usa el registro de ventas ---------------------------------------------------------------------------
/**
 * Sentencias que anotan la comisión de una venta con precio de promotor y, si se dio la cédula, dejan al promotor en el directorio
 * (o completan lo que le faltaba, sin pisar con vacíos). Van dentro del MISMO lote que inserta la venta: si la venta falla, no
 * queda ni comisión ni promotor. Lleva `venta_folio` del contador que ya se subió en ese lote.
 */
export function sentenciasComisionPromotor(
  db: D1Database,
  sesion: Sesion,
  d: {
    ventaId: string;
    localId: string;
    comision: number;
    descripcion: string;
    promotor: { cedula: string | null; nombre: string | null; nombrePropio: string; apellido: string; telefono: string | null; banco: string | null };
  }
): D1PreparedStatement[] {
  const marca = ahora();
  const { promotor: p } = d;
  const sentencias: D1PreparedStatement[] = [];
  if (p.cedula) {
    sentencias.push(
      db
        .prepare(
          `INSERT INTO promotores (id, cedula, nombre, apellido, telefono, banco, creado_por_nombre, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (cedula) DO UPDATE SET
             nombre = CASE WHEN excluded.nombre <> '' THEN excluded.nombre ELSE promotores.nombre END,
             apellido = CASE WHEN excluded.apellido <> '' THEN excluded.apellido ELSE promotores.apellido END,
             telefono = COALESCE(excluded.telefono, promotores.telefono),
             banco = COALESCE(excluded.banco, promotores.banco),
             updated_at = excluded.updated_at`
        )
        .bind(nuevoId(), p.cedula, p.nombrePropio, p.apellido, p.telefono, p.banco, sesion.nombre, marca, marca)
    );
  }
  sentencias.push(
    db
      .prepare(
        `INSERT INTO pendientes (id, local_id, tipo, promotor_id, promotor_cedula, promotor_nombre, promotor_telefono, promotor_banco, descripcion, monto_usd, venta_id, venta_folio, creado_por, creado_por_nombre, fecha)
         VALUES (?, ?, 'COMISION', (SELECT id FROM promotores WHERE cedula = ?), ?, ?, ?, ?, ?, ?, ?, (SELECT folio FROM ventas WHERE id = ?), ?, ?, ?)`
      )
      .bind(nuevoId(), d.localId, p.cedula, p.cedula, p.nombre, p.telefono, p.banco, d.descripcion.slice(0, 500), d.comision, d.ventaId, d.ventaId, sesion.userId, sesion.nombre, marca),
    ...sentenciasCambio(db, p.cedula ? ['pendientes', 'promotores'] : ['pendientes'], d.localId)
  );
  return sentencias;
}

/** Borra los pendientes abiertos (o anulados) que nacieron de esas ventas: si la venta desaparece, la comisión pendiente también. Los ya pagados se conservan. */
export function sentenciasBorrarComisiones(db: D1Database, ventaIds: string[]): D1PreparedStatement[] {
  const sentencias: D1PreparedStatement[] = [];
  for (let i = 0; i < ventaIds.length; i += 90) {
    const tramo = ventaIds.slice(i, i + 90);
    sentencias.push(db.prepare(`DELETE FROM pendientes WHERE tipo = 'COMISION' AND estado <> 'PAGADO' AND venta_id IN (${tramo.map(() => '?').join(', ')})`).bind(...tramo));
  }
  return sentencias;
}
