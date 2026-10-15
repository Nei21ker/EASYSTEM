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

/** Inserta productos en lotes; devuelve id y código de cada uno (para enlazar compatibilidades y stock). */
export async function crearProductosLote(
  filas: (Partial<Producto> & Pick<Producto, 'codigo_barras' | 'nombre' | 'categoria'>)[]
): Promise<{ id: string; codigo_barras: string }[]> {
  const creados: { id: string; codigo_barras: string }[] = [];
  for (let i = 0; i < filas.length; i += 200) {
    const { data, error } = await supabase
      .from('productos')
      .insert(filas.slice(i, i + 200))
      .select('id, codigo_barras')
      .overrideTypes<{ id: string; codigo_barras: string }[], { merge: false }>();
    if (error) throw error;
    creados.push(...(data ?? []));
  }
  return creados;
}

/** Reemplaza las compatibilidades de varios productos: borra las actuales y inserta las nuevas en lote. */
export async function reemplazarCompatibilidadesLote(pares: { producto_id: string; modelo_id: string }[], productoIds: string[]) {
  for (let i = 0; i < productoIds.length; i += 100) {
    const { error } = await supabase.from('compatibilidades').delete().in('producto_id', productoIds.slice(i, i + 100));
    if (error) throw error;
  }
  for (let i = 0; i < pares.length; i += 500) {
    const { error } = await supabase.from('compatibilidades').insert(pares.slice(i, i + 500));
    if (error) throw error;
  }
}

export async function establecerCompatibilidades(productoId: string, modeloIds: string[]) {
  await supabase.from('compatibilidades').delete().eq('producto_id', productoId);
  if (modeloIds.length === 0) return;

  const filas = modeloIds.map((modelo_id) => ({ producto_id: productoId, modelo_id }));
  const { error } = await supabase.from('compatibilidades').insert(filas);
  if (error) throw error;
}
