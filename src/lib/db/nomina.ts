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

export type DatosNomina = Pick<Nomina, 'empleado_id' | 'local_id' | 'periodo_inicio' | 'periodo_fin' | 'pago_base' | 'bonos' | 'deducciones' | 'total_pagado' | 'estado_pago' | 'notas'>;

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
