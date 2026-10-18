// Los precios del catálogo están en dólares ($). Los bolívares (Bs.) se calculan en la
// pantalla multiplicando por la tasa del día (ver stores/tasa.ts); nunca se guardan en
// los productos. Se usa un formato numérico propio (en vez de style: 'currency')
// porque Intl con USD escribiría "US$" en este idioma.
const formateadorNumero = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Convención venezolana para bolívares: 1.234,56 (useGrouping "always" para que 1234,56 también lleve punto)
const formateadorBolivares = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
} as Intl.NumberFormatOptions);

export const SIMBOLO_MONEDA = '$';
export const SIMBOLO_BOLIVARES = 'Bs.';

const formateadorFecha = new Intl.DateTimeFormat('es-GT', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatearMoneda(valor: number): string {
  const absoluto = formateadorNumero.format(Math.abs(valor));
  return `${valor < 0 ? '-' : ''}${SIMBOLO_MONEDA}${absoluto}`;
}

export function formatearBolivares(valor: number): string {
  return `${valor < 0 ? '-' : ''}${SIMBOLO_BOLIVARES} ${formateadorBolivares.format(Math.abs(valor))}`;
}

/** Dólares → bolívares a la tasa dada, redondeado a céntimos. */
export function convertirABs(usd: number, tasa: number): number {
  return Math.round(usd * tasa * 100) / 100;
}

/** Fecha local (YYYY-MM-DD): el "día" de la tasa es el del reloj del negocio, no el UTC. */
export function fechaLocalISO(fecha: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

/**
 * Lee la tasa que escribe una persona: acepta coma o punto decimal ("36,5", "36.50",
 * "1.234,56"). El ÚLTIMO separador es el decimal; los anteriores son de miles.
 * Devuelve null si no es un número positivo razonable.
 */
export function parsearTasa(texto: string): number | null {
  const limpio = texto.trim().replace(/\s/g, '').replace(/^bs\.?/i, '');
  if (!/^[\d.,]+$/.test(limpio) || !/\d/.test(limpio)) return null;
  const ultimo = Math.max(limpio.lastIndexOf(','), limpio.lastIndexOf('.'));
  const entero = (ultimo >= 0 ? limpio.slice(0, ultimo) : limpio).replace(/[.,]/g, '');
  const decimales = ultimo >= 0 ? limpio.slice(ultimo + 1) : '';
  if (decimales.length > 4) return null;
  const valor = Number(`${entero || '0'}.${decimales || '0'}`);
  return Number.isFinite(valor) && valor > 0 && valor < 10_000_000 ? valor : null;
}

/**
 * Precio en dólares con su equivalente en bolívares debajo (si ya hay tasa).
 * El texto de Bs. va en un <span> en bloque, pensado para celdas y filas de lista.
 */
export function htmlPrecioDual(usd: number, tasa: number | null, clasesBs = ''): string {
  const bs = tasa
    ? `<span class="block whitespace-nowrap text-[11px] font-medium tabular-nums text-slate-500 dark:text-slate-400 ${clasesBs}">${formatearBolivares(convertirABs(usd, tasa))}</span>`
    : '';
  // Un solo elemento: en las tarjetas móviles (celdas flex) el precio no se parte en dos columnas
  return `<span class="inline-block text-right"><span class="block">${formatearMoneda(usd)}</span>${bs}</span>`;
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
