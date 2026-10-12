import { supabase } from '../supabase';
import type { ModeloTelefono } from '../../types/database.types';

export async function listarModelos(): Promise<ModeloTelefono[]> {
  const { data, error } = await supabase
    .from('modelos_telefono')
    .select('*')
    .order('marca')
    .order('modelo')
    .overrideTypes<ModeloTelefono[], { merge: false }>();
  if (error) throw error;
  return data ?? [];
}

export async function crearModelo(modelo: Pick<ModeloTelefono, 'marca' | 'modelo'>): Promise<ModeloTelefono> {
  const { data, error } = await supabase
    .from('modelos_telefono')
    .insert(modelo)
    .select()
    .single()
    .overrideTypes<ModeloTelefono, { merge: false }>();
  if (error) throw error;
  return data as ModeloTelefono;
}

export async function eliminarModelo(id: string) {
  const { error } = await supabase.from('modelos_telefono').delete().eq('id', id);
  if (error) throw error;
}
