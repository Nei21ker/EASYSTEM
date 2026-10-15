const formateadorMoneda = new Intl.NumberFormat('es-GT', {
  style: 'currency',
  currency: 'GTQ',
});

const formateadorFecha = new Intl.DateTimeFormat('es-GT', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatearMoneda(valor: number): string {
  return formateadorMoneda.format(valor);
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
