// Acceso al servidor de los cambios de mercancía con otro local (Local Vidrios). Solo lo usa inventoryService.ts.
import { api } from '../api';
import type { EstadoIntercambio, Intercambio, NuevoIntercambio } from '../../types/database.types';

export const listarIntercambios = (filtro: { desde?: string; hasta?: string; estado?: EstadoIntercambio; localId?: string | null } = {}) =>
  api.get<Intercambio[]>('/api/intercambios', { desde: filtro.desde, hasta: filtro.hasta, estado: filtro.estado, local: filtro.localId ?? undefined });

export const crearIntercambio = (datos: NuevoIntercambio) => api.post<Intercambio>('/api/intercambios', datos);

export const completarIntercambio = (id: string) => api.post<Intercambio>(`/api/intercambios/${encodeURIComponent(id)}/completar`, {});

export const anularIntercambio = (id: string, nota?: string | null) => api.post<Intercambio>(`/api/intercambios/${encodeURIComponent(id)}/anular`, { nota: nota ?? null });
