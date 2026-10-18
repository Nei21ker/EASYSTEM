import { supabase } from '../supabase';
import type { NuevaOrdenServicio, OrdenServicio } from '../../types/database.types';

const normalizar = (o: OrdenServicio): OrdenServicio => ({
  ...o,
  mano_de_obra_usd: Number(o.mano_de_obra_usd),
  total_usd: Number(o.total_usd),
  repuestos: (o.repuestos ?? []).map((r) => ({ ...r, precio_unitario: Number(r.precio_unitario) })),
});

export async function listarOrdenes(opciones: { limite: number; localId?: string | null }): Promise<OrdenServicio[]> {
  let consulta = supabase.from('ordenes_servicio').select('*').order('recibida_en', { ascending: false }).limit(opciones.limite);
  if (opciones.localId) consulta = consulta.eq('local_id', opciones.localId);

  const { data, error } = await consulta.overrideTypes<OrdenServicio[], { merge: false }>();
  if (error) throw error;
  return (data ?? []).map(normalizar);
}

export async function obtenerOrden(id: string): Promise<OrdenServicio | null> {
  const { data, error } = await supabase.from('ordenes_servicio').select('*').eq('id', id).limit(1).overrideTypes<OrdenServicio[], { merge: false }>();
  if (error) throw error;
  return data && data.length > 0 ? normalizar(data[0]) : null;
}

/** El usuario que registra (registrado_por) y el folio los asigna la base de datos. */
export async function insertarOrden(orden: NuevaOrdenServicio): Promise<OrdenServicio> {
  const { data, error } = await supabase
    .from('ordenes_servicio')
    .insert(orden)
    .select()
    .single()
    .overrideTypes<OrdenServicio, { merge: false }>();

  if (error) throw error;
  return normalizar(data as OrdenServicio);
}

export async function actualizarOrden(id: string, cambios: Partial<OrdenServicio>): Promise<OrdenServicio> {
  const { data, error } = await supabase
    .from('ordenes_servicio')
    .update(cambios)
    .eq('id', id)
    .select()
    .single()
    .overrideTypes<OrdenServicio, { merge: false }>();

  if (error) throw error;
  return normalizar(data as OrdenServicio);
}
