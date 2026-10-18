import type { MetodoPago } from '../types/database.types';

/** Tipos de cobro aceptados, en el orden en que se muestran. */
export const METODOS_PAGO: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'BS_PAGO_MOVIL', etiqueta: 'Bolívares · Pago móvil' },
  { valor: 'BS_PUNTO_VENTA', etiqueta: 'Bolívares · Punto de venta' },
  { valor: 'BS_EFECTIVO', etiqueta: 'Bolívares · Efectivo' },
  { valor: 'USD_EFECTIVO', etiqueta: 'Dólares · Efectivo' },
  { valor: 'BINANCE_USDT', etiqueta: 'Binance USDT' },
];

export function etiquetaMetodoPago(valor: string): string {
  return METODOS_PAGO.find((m) => m.valor === valor)?.etiqueta ?? valor;
}

/** ¿Se cobra en bolívares? (pago móvil, punto de venta o efectivo en Bs). Dólares efectivo y Binance USDT se cobran en $. */
export function esMetodoBolivares(valor: string): boolean {
  return valor.startsWith('BS_');
}
