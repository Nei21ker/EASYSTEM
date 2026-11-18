import { esGerencia, exigirRol, type Sesion } from '../authz';
import { sentenciasCambio } from '../cambios';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { registrarMovimientos, type EntradaMovimiento } from './movimientos';
import { obtenerOrden } from './ordenes';
import type { OrdenServicio, RepuestoDisponible, RepuestoOrden } from '../../types/database.types';
import { otroLocalDeRepuestos, permiteOrigenRepuesto } from '../../utils/origenRepuestos';

async function ordenEditable(env: Entorno, sesion: Sesion, id: string): Promise<OrdenServicio> {
  exigirRol(sesion, ['administrador', 'gerente', 'supervisor', 'encargado', 'vendedor']);
  const orden = await obtenerOrden(env, sesion, id);
  if (!orden) throw new ErrorApi(404, 'La orden no existe.', 'no_existe');
  if (orden.estado === 'entregado') throw new ErrorApi(409, 'La orden ya fue entregada.', 'orden_entregada');
  return orden;
}

async function disponibles(env: Entorno, localId: string): Promise<RepuestoDisponible[]> {
  const filas = await env.DB.prepare(`
    SELECT p.id, p.nombre, p.codigo_barras, p.referencia, p.categoria, p.precio_venta, i.stock_actual,
           l.id AS origen_local_id, l.nombre AS origen_local_nombre
    FROM inventario_local i JOIN productos p ON p.id = i.producto_id JOIN locales l ON l.id = i.local_id
    WHERE i.local_id IN (?, ?) AND i.stock_actual > 0
    ORDER BY (i.local_id = ?) DESC, p.nombre
  `).bind(localId, otroLocalDeRepuestos(localId), localId).all<RepuestoDisponible>();
  return filas.results.filter((p) => permiteOrigenRepuesto(localId, p.origen_local_id, p.categoria));
}

export async function listarRepuestosOrden(env: Entorno, sesion: Sesion, id: string) {
  const orden = await ordenEditable(env, sesion, id);
  return disponibles(env, orden.local_id);
}

export type CambioRepuesto =
  | { accion: 'agregar'; productoId: string; origen: string; cantidad: number }
  | { accion: 'escanear'; codigo: string }
  | { accion: 'quitar'; productoId: string; origen?: string };

export async function cambiarRepuestoOrden(env: Entorno, sesion: Sesion, id: string, cambio: CambioRepuesto): Promise<OrdenServicio> {
  const orden = await ordenEditable(env, sesion, id);
  const origenDe = (r: RepuestoOrden) => r.origen_local_id ?? orden.local_id;
  let repuestos: RepuestoOrden[];
  let movimiento: EntradaMovimiento;

  if (cambio.accion === 'quitar') {
    if (!esGerencia(sesion.rol)) throw new ErrorApi(403, 'Tu rol no puede devolver repuestos al inventario.', 'sin_permiso');
    const origen = cambio.origen ?? orden.local_id;
    const repuesto = orden.repuestos.find((r) => r.producto_id === cambio.productoId && origenDe(r) === origen);
    if (!repuesto) throw new ErrorApi(404, 'Ese repuesto no está en la orden.', 'no_existe');
    repuestos = orden.repuestos.filter((r) => r !== repuesto);
    movimiento = { productoId: repuesto.producto_id, cantidad: repuesto.cantidad, localId: origen, tipo: 'ENTRADA',
      unidadCodigos: repuesto.unidades, motivo: `Repuesto devuelto al inventario, orden de servicio #${orden.folio}` };
  } else {
    const catalogo = await disponibles(env, orden.local_id);
    let p: RepuestoDisponible | undefined;
    let unidad: string | undefined;
    if (cambio.accion === 'escanear') {
      const pieza = await env.DB.prepare("SELECT producto_id, local_id FROM unidades_producto WHERE codigo = ? AND estado = 'DISPONIBLE'")
        .bind(cambio.codigo).first<{ producto_id: string; local_id: string }>();
      if (pieza) {
        p = catalogo.find((r) => r.id === pieza.producto_id && r.origen_local_id === pieza.local_id);
        unidad = cambio.codigo;
      } else {
        p = catalogo.find((r) => r.codigo_barras === cambio.codigo || r.referencia === cambio.codigo);
      }
    } else {
      p = catalogo.find((r) => r.id === cambio.productoId && r.origen_local_id === cambio.origen);
    }
    if (!p) throw new ErrorApi(409, 'El repuesto no está disponible en los inventarios habilitados para esta orden.', 'repuesto_no_disponible');
    const cantidad = cambio.accion === 'agregar' ? cambio.cantidad : 1;
    const existente = orden.repuestos.find((r) => r.producto_id === p.id && origenDe(r) === p.origen_local_id);
    if ((existente?.cantidad ?? 0) + cantidad > 500) throw new ErrorApi(400, 'Máximo 500 unidades por repuesto y origen.', 'lote_grande');
    const siguiente: RepuestoOrden = {
      producto_id: p.id, nombre: p.nombre, codigo_barras: p.codigo_barras,
      precio_unitario: existente?.precio_unitario ?? p.precio_venta, cantidad: (existente?.cantidad ?? 0) + cantidad,
      origen_local_id: p.origen_local_id, origen_local_nombre: p.origen_local_nombre, unidades: existente?.unidades ?? [],
    };
    repuestos = [...orden.repuestos.filter((r) => r !== existente), siguiente];
    movimiento = { productoId: p.id, cantidad, localId: p.origen_local_id, tipo: 'SALIDA',
      unidadCodigos: unidad ? [unidad] : undefined, motivo: `Repuesto, orden de servicio #${orden.folio}` };
  }

  const db = env.DB;
  const unidadesPrevias = repuestos.at(-1)?.unidades ?? [];
  try {
    await registrarMovimientos(env, sesion, [movimiento], ([resultado]) => {
      const ultimo = repuestos.at(-1);
      if (movimiento.tipo === 'SALIDA' && ultimo) ultimo.unidades = [...unidadesPrevias, ...resultado.unidadCodigos];
      const totalRepuestos = repuestos.reduce((total, r) => total + r.cantidad * r.precio_unitario, 0);
      return [
        // Una orden borrada, entregada o editada durante el movimiento debe abortar el lote completo.
        db.prepare(`SELECT json(CASE WHEN EXISTS (
          SELECT 1 FROM ordenes_servicio WHERE id = ? AND estado <> 'entregado' AND json(repuestos) = json(?)
        ) THEN '[]' ELSE 'orden modificada' END)`).bind(id, JSON.stringify(orden.repuestos)),
        db.prepare('UPDATE ordenes_servicio SET repuestos = ?, total_usd = round(mano_de_obra_usd + ?, 2) WHERE id = ?')
          .bind(JSON.stringify(repuestos), totalRepuestos, id),
        ...sentenciasCambio(db, ['ordenes_servicio'], orden.local_id),
      ];
    }, movimiento.localId);
  } catch (err) {
    if (err instanceof Error && /malformed JSON/i.test(err.message)) {
      throw new ErrorApi(409, 'La orden cambió. Vuelve a abrirla antes de actualizar los repuestos.', 'orden_modificada');
    }
    throw err;
  }
  return (await obtenerOrden(env, sesion, id))!;
}
