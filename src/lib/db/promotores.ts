// Acceso al servidor del directorio de promotores y de los pendientes con ellos. Solo lo usa inventoryService.ts.
import { api } from '../api';
import type { DatosNuevoPromotor, EstadoPendiente, NuevoPendienteMercancia, Pendiente, Promotor, PromotorResumen, TipoPendiente } from '../../types/database.types';

export const buscarPromotorPorCedula = async (cedula: string): Promise<Promotor | null> => (await api.get<{ promotor: Promotor | null }>('/api/promotores', { cedula })).promotor;

/** Promotores registrados en un local (lista del cobro con precio de promotor) */
export const listarPromotoresDelLocal = (localId?: string | null) => api.get<Promotor[]>('/api/promotores', { para: 'venta', localId });

export const listarPromotores = (opciones: { localId?: string | null; buscar?: string } = {}) => api.get<PromotorResumen[]>('/api/promotores', opciones);

export const crearPromotor = (datos: DatosNuevoPromotor) => api.post<Promotor>('/api/promotores', datos);

export const actualizarPromotor = (id: string, datos: DatosNuevoPromotor) => api.put<Promotor>(`/api/promotores/${encodeURIComponent(id)}`, datos);

export const listarPendientes = (opciones: { estado?: EstadoPendiente; tipo?: TipoPendiente; promotorId?: string; localId?: string | null; limite?: number } = {}) =>
  api.get<Pendiente[]>('/api/pendientes', opciones);

export const crearPendienteMercancia = (datos: NuevoPendienteMercancia) => api.post<Pendiente>('/api/pendientes', datos);

export const cerrarPendiente = (id: string, accion: 'pagar' | 'anular', nota?: string | null) => api.post<Pendiente>(`/api/pendientes/${encodeURIComponent(id)}/cerrar`, { accion, nota: nota ?? null });

export const pagarComisionesPromotor = (promotorId: string, ids: string[], nota?: string | null) =>
  api.post<{ pagadas: number; total_usd: number }>(`/api/promotores/${encodeURIComponent(promotorId)}/pagar-comisiones`, { ids, nota: nota ?? null });

export const asignarPromotorAPendiente = (id: string, promotorId: string) => api.put<Pendiente>(`/api/pendientes/${encodeURIComponent(id)}/promotor`, { promotorId });
