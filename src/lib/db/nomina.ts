import { supabase } from '../supabase';
import type { Empleado, NuevoEmpleado, Nomina } from '../../types/database.types';

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
