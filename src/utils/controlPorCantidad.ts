// Productos "por cantidad": mercancía que no lleva etiqueta por pieza.
// Su stock es solo un número por local; se vende por cantidad (sin escanear cada pieza) y se controla con conteos y mermas.

/** A partir de cuántas piezas defectuosas en UNA venta hace falta la clave de un gerente o administrador (lo decidió el dueño). */
export const UMBRAL_CLAVE_DANADOS = 3;

/** ¿Este producto se controla por cantidad (sin código ni etiqueta por pieza)? */
export const esPorCantidad = (p: { control_por_cantidad?: number | boolean | null } | null | undefined): boolean => !!p && !!p.control_por_cantidad;
