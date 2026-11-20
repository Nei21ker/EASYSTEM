import { api } from '../api';
import type { CambioRepuesto } from '../../server/servicios/repuestosOrden';
import type { RepuestoDisponible } from '../../types/database.types';
import type { CobroOrdenServicio, NuevaOrdenServicio, OrdenServicio, ResultadoPagoTecnico, ResultadoReseteoServicio, TecnicoDeLocal } from '../../types/database.types';

export async function listarOrdenes(opciones: { limite: number; localId?: string | null }): Promise<OrdenServicio[]> {
  return api.get<OrdenServicio[]>('/api/ordenes', { limite: opciones.limite, localId: opciones.localId });
}

export async function obtenerOrden(id: string): Promise<OrdenServicio | null> {
  try {
    return await api.get<OrdenServicio>(`/api/ordenes/${encodeURIComponent(id)}`);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/** El folio, quién registra y el total los pone el servidor. */
export async function insertarOrden(orden: NuevaOrdenServicio): Promise<OrdenServicio> {
  return api.post<OrdenServicio>('/api/ordenes', orden);
}

export async function actualizarOrden(id: string, cambios: Partial<OrdenServicio>): Promise<OrdenServicio> {
  // Solo estos campos se editan (el total se recalcula en el servidor con los repuestos y la mano de obra)
  const { diagnostico, estado, tecnico_id, tecnico_nombre, mano_de_obra_usd } = cambios;
  return api.patch<OrdenServicio>(`/api/ordenes/${encodeURIComponent(id)}`, { diagnostico, estado, tecnico_id, tecnico_nombre, mano_de_obra_usd });
}

export const listarRepuestos = (id: string) => api.get<RepuestoDisponible[]>(`/api/ordenes/${encodeURIComponent(id)}/repuestos`);
export const cambiarRepuesto = (id: string, cambio: CambioRepuesto) => api.post<OrdenServicio>(`/api/ordenes/${encodeURIComponent(id)}/repuestos`, cambio);

/** Cobra la reparación: el servidor calcula el reparto entre la tienda y el técnico y deja la orden entregada. */
export async function cobrarOrden(id: string, cobro: CobroOrdenServicio): Promise<OrdenServicio> {
  return api.post<OrdenServicio>(`/api/ordenes/${encodeURIComponent(id)}/cobrar`, cobro);
}

/** Marca como pagada la parte del técnico de las órdenes elegidas. */
export async function pagarTecnicos(ids: string[]): Promise<ResultadoPagoTecnico> {
  return api.post<ResultadoPagoTecnico>('/api/ordenes/pagar-tecnico', { ids });
}

/** Técnicos activos de un local (a quienes se les puede dar un trabajo). */
export async function listarTecnicos(localId: string | null): Promise<TecnicoDeLocal[]> {
  return api.get<TecnicoDeLocal[]>('/api/ordenes/tecnicos', { localId });
}

/** Borra las órdenes de servicio de UN local y devuelve sus repuestos al inventario (solo el administrador). Con `simular` solo cuenta. */
export async function resetearServicioTecnico(opciones: { localId: string; simular?: boolean }): Promise<ResultadoReseteoServicio> {
  return api.post<ResultadoReseteoServicio>('/api/ordenes/resetear', { local_id: opciones.localId, simular: opciones.simular ?? false });
}

export function eliminarOrdenes(localId: string, ids: string[]) {
  return api.post<{ eliminadas: number }>('/api/ordenes/eliminar-lote', { local_id: localId, ids });
}
