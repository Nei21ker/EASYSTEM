// Carga inicial de mercancía del Local Servicio Técnico: mientras un producto NO tenga foto o NO tenga precio, su cantidad se puede
// corregir a mano en «Editar» (administrador, gerente y encargado del local) SIN dejar movimientos ni historial: todavía se está
// cargando el inventario y esos ajustes no deben verse en Movimientos, Reportes ni Inversión. En cuanto el producto tiene foto Y precio
// deja de ser editable así: desde ahí todo cambio de stock (ventas, ingresos, bajas) es un movimiento normal.

/** Mayor cantidad que se puede fijar de una vez (evita un tecleo de más: crea o borra una fila por pieza con código). */
export const MAX_CANTIDAD_CARGA = 500;

export const TIPO_LOCAL_CARGA = 'servicio_tecnico';

/** ¿Sigue "en carga" (sin foto o sin precio)? */
export function productoEnCarga(p: { imagen_url?: string | null; precio_venta?: number | null }): boolean {
  return !p.imagen_url || !((p.precio_venta ?? 0) > 0);
}

/** Texto de error de una cantidad (entero de 0 a MAX_CANTIDAD_CARGA) o null si está bien. */
export function errorCantidadCarga(cantidad: unknown): string | null {
  if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 0) return 'La cantidad debe ser un número entero de 0 en adelante.';
  if (cantidad > MAX_CANTIDAD_CARGA) return `La cantidad no puede pasar de ${MAX_CANTIDAD_CARGA}.`;
  return null;
}

// --- Nada se vende sin precio --------------------------------------------------------------------------------------------------
// Un producto con precio de venta 0 (recién cargado, a la espera de que alguien le ponga el precio) NO se ofrece en el POS ni en los
// cambios de mercancía, y el servidor rechaza cualquier venta que lo incluya (400 `sin_precio`).

/** ¿Tiene precio de venta (mayor a 0)? Sin él no se puede vender. */
export const tienePrecioDeVenta = (p: { precio_venta?: number | null }): boolean => (p.precio_venta ?? 0) > 0;

/** Mensaje para uno o varios productos sin precio. */
export function mensajeSinPrecio(nombres: string[]): string {
  if (nombres.length === 1) return `«${nombres[0]}» todavía no tiene precio, así que no se puede vender. Ponle el precio en Productos → Editar.`;
  return `Estos productos todavía no tienen precio, así que no se pueden vender: ${nombres.map((n) => `«${n}»`).join(', ')}. Ponles el precio en Productos → Editar.`;
}
