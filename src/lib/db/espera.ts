// Acceso al servidor de las ventas en espera del POS (Local Vidrios). Solo lo usa inventoryService.ts.
import { api } from '../api';
import type { NuevaEspera, Pendiente } from '../../types/database.types';

export const listarEspera = (localId: string) => api.get<Pendiente[]>('/api/espera', { localId });

export const crearEspera = (datos: NuevaEspera) => api.post<Pendiente>('/api/espera', datos);

export const liberarEspera = (id: string) => api.post<{ id: string; estado: 'ANULADO' }>(`/api/espera/${encodeURIComponent(id)}/liberar`, {});
