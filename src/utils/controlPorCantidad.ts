// Productos "por cantidad": mercancía muy barata y desechable (vidrios sencillos de $1 a $3) que no lleva etiqueta por pieza.
// Su stock es solo un número por local; se vende por cantidad (sin escanear cada pieza) y se controla con conteos y mermas.

/** Solo pueden ser "por cantidad" los productos que cuestan MENOS de este precio (en dólares): lo decidió el dueño. */
export const PRECIO_MAXIMO_POR_CANTIDAD = 3;

/** A partir de cuántas piezas defectuosas en UNA venta hace falta la clave de un gerente o administrador (lo decidió el dueño). */
export const UMBRAL_CLAVE_DANADOS = 3;

/** ¿Este producto se controla por cantidad (sin código ni etiqueta por pieza)? */
export const esPorCantidad = (p: { control_por_cantidad?: number | boolean | null } | null | undefined): boolean => !!p && !!p.control_por_cantidad;

/** Mensaje de error si un producto de ese precio no puede ser "por cantidad"; null si puede. */
export function errorPrecioPorCantidad(precioVenta: number): string | null {
  return precioVenta < PRECIO_MAXIMO_POR_CANTIDAD
    ? null
    : `Solo los productos que cuestan menos de $${PRECIO_MAXIMO_POR_CANTIDAD} pueden controlarse por cantidad (sin etiqueta por pieza). Este cuesta $${precioVenta}.`;
}
