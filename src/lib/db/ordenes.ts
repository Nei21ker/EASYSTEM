import { api } from '../api';
import type { NuevaOrdenServicio, OrdenServicio } from '../../types/database.types';

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
  const { diagnostico, estado, tecnico_id, tecnico_nombre, repuestos, mano_de_obra_usd } = cambios;
  return api.patch<OrdenServicio>(`/api/ordenes/${encodeURIComponent(id)}`, { diagnostico, estado, tecnico_id, tecnico_nombre, repuestos, mano_de_obra_usd });
}
