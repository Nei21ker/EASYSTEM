import { api } from '../api';
import type { Local } from '../../types/database.types';
import type { DatosLocal } from '../../utils/local';

/** Locales que el usuario puede ver (administrador, gerente y contador todos; el resto, el suyo). */
export async function listarLocales(): Promise<Local[]> {
  return api.get<Local[]>('/api/locales');
}

/** Edita un local (solo administrador). */
export const actualizarLocal = (id: string, datos: DatosLocal) => api.patch<Local>(`/api/locales/${encodeURIComponent(id)}`, datos);

/** Agrega un local (solo administrador). */
export const crearLocal = (datos: DatosLocal) => api.post<Local>('/api/locales', datos);
