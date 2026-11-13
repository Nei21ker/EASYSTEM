// Formulario de "forma de pago" reutilizable (Nueva Venta y cobro de diferencias en cambios):
// una o varias filas (tipo de cobro + monto en la moneda de ese tipo) y, opcionalmente, vuelto.
// Se monta sobre un contenedor vacío; la página solo llama a establecerTotal(), refrescar(),
// reiniciar() y leer(). La tasa del día sale de stores/tasa.ts.
import { tasaActual } from '../stores/tasa';
import type { DineroEntregado, MetodoPago, PagoVenta } from '../types/database.types';
import { convertirABs, formatearBolivares, formatearMoneda, parsearMonto } from './format';
import { absorberExcesoEnBs, bsDeMas, esMetodoBolivares, etiquetaMetodoPago, METODOS_PAGO, METODOS_VUELTO } from './pagos';

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
/** El monto de un solo pago (modo botones): grande y alineado a la derecha, como el de una calculadora */
const CLASE_MONTO_UNICO =
  'w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-right text-lg font-semibold tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

/** Etiquetas cortas de los botones de cobro rápido (un toque = ese tipo de cobro por el total). */
export const ETIQUETA_COBRO_RAPIDO: Record<MetodoPago, string> = {
  USD_EFECTIVO: 'Efectivo $',
  BS_PAGO_MOVIL: 'Pago móvil',
  BS_PUNTO_VENTA: 'Punto',
  BS_EFECTIVO: 'Efectivo Bs',
  BINANCE_USDT: 'Binance',
};

/**
 * Qué se muestra cuando lo recibido supera el total:
 *  · ninguno   → nada (pago exacto o todavía falta);
 *  · redondeo  → el cliente redondeó en bolívares (≤ REDONDEO_MAXIMO_USD): la venta se registra igual, sin vuelto;
 *  · elegible  → se podría tomar como redondeo, pero se eligió dar vuelto;
 *  · obligado  → no se puede tomar como redondeo (p. ej. efectivo en dólares): hay que dar vuelto.
 */
type ModoVuelto = 'ninguno' | 'redondeo' | 'elegible' | 'obligado';

export class FormularioPagos {
  /** Modo botones: los tipos de cobro van como botones (un toque elige el tipo, con el total completo) y el pago único no lleva lista desplegable */
  private rapido = false;
  /** Tipo de cobro que se propone al armar un cobro nuevo (el último que se usó en ese local) */
  private metodoInicial: MetodoPago | null = null;
  private filas: FilaPago[] = [{ metodo: '', monto: '' }];
  private total = 0;
  /** Total en bolívares cuando el carrito tiene precios FIJOS en Bs (null = el total en dólares × tasa) */
  private totalBs: number | null = null;
  private totalDeLasFilas = -1; // total con el que se armaron las filas (si cambia, se reinician)
  /** Lo que eligió quien cobra cuando lo recibido supera el total: true = dar vuelto, false = tomarlo como redondeo, null = lo que corresponda */
  private vueltoElegido: boolean | null = null;
  private metodoVuelto: MetodoPago = 'USD_EFECTIVO';
  private modoMostrado: ModoVuelto | '' = '';
  /** Elemento de la página que se muestra pegado a los tipos de cobro (p. ej. la referencia del pago móvil) */
  private extra: HTMLElement | null = null;

  constructor(private raiz: HTMLElement) {
    raiz.addEventListener('change', (e) => {
      const el = e.target as HTMLElement;
      const select = el.closest<HTMLSelectElement>('[data-pago-metodo]');
      if (select) return this.cambiarMetodo(this.indiceDe(select), select.value);
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
      const rapido = objetivo.closest<HTMLElement>('[data-pago-rapido]');
      if (rapido) {
        // Un toque: una sola forma de pago con ese tipo de cobro por el total completo (para dividir el pago se usa «Dividir pago»)
        this.filas = [{ metodo: '', monto: '' }];
        this.vueltoElegido = null;
        this.cambiarMetodo(0, rapido.dataset.pagoRapido ?? '');
        raiz.dispatchEvent(new CustomEvent('easystem:metodo-elegido', { bubbles: true, detail: { metodo: rapido.dataset.pagoRapido ?? '' } }));
        return;
      }
      const vuelto = objetivo.closest<HTMLElement>('[data-vuelto-dar]');
      if (vuelto) {
        this.vueltoElegido = vuelto.dataset.vueltoDar === 'si';
        this.actualizar();
        return;
      }
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

  /**
   * Activa el modo botones. `metodoInicial`: el tipo de cobro que ya viene elegido al abrir el cobro (null = ninguno).
   * Nombre histórico: nació en el cobro rápido del Local Vidrios y ahora lo usa todo el POS.
   */
  activarCobroRapido(metodoInicial: MetodoPago | null = null) {
    this.rapido = true;
    this.metodoInicial = metodoInicial;
    this.reiniciar();
  }

  /** Pega un elemento de la página (p. ej. la referencia del pago móvil) justo debajo de los tipos de cobro; sobrevive a cada repintado. */
  fijarExtraBajoMetodos(elemento: HTMLElement) {
    this.extra = elemento;
    this.pintar();
  }

  /** Los tipos de cobro elegidos ahora (sin repetir). La página escucha el evento `easystem:pagos-cambiaron` de su contenedor para reaccionar. */
  metodosElegidos(): MetodoPago[] {
    return this.filas.map((f) => f.metodo).filter((m): m is MetodoPago => m !== '');
  }

  /** Fija el total a pagar. Si cambió desde la última vez, las filas se reinician. */
  establecerTotal(usd: number, totalBs: number | null = null) {
    this.total = usd;
    this.totalBs = totalBs;
    if (this.totalDeLasFilas !== usd) this.reiniciar();
    else this.pintar();
  }

  reiniciar() {
    this.filas = [{ metodo: '', monto: '' }];
    this.vueltoElegido = null;
    this.totalDeLasFilas = this.total;
    // Modo botones: ya viene elegido el último tipo de cobro usado, con el total completo
    if (this.rapido && this.metodoInicial && this.total > 0) {
      this.filas[0] = { metodo: this.metodoInicial, monto: this.montoEnMoneda(this.total, this.metodoInicial) };
    }
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
    // Si lo que falta es el total completo y hay precios fijos en Bs, se propone el monto exacto en bolívares (no el del dólar redondeado)
    if (this.totalBs !== null && Math.abs(usd - this.total) < 0.005) return textoMonto(this.totalBs);
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
    // El elemento pegado a los tipos de cobro se desprende antes de repintar para que el repintado no lo destruya (conserva lo escrito)
    this.extra?.remove();
    const unico = this.filas.length === 1;
    const botones = this.rapido && unico;

    const filasHtml = this.filas
      .map((f, i) => {
        const prefijo = f.metodo && esMetodoBolivares(f.metodo) ? 'Bs.' : '$';
        // Un solo pago en modo botones: solo el monto (el tipo ya está elegido arriba) y únicamente cuando ya se eligió el tipo
        if (botones) {
          if (!f.metodo) return '';
          return `
          <div data-fila="${i}" class="mt-3">
            <div class="flex items-center justify-between gap-3">
              <label class="text-sm text-slate-600 dark:text-slate-300">Cliente paga</label>
              <div class="relative w-44">
                <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">${prefijo}</span>
                <input data-pago-monto type="text" inputmode="decimal" autocomplete="off" aria-label="Monto con este tipo de cobro" placeholder="0,00" value="${escaparHtml(f.monto)}" class="${CLASE_MONTO_UNICO}" />
              </div>
            </div>
            <p data-pago-equiv class="mt-1 min-h-4 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400"></p>
          </div>`;
        }
        const usados = new Set(this.filas.filter((_, k) => k !== i).map((x) => x.metodo).filter(Boolean));
        const opciones =
          '<option value="">Tipo de cobro...</option>' +
          METODOS_PAGO.map((m) => `<option value="${m.valor}" ${f.metodo === m.valor ? 'selected' : ''} ${usados.has(m.valor) ? 'disabled' : ''}>${m.etiqueta}</option>`).join('');
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
              ${unico ? '' : `<button type="button" data-pago-completar ${f.metodo ? '' : 'disabled'} title="Poner lo que falta por pagar" class="shrink-0 rounded-lg border border-slate-200 px-2.5 py-2.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-slate-800">Completar</button>`}
            </div>
            <p data-pago-equiv class="mt-1 min-h-4 text-[11px] tabular-nums text-slate-500 dark:text-slate-400"></p>
          </div>`;
      })
      .join('');

    // Modo botones: una cuadrícula uniforme de 3 × 2 (los 5 tipos de cobro y «Dividir pago»); un toque basta
    const claseChip = 'flex h-11 items-center justify-center rounded-lg border px-1.5 text-center text-[13px] font-semibold leading-tight transition';
    const botonesHtml = botones
      ? `<div class="grid grid-cols-3 gap-2" role="group" aria-label="Cobrar con">${METODOS_PAGO.map((m) => {
          const activo = this.filas[0].metodo === m.valor;
          return `<button type="button" data-pago-rapido="${m.valor}" aria-pressed="${activo}" class="${claseChip} ${
            activo
              ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
              : 'border-slate-200 bg-white text-slate-700 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
          }">${ETIQUETA_COBRO_RAPIDO[m.valor as MetodoPago] ?? m.etiqueta}</button>`;
        }).join('')}<button type="button" data-pago-agregar class="${claseChip} border-dashed border-slate-300 bg-transparent text-slate-500 hover:border-brand-400 hover:text-brand-700 dark:border-slate-600 dark:text-slate-400 dark:hover:text-brand-300">Dividir pago</button></div>`
      : '';

    this.raiz.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Forma de pago</p>
        ${botones ? '' : '<button type="button" data-pago-agregar class="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">+ Agregar otra forma de pago</button>'}
      </div>
      ${botonesHtml ? `<div class="mt-2">${botonesHtml}</div>` : ''}
      <div data-slot-metodo></div>
      <div class="${botones ? '' : 'mt-2 space-y-2'}">${filasHtml}</div>
      <div data-vuelto class="mt-3 hidden"></div>`;
    if (this.extra) this.raiz.querySelector('[data-slot-metodo]')!.appendChild(this.extra);
    this.modoMostrado = '';
    this.actualizar();
    this.raiz.dispatchEvent(new CustomEvent('easystem:pagos-cambiaron', { bubbles: true }));
  }

  /** Qué pasa con lo recibido de más (ver `ModoVuelto`) según los pagos ya leídos. */
  private modoPara(pagos: PagoVenta[], exceso: number): ModoVuelto {
    if (exceso <= 0.01) return 'ninguno';
    const tasa = tasaActual.get();
    const absorbible = !!tasa && absorberExcesoEnBs(pagos, exceso, tasa) !== null;
    if (!absorbible) return 'obligado';
    return this.vueltoElegido === true ? 'elegible' : 'redondeo';
  }

  /** Bloque del vuelto o del redondeo (se repinta solo cuando cambia el modo, sin tocar las filas de pago). */
  private pintarVuelto(modo: ModoVuelto) {
    const caja = this.raiz.querySelector<HTMLElement>('[data-vuelto]')!;
    caja.classList.toggle('hidden', modo === 'ninguno');
    if (modo === 'ninguno') {
      caja.innerHTML = '';
      return;
    }
    const enlace = 'text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300';
    if (modo === 'redondeo') {
      caja.innerHTML = `
        <div class="rounded-lg bg-slate-100 px-3 py-2.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <p data-redondeo-texto></p>
          <button type="button" data-vuelto-dar="si" class="${enlace} mt-1">Dar vuelto en su lugar</button>
        </div>`;
      return;
    }
    const opcionesVuelto = METODOS_VUELTO.map((m) => `<option value="${m}" ${m === this.metodoVuelto ? 'selected' : ''}>${etiquetaMetodoPago(m)}</option>`).join('');
    caja.innerHTML = `
      <div class="rounded-lg bg-slate-100 px-3 py-2.5 dark:bg-slate-800">
        <p data-vuelto-monto class="text-sm font-semibold text-slate-800 dark:text-slate-100"></p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <label class="text-xs font-medium text-slate-600 dark:text-slate-400">Dar el vuelto en</label>
          <select data-vuelto-metodo aria-label="Tipo de cobro del vuelto" class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-base text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">${opcionesVuelto}</select>
        </div>
        ${modo === 'elegible' ? `<button type="button" data-vuelto-dar="no" class="${enlace} mt-2">Es redondeo, sin vuelto</button>` : ''}
      </div>`;
  }

  /** Actualiza equivalencias y el bloque del vuelto sin volver a pintar los campos (no se pierde el foco al escribir). */
  private actualizar() {
    const tasa = tasaActual.get();
    const unicoExacto = this.filas.length === 1 && Math.abs(this.asignadoExcepto(null) - this.total) <= 0.01;
    this.raiz.querySelectorAll<HTMLElement>('[data-fila]').forEach((el) => {
      const f = this.filas[Number(el.dataset.fila)];
      const usd = this.usdDeFila(f);
      const eq = el.querySelector<HTMLElement>('[data-pago-equiv]')!;
      // Un solo pago por el total exacto ya se ve arriba en el total: sin equivalencia repetida
      if (!f.metodo || usd === null || (this.rapido && unicoExacto)) eq.textContent = '';
      else if (esMetodoBolivares(f.metodo)) eq.textContent = `≈ ${formatearMoneda(usd)}`;
      else eq.textContent = tasa ? `≈ ${formatearBolivares(convertirABs(usd, tasa))}` : '';
    });

    const pagos = this.pagosLeidos();
    const exceso = pagos ? redondear(pagos.reduce((s, p) => s + p.monto_usd, 0) - this.total) : 0;
    const modo: ModoVuelto = pagos ? this.modoPara(pagos, exceso) : 'ninguno';
    if (modo !== this.modoMostrado) {
      this.modoMostrado = modo;
      this.pintarVuelto(modo);
    }
    if (!pagos || modo === 'ninguno') return;

    const textoRedondeo = this.raiz.querySelector<HTMLElement>('[data-redondeo-texto]');
    if (textoRedondeo) {
      // El cliente redondeó en bolívares: la venta sigue y queda anotado lo que pagó y lo que debía
      const p = tasa ? absorberExcesoEnBs(pagos, exceso, tasa)?.find((x) => bsDeMas(x) > 0) : undefined;
      textoRedondeo.textContent = p
        ? `Redondeo: pagó ${formatearBolivares(p.monto_bs!)} y debía ${formatearBolivares(p.monto_bs_debido!)} (${formatearBolivares(bsDeMas(p))} de más). La venta se registra igual.`
        : '';
    }
    const vueltoEl = this.raiz.querySelector<HTMLElement>('[data-vuelto-monto]');
    if (vueltoEl) {
      const v = this.armarVuelto(exceso);
      vueltoEl.textContent = !v ? 'Vuelto a entregar: falta la tasa del día.' : `Vuelto a entregar: ${v.monto_bs != null ? `${formatearBolivares(v.monto_bs)} (≈ ${formatearMoneda(v.monto_usd)})` : formatearMoneda(v.monto_usd)}`;
    }
  }

  /** Las filas ya leídas como pagos (sin validar contra el total), o null si algún campo no se puede leer todavía. */
  private pagosLeidos(): PagoVenta[] | null {
    const tasa = tasaActual.get();
    const pagos: PagoVenta[] = [];
    for (const f of this.filas) {
      const valor = f.metodo ? parsearMonto(f.monto) : null;
      if (!f.metodo || valor === null) return null;
      if (esMetodoBolivares(f.metodo)) {
        if (!tasa) return null;
        const bs = redondear(valor);
        pagos.push({ metodo: f.metodo, monto_bs: bs, monto_usd: redondear(bs / tasa) });
      } else {
        pagos.push({ metodo: f.metodo, monto_bs: null, monto_usd: redondear(valor) });
      }
    }
    return pagos;
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
      if (!f.metodo) {
        const mensaje = this.rapido && this.filas.length === 1 ? 'Elige cómo paga el cliente.' : 'Selecciona el tipo de cobro de cada forma de pago.';
        return error(mensaje, campoDe(i, '[data-pago-metodo]') ?? this.raiz.querySelector<HTMLElement>('[data-pago-rapido]'));
      }
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
      if (this.modoPara(pagos, dif) === 'redondeo') {
        // Pagó de más en bolívares (redondeo): se acepta y se anota lo que pagó y lo que debía
        const absorbidos = tasa ? absorberExcesoEnBs(pagos, dif, tasa) : null;
        if (absorbidos) return { ok: true, pagos: absorbidos, vuelto: null };
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
