import { supabase } from '../supabase';
import type { Local } from '../../types/database.types';

/** Locales que el usuario puede ver (RLS: el administrador todos; el resto solo el suyo). */
export async function listarLocales(): Promise<Local[]> {
  const { data, error } = await supabase
    .from('locales')
    .select('*')
    .order('created_at', { ascending: true })
    .overrideTypes<Local[], { merge: false }>();

  if (error) throw error;
  return data ?? [];
}
