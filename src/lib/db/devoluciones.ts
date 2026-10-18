import { supabase } from '../supabase';
import type { Devolucion, NuevaDevolucion } from '../../types/database.types';

const normalizar = (d: Devolucion): Devolucion => ({
  ...d,
  total_devuelto: Number(d.total_devuelto),
  total_nuevo: Number(d.total_nuevo),
  diferencia: Number(d.diferencia),
  tasa_cambio: d.tasa_cambio == null ? null : Number(d.tasa_cambio),
});

/** El administrador que registra (registrado_por) lo asigna la base de datos. */
export async function insertarDevolucion(devolucion: NuevaDevolucion): Promise<Devolucion> {
  const { data, error } = await supabase
    .from('devoluciones')
    .insert(devolucion)
    .select()
    .single()
    .overrideTypes<Devolucion, { merge: false }>();

  if (error) throw error;
  return normalizar(data as Devolucion);
}

export async function listarDevoluciones(opciones: { limite: number; ventaId?: string }): Promise<Devolucion[]> {
  let consulta = supabase.from('devoluciones').select('*').order('fecha', { ascending: false }).limit(opciones.limite);
  if (opciones.ventaId) consulta = consulta.eq('venta_id', opciones.ventaId);

  const { data, error } = await consulta.overrideTypes<Devolucion[], { merge: false }>();
  if (error) throw error;
  return (data ?? []).map(normalizar);
}
