// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { FormularioPagos } from '../../src/utils/formularioPagos';
import { tasaActual } from '../../src/stores/tasa';

let raiz: HTMLElement;
let f: FormularioPagos;
const clic = (sel: string) => (raiz.querySelector(sel) as HTMLElement).click();
const escribir = (sel: string, valor: string) => {
  const el = raiz.querySelector(sel) as HTMLInputElement;
  el.value = valor;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div><div id="ref"><input id="refin" /></div>';
  raiz = document.getElementById('r')!;
  tasaActual.set(900);
  f = new FormularioPagos(raiz);
  f.activarCobroRapido(null);
});

describe('formulario de pagos (modo botones)', () => {
  it('6 botones uniformes (5 tipos + Dividir pago), sin monto hasta elegir tipo', () => {
    expect(raiz.querySelectorAll('[data-pago-rapido]').length).toBe(5);
    expect(raiz.querySelectorAll('[data-pago-agregar]').length).toBe(1);
    expect(raiz.querySelector('[data-pago-monto]')).toBeNull();
    f.establecerTotal(1.22, 1100);
    const l = f.leer();
    expect(l.ok).toBe(false);
  });

  it('un toque en Pago móvil pone el total exacto en Bs; sin vuelto, sin Completar, sin check', () => {
    f.establecerTotal(1.22, 1100);
    clic('[data-pago-rapido="BS_PAGO_MOVIL"]');
    expect((raiz.querySelector('[data-pago-monto]') as HTMLInputElement).value).toBe('1100,00');
    expect(raiz.querySelector('[data-pago-completar]')).toBeNull();
    expect(raiz.querySelector('[data-vuelto]')!.classList.contains('hidden')).toBe(true);
    expect(raiz.textContent).not.toContain('Pagos completos');
    const l = f.leer();
    expect(l.ok && l.pagos[0]).toMatchObject({ metodo: 'BS_PAGO_MOVIL', monto_bs: 1100 });
    expect(l.ok && l.vuelto).toBeNull();
  });

  it('el último método viene marcado y con el monto', () => {
    f = new FormularioPagos(raiz);
    f.activarCobroRapido('BS_PUNTO_VENTA');
    f.establecerTotal(10, null);
    expect(raiz.querySelector('[data-pago-rapido="BS_PUNTO_VENTA"]')!.getAttribute('aria-pressed')).toBe('true');
    expect((raiz.querySelector('[data-pago-monto]') as HTMLInputElement).value).toBe('9000,00');
  });

  it('efectivo $ con billete mayor: vuelto obligatorio y automático', () => {
    f.establecerTotal(3, null);
    clic('[data-pago-rapido="USD_EFECTIVO"]');
    escribir('[data-pago-monto]', '5');
    expect(raiz.querySelector('[data-vuelto]')!.classList.contains('hidden')).toBe(false);
    expect(raiz.querySelector('[data-vuelto-monto]')!.textContent).toContain('$2.00');
    expect(raiz.querySelector('[data-vuelto-dar="no"]')).toBeNull();
    const l = f.leer();
    expect(l.ok && l.vuelto).toMatchObject({ monto_usd: 2 });
    expect(l.ok && l.pagos[0].monto_usd).toBe(5);
  });

  it('en Bs, redondeo hacia arriba: se acepta sin vuelto y se puede cambiar a vuelto', () => {
    f.establecerTotal(1.22, 1100);
    clic('[data-pago-rapido="BS_PAGO_MOVIL"]');
    escribir('[data-pago-monto]', '1150');
    expect(raiz.querySelector('[data-redondeo-texto]')!.textContent).toContain('de más');
    let l = f.leer();
    expect(l.ok && l.vuelto).toBeNull();
    expect(l.ok && l.pagos[0].monto_bs_debido).toBeTruthy();
    clic('[data-vuelto-dar="si"]');
    expect(raiz.querySelector('[data-vuelto-monto]')).not.toBeNull();
    l = f.leer();
    expect(l.ok && l.vuelto).not.toBeNull();
    clic('[data-vuelto-dar="no"]');
    l = f.leer();
    expect(l.ok && l.vuelto).toBeNull();
  });

  it('falta monto: error claro', () => {
    f.establecerTotal(3, null);
    clic('[data-pago-rapido="USD_EFECTIVO"]');
    escribir('[data-pago-monto]', '1');
    const l = f.leer();
    expect(!l.ok && l.mensaje).toMatch(/Falta por asignar/);
  });

  it('Dividir pago: filas con selector y Completar; volver a una sola fila trae los botones', () => {
    f.establecerTotal(10, null);
    clic('[data-pago-rapido="USD_EFECTIVO"]');
    clic('[data-pago-agregar]');
    expect(raiz.querySelectorAll('[data-fila]').length).toBe(2);
    expect(raiz.querySelectorAll('[data-pago-completar]').length).toBe(2);
    expect(raiz.querySelector('[data-pago-rapido]')).toBeNull();
    clic('[data-fila="1"] [data-pago-quitar]');
    expect(raiz.querySelectorAll('[data-pago-rapido]').length).toBe(5);
  });

  it('el bloque extra (referencia) se conserva entre repintados con lo escrito', () => {
    const extra = document.getElementById('refin')!.parentElement!;
    f.fijarExtraBajoMetodos(extra);
    (document.getElementById('refin') as HTMLInputElement).value = '1234';
    f.establecerTotal(5, null);
    clic('[data-pago-rapido="BS_PAGO_MOVIL"]');
    clic('[data-pago-rapido="BS_PUNTO_VENTA"]');
    expect(raiz.querySelector('[data-slot-metodo]')!.contains(extra)).toBe(true);
    expect((document.getElementById('refin') as HTMLInputElement).value).toBe('1234');
    expect(f.metodosElegidos()).toEqual(['BS_PUNTO_VENTA']);
  });
});

describe('formulario de pagos (modo clásico, Devoluciones)', () => {
  it('conserva el selector y no muestra vuelto cuando el pago es exacto', () => {
    const g = new FormularioPagos(raiz);
    g.establecerTotal(10, null);
    expect(raiz.querySelector('[data-pago-metodo]')).not.toBeNull();
    expect(raiz.querySelector('[data-vuelto]')!.classList.contains('hidden')).toBe(true);
  });
});
