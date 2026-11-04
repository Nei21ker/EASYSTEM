import { api } from '../api';
import type { NuevaTasa, TasaCambio } from '../../types/database.types';

/** La tasa vigente es la última registrada (null si todavía no hay ninguna). */
export async function obtenerUltimaTasa(): Promise<TasaCambio | null> {
  return (await api.get<{ tasa: TasaCambio | null }>('/api/tasas')).tasa;
}

/** Quién registra (registrado_por) lo pone el servidor con la sesión. */
export async function insertarTasa(tasa: NuevaTasa): Promise<TasaCambio> {
  return api.post<TasaCambio>('/api/tasas', { fecha: tasa.fecha, tasa: tasa.tasa, registrado_nombre: tasa.registrado_nombre ?? null });
}
