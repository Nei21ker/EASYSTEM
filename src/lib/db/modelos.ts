import { api } from '../api';
import type { ModeloTelefono } from '../../types/database.types';

export async function listarModelos(): Promise<ModeloTelefono[]> {
  return api.get<ModeloTelefono[]>('/api/modelos');
}

export async function crearModelo(modelo: Pick<ModeloTelefono, 'marca' | 'modelo'>): Promise<ModeloTelefono> {
  return api.post<ModeloTelefono>('/api/modelos', { marca: modelo.marca, modelo: modelo.modelo });
}

export async function eliminarModelo(id: string) {
  await api.delete(`/api/modelos/${encodeURIComponent(id)}`);
}
