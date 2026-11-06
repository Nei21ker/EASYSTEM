import { api } from '../api';
import type { NuevaVenta, ResultadoReseteoReportes, ResultadoReseteoVentas, Venta } from '../../types/database.types';

/** Guarda el registro de una venta. El folio y el vendedor los pone el servidor (el vendedor sale de la sesión). */
export async function insertarVenta(venta: NuevaVenta): Promise<Venta> {
  return api.post<Venta>('/api/ventas', venta);
}

/** Sube la captura del pago móvil al almacenamiento privado ("comprobantes-pago-movil/<local>/<hora>-<n>.jpg"). Devuelve la ruta. */
export async function subirComprobantePagoMovil(localId: string, imagen: Blob): Promise<string> {
  const ruta = `comprobantes-pago-movil/${localId}/${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.jpg`;
  return api.subir(`/api/archivos/privado/${ruta}`, imagen, 'image/jpeg');
}

/** Borra una captura que no llegó a usarse (best-effort: si la venta falló). El servidor no deja borrar la de una venta registrada. */
export async function eliminarComprobantePagoMovil(ruta: string): Promise<void> {
  await api.delete(`/api/archivos/privado/${ruta}`);
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

/** Borra todas las ventas y devoluciones y devuelve al stock las piezas vendidas (solo el administrador). Con `simular` solo cuenta. */
export async function resetearVentas(opciones: { simular?: boolean }): Promise<ResultadoReseteoVentas> {
  return api.post<ResultadoReseteoVentas>('/api/ventas/resetear', { simular: opciones.simular ?? false });
}
