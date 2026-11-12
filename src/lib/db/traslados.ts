// Acceso al servidor de los traslados entre locales y las bajas de piezas. Solo lo usa inventoryService.ts.
import { api } from '../api';
import type { EstadoTraslado, MotivoBaja, Traslado } from '../../types/database.types';

export interface DestinoTraslado {
  id: string;
  nombre: string;
  tipo: string;
  sede: string | null;
}

export const listarDestinos = () => api.get<DestinoTraslado[]>('/api/traslados/destinos');

export const listarTraslados = (estado?: EstadoTraslado) => api.get<Traslado[]>('/api/traslados', { estado });

export const despacharTraslado = (datos: { origenLocalId: string; destinoLocalId: string; codigos: string[]; cantidades?: { producto_id: string; cantidad: number }[]; notas?: string }) =>
  api.post<Traslado>('/api/traslados', datos);

export const recibirTraslado = (id: string, codigos: string[], cantidades: { producto_id: string; cantidad: number }[] = []) =>
  api.post<Traslado>(`/api/traslados/${encodeURIComponent(id)}/recibir`, { codigos, cantidades });

export const cerrarTraslado = (id: string) => api.post<Traslado>(`/api/traslados/${encodeURIComponent(id)}/cerrar`, {});

export const darDeBaja = (datos: { localId: string; codigos: string[]; motivo: MotivoBaja; nota?: string }) =>
  api.post<{ codigos: string[] }>('/api/bajas', datos);

export const revertirBaja = (codigos: string[]) => api.post<{ revertidas: number }>('/api/bajas/revertir', { codigos });
