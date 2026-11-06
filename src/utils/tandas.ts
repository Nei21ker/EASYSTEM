// Reparte una lista de movimientos en tandas que respetan los topes del servidor por petición (cada tanda se registra de golpe y
// es atómica: todo o nada). Devuelve, por tanda, las posiciones (índices) de la lista original.

/** Topes del servidor por lote atómico: 50 movimientos y 500 unidades. */
export const MAX_MOVIMIENTOS_TANDA = 50;
export const MAX_UNIDADES_TANDA = 500;

/**
 * `cantidades[i]` = unidades del movimiento i. Respeta el orden. Un movimiento que él solo pasa del tope de unidades va en su propia
 * tanda (el servidor lo rechazará con un mensaje claro, en vez de partirlo y registrar a medias).
 */
export function partirEnTandas(cantidades: number[], maxMovimientos = MAX_MOVIMIENTOS_TANDA, maxUnidades = MAX_UNIDADES_TANDA): number[][] {
  const tandas: number[][] = [];
  let actual: number[] = [];
  let unidades = 0;
  cantidades.forEach((cantidad, indice) => {
    if (actual.length > 0 && (actual.length >= maxMovimientos || unidades + cantidad > maxUnidades)) {
      tandas.push(actual);
      actual = [];
      unidades = 0;
    }
    actual.push(indice);
    unidades += cantidad;
  });
  if (actual.length > 0) tandas.push(actual);
  return tandas;
}
