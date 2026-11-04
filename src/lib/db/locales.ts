import { api } from '../api';
import type { Local } from '../../types/database.types';

/** Locales que el usuario puede ver (administrador, gerente y contador todos; el resto, el suyo). */
export async function listarLocales(): Promise<Local[]> {
  return api.get<Local[]>('/api/locales');
}
