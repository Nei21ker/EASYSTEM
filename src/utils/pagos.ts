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
/** ¿Alguno de los cobros es "Bs pago móvil"? Entonces la venta exige la captura del comprobante. */
export function incluyePagoMovil(pagos: Pick<PagoVenta, 'metodo'>[]): boolean {
  return pagos.some((p) => p.metodo === 'BS_PAGO_MOVIL');
}

export function esMetodoBolivares(valor: string): boolean {
  return valor.startsWith('BS_');
}

/** Lo máximo que se acepta como "pagó de más por redondeo" en un pago en bolívares (para que un error de tecleo no pase como redondeo). */
export const REDONDEO_MAXIMO_USD = 5;

const aCentavos = (n: number) => Math.round(n * 100) / 100;

/**
 * El cliente entregó de más en bolívares (redondeó el monto): en vez de exigir vuelto, la venta se registra con lo que de verdad pagó
 * (`monto_bs`) y lo que debía (`monto_bs_debido`). El exceso se descuenta del ÚLTIMO pago en Bs, de modo que Σ `monto_usd` sigue siendo
 * el total. Devuelve null si no se puede absorber: no hay pago en Bs, el exceso pasa de REDONDEO_MAXIMO_USD o dejaría ese pago en cero.
 */
export function absorberExcesoEnBs(pagos: PagoVenta[], excesoUsd: number, tasa: number): PagoVenta[] | null {
  if (!(excesoUsd > 0.004) || excesoUsd > REDONDEO_MAXIMO_USD || !(tasa > 0)) return null;
  const indice = pagos.map((p) => p.monto_bs != null).lastIndexOf(true);
  if (indice < 0) return null;
  const destino = pagos[indice];
  const usd = aCentavos(destino.monto_usd - excesoUsd);
  if (!(usd > 0)) return null;
  const debido = aCentavos(usd * tasa);
  if (!(destino.monto_bs! > debido)) return null;
  return pagos.map((p, i) => (i === indice ? { ...p, monto_usd: usd, monto_bs_debido: debido } : p));
}

/** Bolívares que el cliente dejó de más en este pago (0 si pagó lo justo). */
export function bsDeMas(p: Pick<PagoVenta, 'monto_bs' | 'monto_bs_debido'>): number {
  if (p.monto_bs == null || p.monto_bs_debido == null) return 0;
  return Math.max(0, aCentavos(p.monto_bs - p.monto_bs_debido));
}

/** ¿El pago trae un redondeo válido? Lo usa el servidor para no guardar datos incoherentes. */
export function redondeoValido(p: Pick<PagoVenta, 'metodo' | 'monto_bs' | 'monto_bs_debido'>, tasa: number): boolean {
  if (p.monto_bs_debido == null) return true;
  if (!esMetodoBolivares(p.metodo) || p.monto_bs == null) return false;
  if (!(p.monto_bs_debido > 0) || !(p.monto_bs > p.monto_bs_debido)) return false;
  return !(tasa > 0) || p.monto_bs - p.monto_bs_debido <= REDONDEO_MAXIMO_USD * tasa * 1.01;
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
