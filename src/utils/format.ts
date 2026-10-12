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
