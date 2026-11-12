// Cómo se muestran los movimientos de inventario: etiqueta, color y signo según su tipo.
// Las ventas (SALIDA) y las compras (ENTRADA) son lo único que cuenta en los reportes; los traslados entre locales y las bajas
// solo mueven mercancía, por eso tienen sus propios colores y su propio filtro.
import { sumaStock, type TipoMovimiento } from '../types/database.types';

const ETIQUETAS: Record<TipoMovimiento, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  TRASLADO_SALIDA: 'Traslado enviado',
  TRASLADO_ENTRADA: 'Traslado recibido',
  BAJA: 'Baja',
};

const CLASES: Record<TipoMovimiento, string> = {
  ENTRADA: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  SALIDA: 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  TRASLADO_SALIDA: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
  TRASLADO_ENTRADA: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400',
  BAJA: 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400',
};

/** Los movimientos de un cambio de mercancía con otro local se guardan como traslados; su motivo («Cambio #0001 con …») los distingue. */
export const esMovimientoDeCambio = (motivo: string | null | undefined): boolean => /^(Cambio #|Reversión del cambio #)/.test(motivo ?? '');

/** La etiqueta del tipo; con el motivo, un traslado de un cambio de mercancía se llama «Cambio entregado / recibido». */
export const etiquetaTipoMovimiento = (tipo: TipoMovimiento, motivo?: string | null): string => {
  if (esMovimientoDeCambio(motivo)) {
    if (tipo === 'TRASLADO_SALIDA') return 'Cambio entregado';
    if (tipo === 'TRASLADO_ENTRADA') return 'Cambio recibido';
  }
  return ETIQUETAS[tipo] ?? String(tipo);
};

export const claseTipoMovimiento = (tipo: TipoMovimiento): string => CLASES[tipo] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-500/10 dark:text-slate-300';

/** "+" si el movimiento suma al stock del local, "-" si lo resta. */
export const signoMovimiento = (tipo: TipoMovimiento): '+' | '-' => (sumaStock(tipo) ? '+' : '-');

/** Grupo del filtro de la pantalla de movimientos: las entradas y salidas de siempre, o "traslados y bajas". */
export const filtroDeTipo = (tipo: TipoMovimiento): 'ENTRADA' | 'SALIDA' | 'TRASLADOS' =>
  tipo === 'ENTRADA' || tipo === 'SALIDA' ? tipo : 'TRASLADOS';
