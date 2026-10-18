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
