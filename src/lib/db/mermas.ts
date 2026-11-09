// Acceso al servidor de las mermas (piezas botadas de productos por cantidad). Solo lo usa inventoryService.ts.
import { api } from '../api';
import type { Merma, MotivoMerma } from '../../types/database.types';

export const listarMermas = (opciones: { desde?: string; hasta?: string; localId?: string | null; limite?: number } = {}) => api.get<Merma[]>('/api/mermas', opciones);

export const darDeBajaPorCantidad = (datos: { productoId: string; localId: string; cantidad: number; motivo?: MotivoMerma | null; nota?: string | null }) =>
  api.post<{ movimiento: unknown }>('/api/mermas', datos);
