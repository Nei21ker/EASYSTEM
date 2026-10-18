// Formulario de "forma de pago" reutilizable (Nueva Venta y cobro de diferencias en cambios):
// una o varias filas (tipo de cobro + monto en la moneda de ese tipo) y, opcionalmente, vuelto.
// Se monta sobre un contenedor vacío; la página solo llama a establecerTotal(), refrescar(),
// reiniciar() y leer(). La tasa del día sale de stores/tasa.ts.
import { tasaActual } from '../stores/tasa';
import type { DineroEntregado, MetodoPago, PagoVenta } from '../types/database.types';
import { convertirABs, formatearBolivares, formatearMoneda, parsearMonto } from './format';
import { esMetodoBolivares, etiquetaMetodoPago, METODOS_PAGO, METODOS_VUELTO } from './pagos';

interface FilaPago {
  metodo: MetodoPago | '';
  /** Texto escrito, en la moneda del tipo de cobro (Bs. para los de bolívares, $ para el resto) */
  monto: string;
}

export interface ResultadoPagos {
  pagos: PagoVenta[];
  /** Solo si el cliente pagó de más y se eligió dar vuelto */
  vuelto: DineroEntregado | null;
}

export type LecturaPagos = ({ ok: true } & ResultadoPagos) | { ok: false; mensaje: string; foco: HTMLElement | null };

const redondear = (n: number) => Math.round(n * 100) / 100;
const textoMonto = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const escaparHtml = (texto: string) => {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
};

const CLASE_SELECT =
  'min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-base text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white';
const CLASE_MONTO =
  'w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-base tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white';

export class FormularioPagos {
  private filas: FilaPago[] = [{ metodo: '', monto: '' }];
  private total = 0;
  private totalDeLasFilas = -1; // total con el que se armaron las filas (si cambia, se reinician)
  private darVuelto = false;
  private metodoVuelto: MetodoPago = 'USD_EFECTIVO';

  constructor(private raiz: HTMLElement) {
    raiz.addEventListener('change', (e) => {
      const el = e.target as HTMLElement;
      const select = el.closest<HTMLSelectElement>('[data-pago-metodo]');
      if (select) return this.cambiarMetodo(this.indiceDe(select), select.value);
      const vueltoSi = el.closest<HTMLSelectElement>('[data-vuelto-si]');
      if (vueltoSi) {
        this.darVuelto = vueltoSi.value === 'si';
        return this.pintarVuelto();
      }
      const vueltoMetodo = el.closest<HTMLSelectElement>('[data-vuelto-metodo]');
      if (vueltoMetodo) {
        this.metodoVuelto = vueltoMetodo.value as MetodoPago;
        this.actualizar();
      }
    });
    raiz.addEventListener('input', (e) => {
      const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-pago-monto]');
      if (!input) return;
      this.filas[this.indiceDe(input)].monto = input.value;
      this.actualizar();
    });
    raiz.addEventListener('click', (e) => {
      const objetivo = e.target as HTMLElement;
      if (objetivo.closest('[data-pago-agregar]')) {
        if (this.filas.length >= METODOS_PAGO.length) return;
        this.filas.push({ metodo: '', monto: '' });
        this.pintar();
        raiz.querySelector<HTMLSelectElement>(`[data-fila="${this.filas.length - 1}"] [data-pago-metodo]`)?.focus();
        return;
      }
      const fila = objetivo.closest<HTMLElement>('[data-fila]');
      if (!fila) return;
      const indice = Number(fila.dataset.fila);
      if (objetivo.closest('[data-pago-quitar]')) {
        this.filas.splice(indice, 1);
        this.pintar();
      } else if (objetivo.closest('[data-pago-completar]')) {
        const falta = this.total - this.asignadoExcepto(indice);
        this.filas[indice].monto = falta > 0.004 ? this.montoEnMoneda(falta, this.filas[indice].metodo as MetodoPago) : '';
        this.pintar();
      }
    });
    this.pintar();
  }

  private indiceDe(el: HTMLElement): number {
    return Number(el.closest<HTMLElement>('[data-fila]')!.dataset.fila);
  }

  /** Fija el total a pagar. Si cambió desde la última vez, las filas se reinician. */
  establecerTotal(usd: number) {
    this.total = usd;
    if (this.totalDeLasFilas !== usd) this.reiniciar();
    else this.pintar();
  }

  reiniciar() {
    this.filas = [{ metodo: '', monto: '' }];
    this.darVuelto = false;
    this.totalDeLasFilas = this.total;
    this.pintar();
  }

  /** La tasa cambió: recalcula equivalencias y resumen sin tocar lo escrito. */
  refrescar() {
    this.actualizar();
  }

  // --- cálculos -----------------------------------------------------------------------------
  /** Valor en dólares de una fila (null si falta el tipo de cobro, el monto o la tasa). */
  private usdDeFila(f: FilaPago): number | null {
    if (!f.metodo) return null;
    const valor = parsearMonto(f.monto);
    if (valor === null) return null;
    if (!esMetodoBolivares(f.metodo)) return valor;
    const tasa = tasaActual.get();
    return tasa ? valor / tasa : null;
  }

  private asignadoExcepto(indice: number | null): number {
    return this.filas.reduce((suma, f, k) => (k === indice ? suma : suma + (this.usdDeFila(f) ?? 0)), 0);
  }

  /** Un monto en dólares expresado en la moneda de ese tipo de cobro, como texto para el campo. */
  private montoEnMoneda(usd: number, metodo: MetodoPago): string {
    if (!esMetodoBolivares(metodo)) return textoMonto(redondear(usd));
    const tasa = tasaActual.get();
    return tasa ? textoMonto(redondear(usd * tasa)) : '';
  }

  /** Al cambiar el tipo de cobro de una fila: conserva el valor en dólares o propone lo que falta. */
  private cambiarMetodo(indice: number, nuevo: string) {
    const fila = this.filas[indice];
    const usdPrevio = this.usdDeFila(fila);
    fila.metodo = (nuevo || '') as MetodoPago | '';
    if (!fila.metodo) {
      fila.monto = '';
    } else if (usdPrevio !== null && usdPrevio > 0) {
      fila.monto = this.montoEnMoneda(usdPrevio, fila.metodo);
    } else {
      const falta = this.total - this.asignadoExcepto(indice);
      fila.monto = falta > 0.004 ? this.montoEnMoneda(falta, fila.metodo) : '';
    }
    this.pintar();
  }

  // --- pintado ----------------------------------------------------------------------------------
  private pintar() {
    const filasHtml = this.filas
      .map((f, i) => {
        const usados = new Set(this.filas.filter((_, k) => k !== i).map((x) => x.metodo).filter(Boolean));
        const opciones =
          '<option value="">Tipo de cobro...</option>' +
          METODOS_PAGO.map((m) => `<option value="${m.valor}" ${f.metodo === m.valor ? 'selected' : ''} ${usados.has(m.valor) ? 'disabled' : ''}>${m.etiqueta}</option>`).join('');
        const prefijo = f.metodo && esMetodoBolivares(f.metodo) ? 'Bs.' : '$';
        return `
          <div data-fila="${i}" class="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
            <div class="flex items-center gap-2">
              <select data-pago-metodo aria-label="Tipo de cobro" class="${CLASE_SELECT}">${opciones}</select>
              ${this.filas.length > 1 ? '<button type="button" data-pago-quitar aria-label="Quitar esta forma de pago" class="shrink-0 rounded p-1.5 text-slate-400 hover:text-red-600">✕</button>' : ''}
            </div>
            <div class="mt-2 flex items-center gap-2">
              <div class="relative min-w-0 flex-1">
                <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">${prefijo}</span>
                <input data-pago-monto type="text" inputmode="decimal" autocomplete="off" aria-label="Monto con este tipo de cobro" placeholder="0,00" value="${escaparHtml(f.monto)}" ${f.metodo ? '' : 'disabled'} class="${CLASE_MONTO}" />
              </div>
              <button type="button" data-pago-completar ${f.metodo ? '' : 'disabled'} title="Poner lo que falta por pagar" class="shrink-0 rounded-lg border border-slate-200 px-2.5 py-2.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-slate-800">Completar</button>
            </div>
            <p data-pago-equiv class="mt-1 min-h-4 text-[11px] tabular-nums text-slate-500 dark:text-slate-400"></p>
          </div>`;
      })
      .join('');

    this.raiz.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Forma de pago *</p>
        <button type="button" data-pago-agregar class="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">+ Agregar otra forma de pago</button>
      </div>
      <div class="mt-2 space-y-2">${filasHtml}</div>
      <div data-vuelto class="mt-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"></div>
      <p data-pagos-resumen class="mt-2 rounded-lg px-3 py-2 text-sm font-medium"></p>`;
    this.pintarVuelto();
  }

  /** Bloque "¿Se debe dar vuelto?" (se repinta solo, sin tocar las filas de pago). */
  private pintarVuelto() {
    const caja = this.raiz.querySelector<HTMLElement>('[data-vuelto]')!;
    const opcionesVuelto = METODOS_VUELTO.map(
      (m) => `<option value="${m}" ${m === this.metodoVuelto ? 'selected' : ''}>${etiquetaMetodoPago(m)}</option>`
    ).join('');
    caja.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs font-medium text-slate-600 dark:text-slate-400">¿Se debe dar vuelto?</label>
        <select data-vuelto-si aria-label="¿Se debe dar vuelto?" class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-base text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white">
          <option value="no" ${this.darVuelto ? '' : 'selected'}>No</option>
          <option value="si" ${this.darVuelto ? 'selected' : ''}>Sí</option>
        </select>
      </div>
      ${
        this.darVuelto
          ? `<div class="mt-2 flex flex-wrap items-center gap-2">
               <label class="text-xs font-medium text-slate-600 dark:text-slate-400">Dar el vuelto en</label>
               <select data-vuelto-metodo aria-label="Tipo de cobro del vuelto" class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-base text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white">${opcionesVuelto}</select>
             </div>
             <p data-vuelto-monto class="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100"></p>`
          : '<p class="mt-1 text-[11px] text-slate-400">Si el cliente paga con más, elige "Sí" para registrar cuánto vuelto se le entrega.</p>'
      }`;
    this.actualizar();
  }

  /** Actualiza equivalencias, monto del vuelto y semáforo sin volver a pintar los campos (no se pierde el foco al escribir). */
  private actualizar() {
    const tasa = tasaActual.get();
    this.raiz.querySelectorAll<HTMLElement>('[data-fila]').forEach((el) => {
      const f = this.filas[Number(el.dataset.fila)];
      const usd = this.usdDeFila(f);
      const eq = el.querySelector<HTMLElement>('[data-pago-equiv]')!;
      if (!f.metodo || usd === null) eq.textContent = '';
      else if (esMetodoBolivares(f.metodo)) eq.textContent = `≈ ${formatearMoneda(usd)}`;
      else eq.textContent = tasa ? `≈ ${formatearBolivares(convertirABs(usd, tasa))}` : '';
    });

    const resumen = this.raiz.querySelector<HTMLElement>('[data-pagos-resumen]');
    if (!resumen) return;
    const dif = redondear(this.asignadoExcepto(null) - this.total); // + = recibido de más, − = falta
    const base = 'mt-2 rounded-lg px-3 py-2 text-sm font-medium ';
    const verde = base + 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400';
    const ambar = base + 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300';
    const rojo = base + 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400';

    const vueltoEl = this.raiz.querySelector<HTMLElement>('[data-vuelto-monto]');
    if (vueltoEl) {
      const v = dif > 0.01 ? this.armarVuelto(dif) : null;
      vueltoEl.textContent = !v
        ? 'Aún no hay vuelto: lo recibido no supera el total.'
        : `Vuelto a entregar: ${v.monto_bs != null ? `${formatearBolivares(v.monto_bs)} (≈ ${formatearMoneda(v.monto_usd)})` : formatearMoneda(v.monto_usd)}`;
    }

    if (Math.abs(dif) <= 0.01) {
      resumen.className = verde;
      resumen.textContent = `✓ Pagos completos: ${formatearMoneda(this.total)}`;
    } else if (dif < 0) {
      resumen.className = ambar;
      resumen.textContent = `Falta por asignar: ${formatearMoneda(-dif)}${tasa ? ` (≈ ${formatearBolivares(convertirABs(-dif, tasa))})` : ''}`;
    } else if (this.darVuelto) {
      resumen.className = verde;
      resumen.textContent = `✓ Recibido ${formatearMoneda(this.total + dif)} · Total ${formatearMoneda(this.total)} · Vuelto ${formatearMoneda(dif)}`;
    } else {
      resumen.className = rojo;
      resumen.textContent = `Los pagos se pasan por ${formatearMoneda(dif)}. Corrige los montos o marca "Sí" en ¿Se debe dar vuelto?`;
    }
  }

  private armarVuelto(excesoUsd: number): DineroEntregado | null {
    const tasa = tasaActual.get();
    const usd = redondear(excesoUsd);
    if (esMetodoBolivares(this.metodoVuelto)) {
      return tasa ? { metodo: this.metodoVuelto, monto_usd: usd, monto_bs: convertirABs(usd, tasa) } : null;
    }
    return { metodo: this.metodoVuelto, monto_usd: usd, monto_bs: null };
  }

  // --- lectura y validación ----------------------------------------------------------------------
  leer(): LecturaPagos {
    const tasa = tasaActual.get();
    const campoDe = (i: number, selector: string) => this.raiz.querySelector<HTMLElement>(`[data-fila="${i}"] ${selector}`);
    const error = (mensaje: string, foco: HTMLElement | null | undefined): LecturaPagos => ({ ok: false, mensaje, foco: foco ?? null });

    const pagos: PagoVenta[] = [];
    for (let i = 0; i < this.filas.length; i++) {
      const f = this.filas[i];
      if (!f.metodo) return error('Selecciona el tipo de cobro de cada forma de pago.', campoDe(i, '[data-pago-metodo]'));
      const valor = parsearMonto(f.monto);
      if (valor === null) return error('Escribe el monto de cada forma de pago (mayor a 0).', campoDe(i, '[data-pago-monto]'));
      if (esMetodoBolivares(f.metodo)) {
        if (!tasa) return error('Falta la tasa del dólar del día.', null);
        const bs = redondear(valor);
        pagos.push({ metodo: f.metodo, monto_bs: bs, monto_usd: redondear(bs / tasa) });
      } else {
        pagos.push({ metodo: f.metodo, monto_bs: null, monto_usd: redondear(valor) });
      }
    }

    const dif = redondear(pagos.reduce((suma, p) => suma + p.monto_usd, 0) - this.total); // + = de más, − = falta
    const ultimo = campoDe(this.filas.length - 1, '[data-pago-monto]');
    if (dif < -0.01) return error(`Falta por asignar ${formatearMoneda(-dif)} del total.`, ultimo);

    let vuelto: DineroEntregado | null = null;
    if (dif > 0.01) {
      if (!this.darVuelto) {
        return error(`Los pagos se pasan por ${formatearMoneda(dif)}. Corrige los montos o marca "Sí" en ¿Se debe dar vuelto?`, ultimo);
      }
      vuelto = this.armarVuelto(dif);
      if (!vuelto) return error('Falta la tasa del dólar del día para calcular el vuelto en bolívares.', null);
    } else if (dif !== 0) {
      // Diferencia de 1 o 2 centavos por el redondeo de los bolívares: se absorbe en el último pago en Bs.
      const destino = [...pagos].reverse().find((p) => p.monto_bs != null) ?? pagos[pagos.length - 1];
      destino.monto_usd = redondear(destino.monto_usd - dif);
    }
    return { ok: true, pagos, vuelto };
  }
}
