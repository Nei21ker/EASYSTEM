// Acceso al servidor del módulo de Inversión (compras y pérdidas anotadas a mano, y proveedores). Solo lo usa inventoryService.ts.
import { api } from '../api';
import type { DatosInversion, DatosProveedor, Inversion, Proveedor, ProveedorResumen, TipoInversion } from '../../types/database.types';

export const listarInversiones = (opciones: { desde?: string; hasta?: string; localId?: string | null; tipo?: TipoInversion; limite?: number } = {}) => api.get<Inversion[]>('/api/inversiones', opciones);

export const crearInversion = (datos: DatosInversion) => api.post<Inversion>('/api/inversiones', datos);

export const actualizarInversion = (id: string, datos: DatosInversion) => api.put<Inversion>(`/api/inversiones/${encodeURIComponent(id)}`, datos);

export const eliminarInversion = (id: string) => api.delete<{ ok: true }>(`/api/inversiones/${encodeURIComponent(id)}`);

export const listarProveedores = () => api.get<ProveedorResumen[]>('/api/proveedores');

export const crearProveedor = (datos: DatosProveedor) => api.post<Proveedor>('/api/proveedores', datos);

export const actualizarProveedor = (id: string, datos: DatosProveedor) => api.put<Proveedor>(`/api/proveedores/${encodeURIComponent(id)}`, datos);

export const eliminarProveedor = (id: string) => api.delete<{ ok: true }>(`/api/proveedores/${encodeURIComponent(id)}`);
