import { api } from '../api';
import type { Empleado, LineaReventa, NuevoEmpleado, Nomina, ProductoReventa } from '../../types/database.types';

/** Empleados de todos los locales a los que el usuario tiene acceso (administrador, gerente y contador). */
export async function listarEmpleados(): Promise<Empleado[]> {
  return api.get<Empleado[]>('/api/nomina/empleados');
}

export async function crearEmpleado(datos: NuevoEmpleado): Promise<Empleado> {
  return api.post<Empleado>('/api/nomina/empleados', datos);
}

/** La fila de nómina de un promotor del directorio (la crea si no existe): hace falta para armarle la lista y pagarle el día. */
export async function asegurarEmpleadoPromotor(promotorId: string, localId: string): Promise<Empleado> {
  return api.post<Empleado>('/api/nomina/empleados/promotor', { promotorId, localId });
}

export async function actualizarEmpleado(id: string, cambios: Partial<NuevoEmpleado>): Promise<Empleado> {
  return api.patch<Empleado>(`/api/nomina/empleados/${encodeURIComponent(id)}`, cambios);
}

/** Pagos cuyo período cae dentro del rango dado ("aaaa-mm-dd"). */
export async function listarNominas(periodoInicio: string, periodoFin: string): Promise<Nomina[]> {
  return api.get<Nomina[]>('/api/nomina/nominas', { desde: periodoInicio, hasta: periodoFin });
}

export type DatosNomina = Pick<Nomina, 'empleado_id' | 'local_id' | 'periodo_inicio' | 'periodo_fin' | 'pago_base' | 'bonos' | 'deducciones' | 'total_pagado' | 'estado_pago' | 'notas'> &
  Partial<Pick<Nomina, 'comprobante_path'>>;

/** Sube la captura de un pago al almacenamiento privado (ruta "comprobantes-nomina/<local>/<empleado>-<período>-<hora>.jpg"). Devuelve la ruta. */
export async function subirComprobante(localId: string, empleadoId: string, periodoInicio: string, imagen: Blob): Promise<string> {
  const ruta = `comprobantes-nomina/${localId}/${empleadoId}-${periodoInicio}-${Date.now()}.jpg`;
  return api.subir(`/api/archivos/privado/${ruta}`, imagen, 'image/jpeg');
}

/** Líneas de reventa de varios días de pago, agrupadas por id de pago. */
export async function listarReventas(nominaIds: string[]): Promise<Record<string, LineaReventa[]>> {
  if (nominaIds.length === 0) return {};
  return api.post<Record<string, LineaReventa[]>>('/api/nomina/reventas', { nominaIds });
}

/** Productos para armar la lista (sirve también al contador, que no lee el catálogo: solo recibe datos mínimos). */
export async function buscarProductosReventa(texto: string): Promise<ProductoReventa[]> {
  return api.get<ProductoReventa[]>('/api/nomina/catalogo-reventa', { q: texto, limite: 30 });
}

/**
 * Guarda el día de un trabajador independiente en un solo lote atómico del servidor: valida la lista, calcula el pago,
 * reemplaza las líneas y, si se pide, lo marca como PAGADO. Devuelve el id del pago.
 */
export async function guardarPagoIndependiente(datos: {
  empleadoId: string;
  dia: string;
  lineas: LineaReventa[];
  bonos: number;
  deducciones: number;
  notas: string | null;
  comprobante: string | null;
  quitarComprobante: boolean;
  pagar: boolean;
}): Promise<string> {
  const { comprobante, ...resto } = datos;
  return (await api.post<{ id: string }>('/api/nomina/independientes', { ...resto, comprobantePath: comprobante })).id;
}

/** Crea o ajusta el pago de un empleado fijo en una quincena (el servidor recalcula el pago base con su salario). */
export async function guardarPagoQuincenal(datos: {
  empleadoId: string;
  periodo: { inicio: string; fin: string };
  bonos: number;
  deducciones: number;
  notas: string | null;
  comprobantePath: string | null;
  quitarComprobante: boolean;
  pagar: boolean;
}): Promise<Nomina> {
  return api.post<Nomina>('/api/nomina/pagos-quincenales', datos);
}

/** Crea el pago PENDIENTE de la quincena de cada empleado fijo activo que todavía no lo tiene. Devuelve cuántos creó. */
export async function generarPagosPendientes(periodo: { inicio: string; fin: string }): Promise<number> {
  return (await api.post<{ creados: number }>('/api/nomina/generar', { periodo })).creados;
}

export async function obtenerNomina(id: string): Promise<Nomina> {
  return api.get<Nomina>(`/api/nomina/nominas/${encodeURIComponent(id)}`);
}

/** Borra una captura (best-effort: al reemplazarla o si falló el guardado del pago). */
export async function eliminarComprobante(ruta: string | null | undefined): Promise<void> {
  if (!ruta) return;
  await api.delete(`/api/archivos/privado/${ruta}`);
}

/** Dirección de una captura: el archivo es privado y solo se entrega con la sesión (y el acceso a la nómina del local). */
export async function urlComprobante(ruta: string): Promise<string> {
  return `/api/archivos/privado/${ruta}`;
}

export async function eliminarNomina(id: string): Promise<void> {
  await api.delete(`/api/nomina/nominas/${encodeURIComponent(id)}`);
}
