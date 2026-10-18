import type { MetodoPago, PagoVenta, Venta } from '../types/database.types';

/** Tipos de cobro aceptados, en el orden en que se muestran. */
export const METODOS_PAGO: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'BS_PAGO_MOVIL', etiqueta: 'Bolívares · Pago móvil' },
  { valor: 'BS_PUNTO_VENTA', etiqueta: 'Bolívares · Punto de venta' },
  { valor: 'BS_EFECTIVO', etiqueta: 'Bolívares · Efectivo' },
  { valor: 'USD_EFECTIVO', etiqueta: 'Dólares · Efectivo' },
  { valor: 'BINANCE_USDT', etiqueta: 'Binance USDT' },
];

/** Tipos de cobro en los que se puede entregar un vuelto (no tiene sentido por punto de venta ni Binance). */
export const METODOS_VUELTO: MetodoPago[] = ['USD_EFECTIVO', 'BS_EFECTIVO', 'BS_PAGO_MOVIL'];

/** Tipos de cobro con los que se puede reembolsar una devolución (todos menos el punto de venta). */
export const METODOS_REEMBOLSO: MetodoPago[] = ['USD_EFECTIVO', 'BS_EFECTIVO', 'BS_PAGO_MOVIL', 'BINANCE_USDT'];

export function etiquetaMetodoPago(valor: string): string {
  if (valor === 'MIXTO') return 'Pago mixto';
  return METODOS_PAGO.find((m) => m.valor === valor)?.etiqueta ?? valor;
}

/** ¿Se cobra en bolívares? (pago móvil, punto de venta o efectivo en Bs). Dólares efectivo y Binance USDT se cobran en $. */
export function esMetodoBolivares(valor: string): boolean {
  return valor.startsWith('BS_');
}

/**
 * Pagos de una venta. Las ventas hechas antes de los pagos múltiples no traen `pagos`:
 * se reconstruye un único pago por el total con su tipo de cobro.
 */
export function pagosDeVenta(v: Pick<Venta, 'pagos' | 'metodo_pago' | 'total' | 'total_bs'>): PagoVenta[] {
  if (v.pagos && v.pagos.length > 0) return v.pagos;
  if (v.metodo_pago === 'MIXTO') return [];
  return [{ metodo: v.metodo_pago, monto_usd: v.total, monto_bs: v.total_bs ?? null }];
}
