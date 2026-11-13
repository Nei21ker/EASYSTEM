import { api } from '../api';
import type { FilaAltaRapida, InventarioLocal, Producto, ProductoCreadoRapido, ProductoConRelaciones, ProductoStockBajo } from '../../types/database.types';

/** Producto del catálogo con su stock en cada local que lo maneja (el servidor entrega solo los locales del usuario). */
export type ProductoConInventario = ProductoConRelaciones & { inventario: InventarioLocal[] };

type DatosProducto = Partial<Producto> & Pick<Producto, 'codigo_barras' | 'nombre' | 'categoria'>;

// Topes del servidor por petición
const PRODUCTOS_POR_LOTE = 100;
const INVENTARIO_POR_LOTE = 200;
const PARES_COMPATIBILIDAD_POR_LOTE = 500;

export async function listarProductos(): Promise<ProductoConInventario[]> {
  return api.get<ProductoConInventario[]>('/api/productos');
}

export async function obtenerProducto(id: string): Promise<ProductoConInventario | null> {
  return (await api.get<{ producto: ProductoConInventario | null }>(`/api/productos/${encodeURIComponent(id)}`)).producto;
}

export async function obtenerProductoPorCodigoBarras(codigoBarras: string): Promise<ProductoConInventario | null> {
  return (await api.get<{ producto: ProductoConInventario | null }>(`/api/productos/por-codigo/${encodeURIComponent(codigoBarras)}`)).producto;
}

export async function listarProductosStockBajo(localId?: string | null): Promise<ProductoStockBajo[]> {
  return api.get<ProductoStockBajo[]>('/api/productos/stock-bajo', { localId });
}

export async function crearProducto(producto: DatosProducto): Promise<Producto> {
  return api.post<Producto>('/api/productos', producto);
}

export async function actualizarProducto(id: string, cambios: Partial<Producto>): Promise<Producto> {
  return api.patch<Producto>(`/api/productos/${encodeURIComponent(id)}`, cambios);
}

export async function eliminarProducto(id: string) {
  await api.delete(`/api/productos/${encodeURIComponent(id)}`);
}

export interface ResultadoEliminacion {
  eliminados: string[];
  bloqueados: { id: string; nombre: string; motivo: string }[];
}

export async function eliminarProductosLote(ids: string[]): Promise<ResultadoEliminacion> {
  return api.post<ResultadoEliminacion>('/api/productos/eliminar-lote', { ids });
}

/** Pone el mismo precio (en $ o fijo en Bs) a muchos productos de una vez. */
export async function cambiarPreciosLote(ids: string[], moneda: 'USD' | 'BS', precio: number): Promise<{ actualizados: number; precio_venta: number }> {
  return api.post<{ actualizados: number; precio_venta: number }>('/api/productos/precios-lote', { ids, moneda, precio });
}

/** Carga inicial del Local Servicio Técnico: fija la cantidad de un producto sin foto o sin precio, sin dejar movimientos. */
export async function establecerCantidadEnCarga(productoId: string, localId: string, cantidad: number): Promise<{ cantidad: number }> {
  return api.post<{ cantidad: number }>(`/api/productos/${encodeURIComponent(productoId)}/cantidad`, { localId, cantidad });
}

/** Sube la foto (R2) y devuelve su URL; el servidor la sirve sin sesión para poder mostrarla en cualquier pantalla. */
export async function subirImagenProducto(productoId: string, imagen: Blob): Promise<string> {
  return api.subir(`/api/archivos/producto/${encodeURIComponent(productoId)}`, imagen, imagen.type || 'image/jpeg');
}

/** Sube la miniatura de una foto ya subida (la que se muestra en las listas) y devuelve su URL. */
export async function subirMiniaturaProducto(productoId: string, urlFoto: string, miniatura: Blob): Promise<string> {
  return api.subir(`/api/archivos/producto/${encodeURIComponent(productoId)}?miniatura=${encodeURIComponent(urlFoto)}`, miniatura, miniatura.type || 'image/jpeg');
}

/** Borra del almacenamiento el archivo al que apunta una URL (si es de nuestro almacenamiento; si no, no hace nada). */
export async function eliminarImagenProducto(url: string | null | undefined): Promise<void> {
  if (!url) return;
  await api.delete('/api/archivos/producto/foto', { url });
}

/** Crea productos en lotes de 100 (cada lote es atómico); devuelve id y código de cada uno para enlazar compatibilidades y stock. */
export async function crearProductosLote(filas: DatosProducto[]): Promise<{ id: string; codigo_barras: string }[]> {
  const creados: { id: string; codigo_barras: string }[] = [];
  for (let i = 0; i < filas.length; i += PRODUCTOS_POR_LOTE) {
    creados.push(...(await api.post<{ id: string; codigo_barras: string }[]>('/api/productos/lote', { filas: filas.slice(i, i + PRODUCTOS_POR_LOTE) })));
  }
  return creados;
}

/** Alta rápida: crea productos con solo nombre, categoría y precio (el servidor pone el código y la referencia). De 100 en 100, cada tanda atómica. */
export async function crearProductosRapidos(filas: FilaAltaRapida[]): Promise<ProductoCreadoRapido[]> {
  const creados: ProductoCreadoRapido[] = [];
  for (let i = 0; i < filas.length; i += PRODUCTOS_POR_LOTE) {
    creados.push(...(await api.post<ProductoCreadoRapido[]>('/api/productos/rapido', { filas: filas.slice(i, i + PRODUCTOS_POR_LOTE) })));
  }
  return creados;
}

/** Reemplaza las compatibilidades de varios productos: cada tanda de 100 productos borra las actuales e inserta las nuevas. */
export async function reemplazarCompatibilidadesLote(pares: { producto_id: string; modelo_id: string }[], productoIds: string[]) {
  const porProducto = new Map<string, { producto_id: string; modelo_id: string }[]>();
  for (const par of pares) porProducto.set(par.producto_id, [...(porProducto.get(par.producto_id) ?? []), par]);

  // Los productos van de 100 en 100; si los pares de una tanda pasan de 500 se parten en peticiones sucesivas (la primera
  // borra las compatibilidades actuales de la tanda y las siguientes solo agregan)
  for (let i = 0; i < productoIds.length; i += PRODUCTOS_POR_LOTE) {
    const ids = productoIds.slice(i, i + PRODUCTOS_POR_LOTE);
    const paresTanda = ids.flatMap((id) => porProducto.get(id) ?? []);
    let primera = true;
    for (let j = 0; j < Math.max(paresTanda.length, 1); j += PARES_COMPATIBILIDAD_POR_LOTE) {
      await api.post('/api/productos/compatibilidades-lote', {
        pares: paresTanda.slice(j, j + PARES_COMPATIBILIDAD_POR_LOTE),
        productoIds: primera ? ids : [],
      });
      primera = false;
    }
  }
}

export async function establecerCompatibilidades(productoId: string, modeloIds: string[]) {
  await api.put(`/api/productos/${encodeURIComponent(productoId)}/compatibilidades`, { modeloIds });
}

/**
 * Da de alta productos en el inventario de un local (fila con stock 0 y sin mínimo) para que el local
 * los maneje aunque todavía no tengan existencias. Los que ya estaban no se tocan.
 */
export async function asegurarEnLocal(localId: string, productoIds: string[]): Promise<void> {
  for (let i = 0; i < productoIds.length; i += INVENTARIO_POR_LOTE) {
    await api.post(`/api/locales/${encodeURIComponent(localId)}/inventario/alta`, { productoIds: productoIds.slice(i, i + INVENTARIO_POR_LOTE) });
  }
}

/**
 * Fija el stock mínimo de varios productos en un local. Si el local aún no manejaba el producto, queda dado
 * de alta con stock 0; si ya lo manejaba, solo cambia el mínimo (el stock no se toca).
 */
export async function fijarMinimosLote(localId: string, filas: { producto_id: string; stock_minimo: number }[]): Promise<void> {
  for (let i = 0; i < filas.length; i += INVENTARIO_POR_LOTE) {
    await api.post(`/api/locales/${encodeURIComponent(localId)}/inventario/minimos`, { filas: filas.slice(i, i + INVENTARIO_POR_LOTE) });
  }
}

/** Cambia el stock mínimo de un producto en un local (stock_minimo = 0 → sin control de reabastecimiento). */
export async function actualizarStockMinimo(localId: string, productoId: string, stockMinimo: number): Promise<void> {
  await fijarMinimosLote(localId, [{ producto_id: productoId, stock_minimo: stockMinimo }]);
}
