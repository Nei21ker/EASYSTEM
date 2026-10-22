import { supabase } from '../supabase';
import type { Empleado, LineaReventa, NuevoEmpleado, Nomina, ProductoReventa } from '../../types/database.types';

// numeric de Postgres llega como texto en algunos casos: se normaliza a número
const empleado = (e: Empleado): Empleado => ({ ...e, salario_base: Number(e.salario_base) });
const nomina = (n: Nomina): Nomina => ({
  ...n,
  pago_base: Number(n.pago_base),
  bonos: Number(n.bonos),
  deducciones: Number(n.deducciones),
  total_pagado: Number(n.total_pagado),
});

/** Empleados de todos los locales a los que el usuario tiene acceso (RLS: administrador, gerente y contador). */
export async function listarEmpleados(): Promise<Empleado[]> {
  const { data, error } = await supabase
    .from('empleados')
    .select('*')
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })
    .overrideTypes<Empleado[], { merge: false }>();
  if (error) throw error;
  return (data ?? []).map(empleado);
}

export async function crearEmpleado(datos: NuevoEmpleado): Promise<Empleado> {
  const { data, error } = await supabase.from('empleados').insert(datos).select().single().overrideTypes<Empleado, { merge: false }>();
  if (error) throw error;
  return empleado(data as Empleado);
}

export async function actualizarEmpleado(id: string, cambios: Partial<NuevoEmpleado>): Promise<Empleado> {
  const { data, error } = await supabase.from('empleados').update(cambios).eq('id', id).select().single().overrideTypes<Empleado, { merge: false }>();
  if (error) throw error;
  return empleado(data as Empleado);
}

/** Pagos cuyo período empieza en el rango dado ("aaaa-mm-dd"). */
export async function listarNominas(periodoInicio: string, periodoFin: string): Promise<Nomina[]> {
  const { data, error } = await supabase
    .from('nominas')
    .select('*')
    .gte('periodo_inicio', periodoInicio)
    .lte('periodo_fin', periodoFin)
    .overrideTypes<Nomina[], { merge: false }>();
  if (error) throw error;
  return (data ?? []).map(nomina);
}

export type DatosNomina = Pick<Nomina, 'empleado_id' | 'local_id' | 'periodo_inicio' | 'periodo_fin' | 'pago_base' | 'bonos' | 'deducciones' | 'total_pagado' | 'estado_pago' | 'notas'> &
  Partial<Pick<Nomina, 'comprobante_path'>>;

const BUCKET_COMPROBANTES = 'comprobantes-nomina';

/** Sube la captura de un pago al bucket privado (ruta "<local>/<empleado>-<período>-<hora>.jpg"). Devuelve la ruta. */
export async function subirComprobante(localId: string, empleadoId: string, periodoInicio: string, imagen: Blob): Promise<string> {
  const ruta = `${localId}/${empleadoId}-${periodoInicio}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET_COMPROBANTES).upload(ruta, imagen, { contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) {
    throw new Error(
      /bucket not found/i.test(error.message)
        ? 'Falta el almacenamiento de comprobantes en Supabase: aplica la migración 0029.'
        : `No se pudo subir la captura del pago: ${error.message}`
    );
  }
  return ruta;
}

/** Líneas de reventa de varios días de pago, agrupadas por nomina_id. */
export async function listarReventas(nominaIds: string[]): Promise<Record<string, LineaReventa[]>> {
  const porNomina: Record<string, LineaReventa[]> = {};
  if (nominaIds.length === 0) return porNomina;
  const { data, error } = await supabase
    .from('nomina_reventas')
    .select('nomina_id, producto_id, producto_nombre, producto_codigo, cantidad, precio_lista, precio_vendido, created_at')
    .in('nomina_id', nominaIds)
    .order('created_at', { ascending: true })
    .overrideTypes<(LineaReventa & { nomina_id: string })[], { merge: false }>();
  if (error) throw error;
  for (const f of data ?? []) {
    const { nomina_id, ...linea } = f;
    (porNomina[nomina_id] ??= []).push({ ...linea, precio_lista: Number(linea.precio_lista), precio_vendido: Number(linea.precio_vendido) });
  }
  return porNomina;
}

/** Productos para armar la lista (función catalogo_reventa: sirve también al contador, que no lee el catálogo). */
export async function buscarProductosReventa(texto: string): Promise<ProductoReventa[]> {
  const { data, error } = await supabase.rpc('catalogo_reventa', { p_busqueda: texto, p_limite: 30 });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProductoReventa[]).map((p) => ({ ...p, precio_venta: Number(p.precio_venta) }));
}

/**
 * Guarda el día de un trabajador independiente en una sola transacción (función guardar_pago_independiente):
 * valida la lista, calcula el pago, reemplaza las líneas y, si se pide, lo marca como PAGADO. Devuelve el id del pago.
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
  const { data, error } = await supabase.rpc('guardar_pago_independiente', {
    p_empleado: datos.empleadoId,
    p_dia: datos.dia,
    p_lineas: datos.lineas,
    p_bonos: datos.bonos,
    p_deducciones: datos.deducciones,
    p_notas: datos.notas,
    p_comprobante: datos.comprobante,
    p_quitar_comprobante: datos.quitarComprobante,
    p_pagar: datos.pagar,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function obtenerNomina(id: string): Promise<Nomina> {
  const { data, error } = await supabase.from('nominas').select('*').eq('id', id).single().overrideTypes<Nomina, { merge: false }>();
  if (error) throw error;
  return nomina(data as Nomina);
}

/** Borra una captura (best-effort: al reemplazarla o si falló el guardado del pago). */
export async function eliminarComprobante(ruta: string | null | undefined): Promise<void> {
  if (!ruta) return;
  await supabase.storage.from(BUCKET_COMPROBANTES).remove([ruta]);
}

/** Enlace temporal (1 hora) para ver una captura: el bucket es privado. */
export async function urlComprobante(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_COMPROBANTES).createSignedUrl(ruta, 3600);
  if (error || !data) throw new Error('No se pudo abrir la captura del pago.');
  return data.signedUrl;
}

/** El trigger de la base de datos fija el local (el del empleado) y la fecha de pago. */
export async function insertarNominas(filas: DatosNomina[]): Promise<Nomina[]> {
  const { data, error } = await supabase
    .from('nominas')
    .insert(filas)
    .select()
    .overrideTypes<Nomina[], { merge: false }>();
  if (error) throw error;
  return (data ?? []).map(nomina);
}

export async function actualizarNomina(id: string, cambios: Partial<DatosNomina>): Promise<Nomina> {
  const { data, error } = await supabase.from('nominas').update(cambios).eq('id', id).select().single().overrideTypes<Nomina, { merge: false }>();
  if (error) throw error;
  return nomina(data as Nomina);
}

export async function eliminarNomina(id: string): Promise<void> {
  const { error } = await supabase.from('nominas').delete().eq('id', id);
  if (error) throw error;
}
