// Acceso a Supabase de las unidades con código único (migración 0033). Solo lo usa inventoryService.ts.
// La tabla se LEE por RLS (cada usuario ve las de su local) y NUNCA se escribe desde aquí: las unidades
// cambian por los movimientos de inventario (trigger). Lo único que se llama aparte es marcar etiquetas impresas.
import { supabase } from '../supabase';
import type { EstadoUnidad, UnidadProducto } from '../../types/database.types';

const POR_PAGINA = 1000;

export interface FiltroUnidades {
  productoId?: string;
  localId?: string | null;
  estado?: EstadoUnidad;
  sinImprimir?: boolean;
  codigos?: string[];
}

/** Unidades que cumplen el filtro (más antiguas primero), pidiéndolas por páginas de 1000. */
export async function listarUnidades(filtro: FiltroUnidades = {}): Promise<UnidadProducto[]> {
  const todas: UnidadProducto[] = [];
  for (let desde = 0; ; desde += POR_PAGINA) {
    let consulta = supabase.from('unidades_producto').select('*').order('created_at', { ascending: true }).order('id', { ascending: true });
    if (filtro.productoId) consulta = consulta.eq('producto_id', filtro.productoId);
    if (filtro.localId) consulta = consulta.eq('local_id', filtro.localId);
    if (filtro.estado) consulta = consulta.eq('estado', filtro.estado);
    if (filtro.sinImprimir) consulta = consulta.is('impresa_en', null);
    if (filtro.codigos) consulta = consulta.in('codigo', filtro.codigos);
    const { data, error } = await consulta.range(desde, desde + POR_PAGINA - 1).overrideTypes<UnidadProducto[], { merge: false }>();
    if (error) throw error;
    todas.push(...(data ?? []));
    if ((data?.length ?? 0) < POR_PAGINA) break;
  }
  return todas;
}

export async function obtenerUnidadPorCodigo(codigo: string): Promise<UnidadProducto | null> {
  const { data, error } = await supabase
    .from('unidades_producto')
    .select('*')
    .eq('codigo', codigo)
    .limit(1)
    .overrideTypes<UnidadProducto[], { merge: false }>();
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Anota que ya se imprimió la etiqueta de esas unidades (función marcar_unidades_impresas). */
export async function marcarImpresas(codigos: string[]): Promise<void> {
  for (let i = 0; i < codigos.length; i += 500) {
    const { error } = await supabase.rpc('marcar_unidades_impresas', { p_codigos: codigos.slice(i, i + 500) });
    if (error) throw new Error(error.message);
  }
}
