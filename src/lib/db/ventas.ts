import { supabase } from '../supabase';
import type { NuevaVenta, Venta } from '../../types/database.types';

/**
 * Guarda el registro de una venta. El folio lo asigna la base de datos y el
 * vendedor (vendedor_id) también: la política RLS exige que sea quien inserta.
 */
export async function insertarVenta(venta: NuevaVenta): Promise<Venta> {
  const { data, error } = await supabase
    .from('ventas')
    .insert(venta)
    .select()
    .single()
    .overrideTypes<Venta, { merge: false }>();

  if (error) throw error;
  return data as Venta;
}

/** Ventas recientes (más nuevas primero), opcionalmente dentro de un rango de fechas. */
export async function listarVentas(opciones: { desde?: Date; hasta?: Date; limite: number; localId?: string | null }): Promise<Venta[]> {
  let consulta = supabase.from('ventas').select('*').order('fecha', { ascending: false }).limit(opciones.limite);
  if (opciones.localId) consulta = consulta.eq('local_id', opciones.localId);
  if (opciones.desde) consulta = consulta.gte('fecha', opciones.desde.toISOString());
  if (opciones.hasta) consulta = consulta.lte('fecha', opciones.hasta.toISOString());

  const { data, error } = await consulta.overrideTypes<Venta[], { merge: false }>();
  if (error) throw error;

  // numeric puede llegar como texto según la configuración de PostgREST: se normaliza
  return (data ?? []).map((v) => ({
    ...v,
    total: Number(v.total),
    tasa_cambio: v.tasa_cambio == null ? null : Number(v.tasa_cambio),
    total_bs: v.total_bs == null ? null : Number(v.total_bs),
  }));
}
