// Solo cambia el SÍMBOLO que se muestra ($); los montos no se convierten. Se usa
// un formato numérico propio (en vez de style: 'currency') porque Intl con USD
// escribiría "US$" en este idioma.
const formateadorNumero = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const SIMBOLO_MONEDA = '$';

const formateadorFecha = new Intl.DateTimeFormat('es-GT', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatearMoneda(valor: number): string {
  const absoluto = formateadorNumero.format(Math.abs(valor));
  return `${valor < 0 ? '-' : ''}${SIMBOLO_MONEDA}${absoluto}`;
}

export function formatearFecha(valor: string | Date): string {
  return formateadorFecha.format(new Date(valor));
}

export function estadoStock(stockActual: number, stockMinimo: number): 'critico' | 'bajo' | 'ok' {
  if (stockActual <= 0) return 'critico';
  if (stockActual <= stockMinimo) return 'bajo';
  return 'ok';
}

/**
 * ¿Debe generar alerta de reabastecimiento? Un stock mínimo de 0 significa
 * "este producto no se controla": así los productos recién cargados (stock 0,
 * mínimo 0) no inundan la campana de alertas. Misma regla que la vista
 * vw_productos_stock_bajo (migración 0006).
 */
export function esStockBajo(p: { stock_actual: number; stock_minimo: number }): boolean {
  return p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo;
}
