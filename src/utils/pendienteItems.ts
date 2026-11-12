// Mercancía pendiente con productos del inventario: reglas puras compartidas por el servidor, la demo y la ventana de anotar.
import type { PendienteItem } from '../types/database.types';

export const MAX_ITEMS_PENDIENTE = 50;
export const MAX_CANTIDAD_ITEM_PENDIENTE = 5000;

/** Junta los productos repetidos (suma sus cantidades) y valida la lista. Lanza Error con el mensaje en español. */
export function normalizarItemsPendiente(items: { producto_id: string; cantidad: number }[] | null | undefined): { producto_id: string; cantidad: number }[] {
  const suma = new Map<string, number>();
  for (const i of items ?? []) {
    if (!i.producto_id) throw new Error('Un producto de la lista no es válido.');
    if (!Number.isInteger(i.cantidad) || i.cantidad < 1) throw new Error('La cantidad de cada producto debe ser un número entero mayor a 0.');
    suma.set(i.producto_id, (suma.get(i.producto_id) ?? 0) + i.cantidad);
  }
  if (suma.size > MAX_ITEMS_PENDIENTE) throw new Error(`Máximo ${MAX_ITEMS_PENDIENTE} productos distintos por pendiente.`);
  for (const cantidad of suma.values()) if (cantidad > MAX_CANTIDAD_ITEM_PENDIENTE) throw new Error(`Máximo ${MAX_CANTIDAD_ITEM_PENDIENTE} unidades de un mismo producto.`);
  return [...suma].map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
}

/** El texto que queda en el pendiente: «2 × Vidrio A, 1 × Vidrio B · otras cosas…» (los productos primero y luego el texto libre). */
export function descripcionDePendiente(items: Pick<PendienteItem, 'nombre' | 'cantidad'>[], textoLibre: string): string {
  const productos = items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ');
  const libre = textoLibre.trim().replace(/\s+/g, ' ');
  return [productos, libre].filter(Boolean).join(' · ');
}

/** Lo que valen los productos elegidos al precio de catálogo (en dólares, redondeado a centavos): sugerencia para «lo que debe pagar». */
export const montoSugeridoDePendiente = (items: Pick<PendienteItem, 'cantidad' | 'precio_unitario'>[]): number =>
  Math.round(items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0) * 100) / 100;

/** Lee el JSON de `pendientes.items` (null si no hay o está dañado). */
export function leerItemsPendiente(json: string | null | undefined): PendienteItem[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) && v.length > 0 ? (v as PendienteItem[]) : null;
  } catch {
    return null;
  }
}
