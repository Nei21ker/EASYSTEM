import { api } from '../api';
import type { Devolucion, NuevaDevolucion } from '../../types/database.types';

/** Quién la registra (registrado_por) lo pone el servidor con la sesión. */
export async function insertarDevolucion(devolucion: NuevaDevolucion): Promise<Devolucion> {
  return api.post<Devolucion>('/api/devoluciones', devolucion);
}

export async function listarDevoluciones(opciones: { limite: number; ventaId?: string; localId?: string | null }): Promise<Devolucion[]> {
  return api.get<Devolucion[]>('/api/devoluciones', { limite: opciones.limite, ventaId: opciones.ventaId, localId: opciones.localId });
}
