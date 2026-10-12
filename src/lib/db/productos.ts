import { supabase } from '../supabase';
import type { Producto, ProductoConRelaciones, ProductoStockBajo } from '../../types/database.types';

const PRODUCTO_CON_RELACIONES_SELECT = `
  *,
  modelos_compatibles:compatibilidades(modelo:modelos_telefono(*))
`;

/** Aplana la respuesta anidada de Supabase (compatibilidades -> modelo) a un arreglo simple */
function normalizarProducto(row: any): ProductoConRelaciones {
  return {
    ...row,
    modelos_compatibles: (row.modelos_compatibles ?? []).map((c: any) => c.modelo).filter(Boolean),
  };
}

export async function listarProductos(): Promise<ProductoConRelaciones[]> {
  const { data, error } = await supabase
    .from('productos')
    .select(PRODUCTO_CON_RELACIONES_SELECT)
    .order('nombre', { ascending: true })
    .overrideTypes<any[], { merge: false }>();

  if (error) throw error;
  return (data ?? []).map(normalizarProducto);
}

export async function obtenerProducto(id: string): Promise<ProductoConRelaciones | null> {
  const { data, error } = await supabase
    .from('productos')
    .select(PRODUCTO_CON_RELACIONES_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizarProducto(data) : null;
}

export async function obtenerProductoPorCodigoBarras(codigoBarras: string): Promise<ProductoConRelaciones | null> {
  const { data, error } = await supabase
    .from('productos')
    .select(PRODUCTO_CON_RELACIONES_SELECT)
    .eq('codigo_barras', codigoBarras)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizarProducto(data) : null;
}

export async function listarProductosStockBajo(): Promise<ProductoStockBajo[]> {
  const { data, error } = await supabase
    .from('vw_productos_stock_bajo')
    .select('*')
    .overrideTypes<ProductoStockBajo[], { merge: false }>();

  if (error) throw error;
  return data ?? [];
}

export async function crearProducto(
  producto: Partial<Producto> & Pick<Producto, 'codigo_barras' | 'nombre' | 'categoria'>
): Promise<Producto> {
  const { data, error } = await supabase
    .from('productos')
    .insert(producto)
    .select()
    .single()
    .overrideTypes<Producto, { merge: false }>();
  if (error) throw error;
  return data as Producto;
}

export async function actualizarProducto(id: string, cambios: Partial<Producto>): Promise<Producto> {
  const { data, error } = await supabase
    .from('productos')
    .update(cambios)
    .eq('id', id)
    .select()
    .single()
    .overrideTypes<Producto, { merge: false }>();
  if (error) throw error;
  return data as Producto;
}

export async function eliminarProducto(id: string) {
  const { error } = await supabase.from('productos').delete().eq('id', id);
  if (error) throw error;
}

export async function establecerCompatibilidades(productoId: string, modeloIds: string[]) {
  await supabase.from('compatibilidades').delete().eq('producto_id', productoId);
  if (modeloIds.length === 0) return;

  const filas = modeloIds.map((modelo_id) => ({ producto_id: productoId, modelo_id }));
  const { error } = await supabase.from('compatibilidades').insert(filas);
  if (error) throw error;
}
