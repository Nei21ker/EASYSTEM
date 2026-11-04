import { api } from '../api';
import type { NuevaVenta, Venta } from '../../types/database.types';

/** Guarda el registro de una venta. El folio y el vendedor los pone el servidor (el vendedor sale de la sesión). */
export async function insertarVenta(venta: NuevaVenta): Promise<Venta> {
  return api.post<Venta>('/api/ventas', venta);
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
