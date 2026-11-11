// Datos del promotor listos para copiar y pegar en el pago móvil del banco (lo hace el gerente a mano), con el monto en bolívares al
// cambio de HOY (el precio de la comisión está en dólares: los Bs salen de multiplicar por la tasa del día).
import { convertirABs, formatearBolivares, formatearMoneda } from './format';

export interface DatosPagoMovil {
  nombre?: string | null;
  cedula?: string | null;
  telefono?: string | null;
  banco?: string | null;
  /** Lo que se le debe, en dólares (si no hay, no se ofrece copiar el monto) */
  montoUsd?: number | null;
}

/** Solo los dígitos ("V-27.868.051" → "27868051", "0424-531 6626" → "04245316626"): así lo piden los campos del banco. */
export const soloDigitos = (texto: string | null | undefined): string => (texto ?? '').replace(/\D/g, '');

/** El monto como lo escribe el banco: coma decimal y sin separador de miles ("3400,00"). */
export const montoBsParaBanco = (bs: number): string => bs.toFixed(2).replace('.', ',');

/** Bs al cambio de hoy, o null si todavía no hay tasa. */
export const bsDeHoy = (usd: number, tasa: number | null | undefined): number | null => (tasa && tasa > 0 ? convertirABs(usd, tasa) : null);

/** "$3.78 · Bs. 3.400,00" (solo "$3.78" mientras no haya tasa). */
export function textoUsdYBs(usd: number, tasa: number | null | undefined): string {
  const bs = bsDeHoy(usd, tasa);
  return bs === null ? formatearMoneda(usd) : `${formatearMoneda(usd)} · ${formatearBolivares(bs)}`;
}

/** Todos los datos del pago en varias líneas, para pegarlos en un mensaje o una nota. */
export function textoDatosPagoMovil(d: DatosPagoMovil, tasa: number | null | undefined): string {
  const bs = d.montoUsd != null ? bsDeHoy(d.montoUsd, tasa) : null;
  return [
    d.nombre ? `Nombre: ${d.nombre}` : '',
    d.cedula ? `Cédula: ${d.cedula}` : '',
    d.telefono ? `Teléfono: ${d.telefono}` : '',
    d.banco ? `Banco: ${d.banco}` : 'Banco: (sin registrar)',
    d.montoUsd != null ? `Monto: ${bs !== null ? `${formatearBolivares(bs)} (${formatearMoneda(d.montoUsd)})` : formatearMoneda(d.montoUsd)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const escaparAtributo = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CLASE_COPIAR =
  'rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';

/** Un botón que, al tocarlo, copia `valor` (lo maneja `activarBotonesCopiar`). */
export const htmlBotonCopiar = (etiqueta: string, valor: string, extra = ''): string =>
  `<button type="button" data-copiar="${escaparAtributo(valor)}" data-etiqueta="${escaparAtributo(etiqueta)}" class="${CLASE_COPIAR} ${extra}">${escaparAtributo(etiqueta)}</button>`;

/**
 * Fila de botones para copiar: todo junto, la cédula, el teléfono y el monto en Bs (cada campo del pago móvil se pega por separado).
 * Solo salen los que tienen dato.
 */
export function htmlBotonesCopiarPago(d: DatosPagoMovil, tasa: number | null | undefined): string {
  const bs = d.montoUsd != null ? bsDeHoy(d.montoUsd, tasa) : null;
  const botones = [
    htmlBotonCopiar('Copiar datos', textoDatosPagoMovil(d, tasa), 'border-brand-300 text-brand-700 dark:border-brand-500/50 dark:text-brand-300'),
    soloDigitos(d.cedula) ? htmlBotonCopiar('Cédula', soloDigitos(d.cedula)) : '',
    soloDigitos(d.telefono) ? htmlBotonCopiar('Teléfono', soloDigitos(d.telefono)) : '',
    bs !== null ? htmlBotonCopiar('Monto Bs', montoBsParaBanco(bs)) : '',
  ];
  return `<div class="flex flex-wrap gap-2" data-copiar-fila>${botones.join('')}</div>`;
}

/** Copia al portapapeles (con respaldo para navegadores sin la API o sin https). */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* se intenta el respaldo */
  }
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, texto.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Hace funcionar los botones `data-copiar` dentro de `raiz` (un solo escuchador; sirve aunque la lista se vuelva a pintar). */
export function activarBotonesCopiar(raiz: HTMLElement): void {
  raiz.addEventListener('click', async (e) => {
    const boton = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copiar]');
    if (!boton) return;
    e.stopPropagation();
    const ok = await copiarAlPortapapeles(boton.dataset.copiar ?? '');
    const original = boton.dataset.etiqueta ?? boton.textContent ?? '';
    boton.textContent = ok ? '¡Copiado!' : 'No se pudo copiar';
    setTimeout(() => {
      boton.textContent = original;
    }, 1400);
  });
}
