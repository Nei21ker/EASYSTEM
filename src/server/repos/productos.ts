// Lecturas del catálogo con su inventario. El inventario SIEMPRE se filtra por el `Alcance` (el stock de otros locales
// no se entrega); el catálogo (productos, modelos, compatibilidades) es compartido por todos los locales.
import type { Alcance } from '../authz';
import { condicionAlcance } from '../authz';
import type { Entorno } from '../entorno';
import type { InventarioLocal, ModeloTelefono, Producto, ProductoStockBajo } from '../../types/database.types';

export type ProductoConInventario = Producto & { modelos_compatibles: ModeloTelefono[]; inventario: InventarioLocal[] };

async function ensamblar(env: Entorno, productos: Producto[], alcance: Alcance): Promise<ProductoConInventario[]> {
  if (productos.length === 0) return [];
  const { sql, valores } = condicionAlcance(alcance, 'local_id');
  const [compatibles, inventario] = await Promise.all([
    env.DB
      .prepare('SELECT c.producto_id, m.id, m.marca, m.modelo FROM compatibilidades c JOIN modelos_telefono m ON m.id = c.modelo_id')
      .all<ModeloTelefono & { producto_id: string }>(),
    env.DB
      .prepare(`SELECT local_id, producto_id, stock_actual, stock_minimo FROM inventario_local WHERE ${sql}`)
      .bind(...valores)
      .all<InventarioLocal>(),
  ]);

  const modelosPorProducto = new Map<string, ModeloTelefono[]>();
  for (const { producto_id, ...modelo } of compatibles.results) {
    const lista = modelosPorProducto.get(producto_id) ?? [];
    lista.push(modelo);
    modelosPorProducto.set(producto_id, lista);
  }
  const inventarioPorProducto = new Map<string, InventarioLocal[]>();
  for (const fila of inventario.results) {
    const lista = inventarioPorProducto.get(fila.producto_id) ?? [];
    lista.push(fila);
    inventarioPorProducto.set(fila.producto_id, lista);
  }
  return productos.map((p) => ({
    ...p,
    modelos_compatibles: modelosPorProducto.get(p.id) ?? [],
    inventario: inventarioPorProducto.get(p.id) ?? [],
  }));
}

/** Todo el catálogo (orden alfabético) con su inventario dentro del alcance. */
export async function listarConInventario(env: Entorno, alcance: Alcance): Promise<ProductoConInventario[]> {
  const productos = await env.DB.prepare('SELECT * FROM productos ORDER BY nombre').all<Producto>();
  return ensamblar(env, productos.results, alcance);
}

export async function obtenerPorCodigo(env: Entorno, alcance: Alcance, codigo: string): Promise<ProductoConInventario | null> {
  const producto = await env.DB.prepare('SELECT * FROM productos WHERE codigo_barras = ?').bind(codigo).first<Producto>();
  if (!producto) return null;
  return (await ensamblar(env, [producto], alcance))[0];
}

export async function obtenerPorId(env: Entorno, alcance: Alcance, id: string): Promise<ProductoConInventario | null> {
  const producto = await env.DB.prepare('SELECT * FROM productos WHERE id = ?').bind(id).first<Producto>();
  if (!producto) return null;
  return (await ensamblar(env, [producto], alcance))[0];
}

/** Productos con mínimo definido (> 0) cuyo stock llegó o bajó del mínimo, uno por local dentro del alcance. */
export async function listarStockBajo(env: Entorno, alcance: Alcance): Promise<ProductoStockBajo[]> {
  const { sql, valores } = condicionAlcance(alcance, 'i.local_id');
  const filas = await env.DB
    .prepare(
      `SELECT i.local_id, l.nombre AS local_nombre, p.id, p.codigo_barras, p.nombre, p.categoria, i.stock_actual, i.stock_minimo
       FROM inventario_local i
       JOIN productos p ON p.id = i.producto_id
       JOIN locales l ON l.id = i.local_id
       WHERE i.stock_minimo > 0 AND i.stock_actual <= i.stock_minimo AND ${sql}
       ORDER BY i.stock_actual ASC, p.nombre`
    )
    .bind(...valores)
    .all<ProductoStockBajo>();
  return filas.results;
}
