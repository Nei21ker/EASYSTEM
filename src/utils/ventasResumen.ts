import type { Devolucion, MetodoPago, Venta } from '../types/database.types';
import { METODOS_PAGO, pagosDeVenta } from './pagos';

export interface ResumenMetodo {
  metodo: MetodoPago;
  etiqueta: string;
  /** Ventas en las que se usó este tipo de cobro (una venta mixta cuenta en cada uno de sus tipos) */
  cantidad: number;
  /** Dólares netos cobrados con este tipo de cobro (cobros − vuelto − reembolsos) */
  totalUsd: number;
  /** Bolívares netos recibidos (solo los tipos de cobro en Bs; 0 en los demás) */
  totalBs: number;
}

/**
 * Lo cobrado agrupado por tipo de cobro, sumando los PAGOS de cada venta (en una venta con varios
 * tipos de cobro, cada uno aporta su parte). Es un resumen NETO de caja: lo que sale hacia el cliente
 * (vuelto de una venta, o vuelto y reembolso de una devolución) se resta del tipo de cobro con el que
 * se entregó; los pagos de diferencias en cambios suman. Devuelve siempre los 5 tipos, en su orden
 * habitual, aunque estén en cero.
 */
export function resumirPorMetodo(
  ventas: Pick<Venta, 'pagos' | 'vuelto' | 'metodo_pago' | 'total' | 'total_bs'>[],
  devoluciones: Pick<Devolucion, 'pagos' | 'vuelto' | 'reembolso'>[] = []
): ResumenMetodo[] {
  const resumen = new Map<string, ResumenMetodo>(
    METODOS_PAGO.map((m) => [m.valor, { metodo: m.valor, etiqueta: m.etiqueta, cantidad: 0, totalUsd: 0, totalBs: 0 }])
  );
  const sumar = (metodo: string, usd: number, bs: number | null, signo: 1 | -1, cuenta: boolean) => {
    const fila = resumen.get(metodo);
    if (!fila) return;
    if (cuenta) fila.cantidad += 1;
    fila.totalUsd += signo * usd;
    fila.totalBs += signo * (bs ?? 0);
  };

  for (const v of ventas) {
    for (const pago of pagosDeVenta(v)) sumar(pago.metodo, pago.monto_usd, pago.monto_bs, 1, true);
    if (v.vuelto) sumar(v.vuelto.metodo, v.vuelto.monto_usd, v.vuelto.monto_bs, -1, false);
  }
  for (const d of devoluciones) {
    for (const pago of d.pagos ?? []) sumar(pago.metodo, pago.monto_usd, pago.monto_bs, 1, false);
    if (d.vuelto) sumar(d.vuelto.metodo, d.vuelto.monto_usd, d.vuelto.monto_bs, -1, false);
    if (d.reembolso) sumar(d.reembolso.metodo, d.reembolso.monto_usd, d.reembolso.monto_bs, -1, false);
  }
  return [...resumen.values()];
}
