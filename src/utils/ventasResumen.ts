import type { MetodoPago, Venta } from '../types/database.types';
import { METODOS_PAGO } from './pagos';

export interface ResumenMetodo {
  metodo: MetodoPago;
  etiqueta: string;
  cantidad: number;
  /** Suma de los totales en dólares de esas ventas */
  totalUsd: number;
  /** Suma de lo cobrado en bolívares (solo los tipos de cobro en Bs; 0 en los demás) */
  totalBs: number;
}

/** Ventas agrupadas por tipo de cobro. Devuelve siempre los 5 tipos, en su orden habitual (aunque estén en cero). */
export function resumirPorMetodo(ventas: Pick<Venta, 'metodo_pago' | 'total' | 'total_bs'>[]): ResumenMetodo[] {
  const resumen = new Map<string, ResumenMetodo>(
    METODOS_PAGO.map((m) => [m.valor, { metodo: m.valor, etiqueta: m.etiqueta, cantidad: 0, totalUsd: 0, totalBs: 0 }])
  );
  for (const v of ventas) {
    const fila = resumen.get(v.metodo_pago);
    if (!fila) continue;
    fila.cantidad += 1;
    fila.totalUsd += v.total;
    fila.totalBs += v.total_bs ?? 0;
  }
  return [...resumen.values()];
}
