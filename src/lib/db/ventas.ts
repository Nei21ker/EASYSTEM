import { api } from '../api';
import type { AutorizacionCodigo, AutorizacionPrecio, DatosPromotor, ModoPrecio, NuevaVenta, ResultadoEliminacionVentas, ResultadoReseteoReportes, ResultadoReseteoVentas, Venta } from '../../types/database.types';

/** Guarda el registro de una venta. El folio y el vendedor los pone el servidor (el vendedor sale de la sesión). */
export async function insertarVenta(venta: NuevaVenta): Promise<Venta> {
  return api.post<Venta>('/api/ventas', venta);
}

/** Pide la autorización de un supervisor (correo + contraseña) para vender a un precio mayor al del catálogo (precio de promotor). */
export async function autorizarPrecio(pedido: {
  email?: string;
  clave?: string;
  local_id: string;
  promotor?: DatosPromotor | null;
  modo?: ModoPrecio;
  lineas: { producto_id: string; precio: number }[];
}): Promise<AutorizacionPrecio> {
  return api.post<AutorizacionPrecio>('/api/ventas/autorizar-precio', pedido);
}

/** Pide la autorización de un supervisor (correo + contraseña) para elegir a mano el código de las unidades de un producto. */
export async function autorizarCodigoManual(pedido: { email?: string; clave: string; local_id: string; producto_id: string }): Promise<AutorizacionCodigo> {
  return api.post<AutorizacionCodigo>('/api/ventas/autorizar-codigo', pedido);
}

/** Pide la clave de un gerente o administrador para botar 3 o más piezas defectuosas en una venta (productos por cantidad). */
export async function autorizarDanados(pedido: { email?: string; clave: string; local_id: string; cantidad: number }): Promise<AutorizacionCodigo> {
  return api.post<AutorizacionCodigo>('/api/ventas/autorizar-danados', pedido);
}

/** Ventas recientes (más nuevas primero), opcionalmente dentro de un rango de fechas. El vendedor solo recibe las suyas. */
export async function listarVentas(opciones: { desde?: Date; hasta?: Date; limite: number; localId?: string | null }): Promise<Venta[]> {
  return api.get<Venta[]>('/api/ventas', {
    desde: opciones.desde?.toISOString(),
    hasta: opciones.hasta?.toISOString(),
    limite: opciones.limite,
    localId: opciones.localId,
  });
}

/** Deja los reportes en cero: borra ventas, devoluciones y movimientos de compra/venta, sin tocar el stock (solo el administrador). */
export async function resetearReportes(opciones: { simular?: boolean }): Promise<ResultadoReseteoReportes> {
  return api.post<ResultadoReseteoReportes>('/api/reportes/resetear', { simular: opciones.simular ?? false });
}

/** Elimina las ventas elegidas, devuelve sus piezas al stock y las quita de los reportes (administrador y gerente). Con `simular` solo cuenta. */
export async function eliminarVentas(ids: string[], opciones: { simular?: boolean }): Promise<ResultadoEliminacionVentas> {
  return api.post<ResultadoEliminacionVentas>('/api/ventas/eliminar', { ids, simular: opciones.simular ?? false });
}

/** Borra todas las ventas y devoluciones y devuelve al stock las piezas vendidas (solo el administrador). Con `simular` solo cuenta. */
export async function resetearVentas(opciones: { simular?: boolean }): Promise<ResultadoReseteoVentas> {
  return api.post<ResultadoReseteoVentas>('/api/ventas/resetear', { simular: opciones.simular ?? false });
}
