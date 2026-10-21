import { supabase } from '../supabase';
import type { InventarioLocal, Producto, ProductoConRelaciones, ProductoStockBajo } from '../../types/database.types';

/** Producto del catálogo con su stock en cada local que lo maneja (RLS: un empleado solo recibe su local). */
export type ProductoConInventario = ProductoConRelaciones & { inventario: InventarioLocal[] };

const PRODUCTO_CON_RELACIONES_SELECT = `
  *,
  modelos_compatibles:compatibilidades(modelo:modelos_telefono(*)),
  inventario:inventario_local(local_id, producto_id, stock_actual, stock_minimo)
`;

/** Aplana la respuesta anidada de Supabase (compatibilidades -> modelo) a un arreglo simple */
function normalizarProducto(row: any): ProductoConInventario {
  return {
    ...row,
    modelos_compatibles: (row.modelos_compatibles ?? []).map((c: any) => c.modelo).filter(Boolean),
    inventario: row.inventario ?? [],
  };
}

export async function listarProductos(): Promise<ProductoConInventario[]> {
  const { data, error } = await supabase
    .from('productos')
    .select(PRODUCTO_CON_RELACIONES_SELECT)
    .order('nombre', { ascending: true })
    .overrideTypes<any[], { merge: false }>();

  if (error) throw error;
  return (data ?? []).map(normalizarProducto);
}

export async function obtenerProducto(id: string): Promise<ProductoConInventario | null> {
  const { data, error } = await supabase
    .from('productos')
    .select(PRODUCTO_CON_RELACIONES_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizarProducto(data) : null;
}

export async function obtenerProductoPorCodigoBarras(codigoBarras: string): Promise<ProductoConInventario | null> {
  const { data, error } = await supabase
    .from('productos')
    .select(PRODUCTO_CON_RELACIONES_SELECT)
    .eq('codigo_barras', codigoBarras)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizarProducto(data) : null;
}

export async function listarProductosStockBajo(localId?: string | null): Promise<ProductoStockBajo[]> {
  let consulta = supabase.from('vw_productos_stock_bajo').select('*');
  if (localId) consulta = consulta.eq('local_id', localId);
  const { data, error } = await consulta.overrideTypes<ProductoStockBajo[], { merge: false }>();

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

const BUCKET_IMAGENES = 'productos';

/** Sube la foto a Supabase Storage (bucket público "productos") y devuelve su URL pública. */
export async function subirImagenProducto(productoId: string, imagen: Blob): Promise<string> {
  // Nombre único por subida: así la URL cambia y no queda la foto vieja en caché.
  const ruta = `${productoId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET_IMAGENES).upload(ruta, imagen, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
  });
  if (error) {
    throw new Error(
      /bucket not found/i.test(error.message)
        ? 'Falta el almacenamiento de fotos en Supabase: aplica la migración 0009.'
        : `No se pudo subir la foto: ${error.message}`
    );
  }
  return supabase.storage.from(BUCKET_IMAGENES).getPublicUrl(ruta).data.publicUrl;
}

/** Borra del Storage el archivo al que apunta una URL pública (si es de nuestro bucket). */
export async function eliminarImagenProducto(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const marca = `/${BUCKET_IMAGENES}/`;
  const indice = url.indexOf(marca);
  if (indice === -1) return;
  const ruta = decodeURIComponent(url.slice(indice + marca.length).split('?')[0]);
  await supabase.storage.from(BUCKET_IMAGENES).remove([ruta]);
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

/**
 * Da de alta productos en el inventario de un local (fila con stock 0 y sin mínimo) para que el local
 * los maneje aunque todavía no tengan existencias. Los que ya estaban no se tocan. Solo administrador (RLS).
 */
export async function asegurarEnLocal(localId: string, productoIds: string[]): Promise<void> {
  for (let i = 0; i < productoIds.length; i += 500) {
    const filas = productoIds.slice(i, i + 500).map((producto_id) => ({ local_id: localId, producto_id, stock_minimo: 0 }));
    const { error } = await supabase.from('inventario_local').upsert(filas, { onConflict: 'local_id,producto_id', ignoreDuplicates: true });
    if (error) throw error;
  }
}

/**
 * Fija el stock mínimo de varios productos en un local. Si el local aún no manejaba el producto, queda dado
 * de alta con stock 0; si ya lo manejaba, solo cambia el mínimo (el stock no se toca). Solo administrador (RLS).
 */
export async function fijarMinimosLote(localId: string, filas: { producto_id: string; stock_minimo: number }[]): Promise<void> {
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500).map((f) => ({ local_id: localId, producto_id: f.producto_id, stock_minimo: f.stock_minimo }));
    const { error } = await supabase.from('inventario_local').upsert(lote, { onConflict: 'local_id,producto_id' });
    if (error) throw error;
  }
}

/** Cambia el stock mínimo de un producto en un local (stock_minimo = 0 → sin control de reabastecimiento). */
export async function actualizarStockMinimo(localId: string, productoId: string, stockMinimo: number): Promise<void> {
  const { error } = await supabase
    .from('inventario_local')
    .upsert({ local_id: localId, producto_id: productoId, stock_minimo: stockMinimo }, { onConflict: 'local_id,producto_id' });
  if (error) throw error;
}
