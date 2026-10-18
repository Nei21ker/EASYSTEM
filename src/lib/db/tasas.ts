import { supabase } from '../supabase';
import type { NuevaTasa, TasaCambio } from '../../types/database.types';

// numeric llega como número desde PostgREST, pero se normaliza por si llegara como texto
const normalizar = (t: TasaCambio): TasaCambio => ({ ...t, tasa: Number(t.tasa) });

/** La tasa vigente es la última registrada (null si todavía no hay ninguna). */
export async function obtenerUltimaTasa(): Promise<TasaCambio | null> {
  const { data, error } = await supabase
    .from('tasas_cambio')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .overrideTypes<TasaCambio[], { merge: false }>();

  if (error) throw error;
  return data && data.length > 0 ? normalizar(data[0]) : null;
}

/** El usuario que registra (registrado_por) lo asigna la base de datos. */
export async function insertarTasa(tasa: NuevaTasa): Promise<TasaCambio> {
  const { data, error } = await supabase
    .from('tasas_cambio')
    .insert(tasa)
    .select()
    .single()
    .overrideTypes<TasaCambio, { merge: false }>();

  if (error) throw error;
  return normalizar(data as TasaCambio);
}
