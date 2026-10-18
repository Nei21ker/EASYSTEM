// Piezas de interfaz compartidas por las listas de productos (módulo Productos y
// buscador del Dashboard): así las dos se ven y se comportan igual.
import type { ModeloTelefono, ProductoConRelaciones } from '../types/database.types';
import { esStockBajo } from './format';

export const CHIPS_VISIBLES = 2;

export const normalizarTexto = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const compararNatural = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });

export function escaparHtml(texto: string): string {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

/** "iPhone 12" en vez de "Apple iPhone 12": la marca solo se repite donde el modelo no la trae. */
export function nombreCortoModelo(m: ModeloTelefono): string {
  if (['Apple', 'Samsung', 'Xiaomi'].includes(m.marca)) return m.modelo;
  return normalizarTexto(m.modelo).startsWith(normalizarTexto(m.marca)) ? m.modelo : `${m.marca} ${m.modelo}`;
}

/**
 * Píldora de stock. Un producto sin stock y SIN mínimo definido es "no controlado"
 * (recién cargado): se muestra neutro; solo es rojo si tiene mínimo y se agotó.
 */
export function htmlPildoraStock(p: Pick<ProductoConRelaciones, 'stock_actual' | 'stock_minimo'>): string {
  const base = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold';
  const punto = (color: string) => `<span class="h-1.5 w-1.5 rounded-full ${color}"></span>`;
  if (p.stock_actual <= 0) {
    return p.stock_minimo > 0
      ? `<span class="${base} bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400">${punto('bg-red-500')}Sin stock</span>`
      : `<span class="${base} bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">${punto('bg-slate-400')}Sin stock</span>`;
  }
  if (esStockBajo(p)) {
    return `<span class="${base} bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" title="Stock bajo">${punto('bg-amber-500')}${p.stock_actual} u.</span>`;
  }
  return `<span class="${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">${punto('bg-emerald-500')}${p.stock_actual} u.</span>`;
}

/** Modelos compatibles resumidos: los primeros CHIPS_VISIBLES y un botón "+N más" (ver alternarCompatibles). */
export function htmlCompatibles(p: Pick<ProductoConRelaciones, 'modelos_compatibles'>): string {
  if (p.modelos_compatibles.length === 0) {
    return '<span class="text-xs text-slate-400">Universal</span>';
  }
  const nombres = p.modelos_compatibles.map(nombreCortoModelo).sort(compararNatural);
  const chip = (n: string, oculto: boolean) =>
    `<span ${oculto ? 'style="display:none"' : ''} class="extra-chip inline-flex items-center whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">${escaparHtml(n)}</span>`;

  const resto = nombres.length - CHIPS_VISIBLES;
  return `<div data-compat class="flex flex-wrap items-center gap-1">
      ${nombres.map((n, i) => chip(n, i >= CHIPS_VISIBLES)).join('')}
      ${
        resto > 0
          ? `<button type="button" data-expandir data-resto="${resto}" class="rounded-md px-1.5 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800">+${resto} más</button>`
          : ''
      }
    </div>`;
}

/**
 * Maneja el clic en "+N más / Ver menos". Devuelve true si el clic era de ese
 * botón (para que el llamador no lo trate como otra acción de la fila).
 */
export function alternarCompatibles(objetivo: EventTarget | null): boolean {
  const boton = (objetivo as HTMLElement | null)?.closest<HTMLButtonElement>('[data-expandir]');
  if (!boton) return false;
  const contenedor = boton.closest<HTMLElement>('[data-compat]')!;
  const abierto = contenedor.dataset.abierto === '1';
  contenedor.dataset.abierto = abierto ? '0' : '1';
  contenedor.querySelectorAll<HTMLElement>('.extra-chip').forEach((chip, i) => {
    if (i >= CHIPS_VISIBLES) chip.style.display = abierto ? 'none' : '';
  });
  boton.textContent = abierto ? `+${boton.dataset.resto} más` : 'Ver menos';
  return true;
}
