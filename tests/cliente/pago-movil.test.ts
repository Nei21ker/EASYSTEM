// Datos del promotor para el pago móvil: monto en Bs al cambio de hoy y textos listos para copiar.
import { describe, expect, it } from 'vitest';
import { bsDeHoy, htmlBotonesCopiarPago, htmlMontoDividido, montoBsParaBanco, partesUsdYBs, soloDigitos, textoDatosPagoMovil, textoUsdYBs } from '../../src/utils/pagoMovil';

const promotor = { nombre: 'Eliezer Vasquez', cedula: 'V-27868051', telefono: '0424-531 6626', banco: 'Provincial', montoUsd: 3.78 };

describe('pagoMovil', () => {
  it('soloDigitos deja solo números (la cédula y el teléfono como los pide el banco)', () => {
    expect(soloDigitos('V-27.868.051')).toBe('27868051');
    expect(soloDigitos('0424-531 6626')).toBe('04245316626');
    expect(soloDigitos(null)).toBe('');
  });

  it('el monto en Bs sale de los dólares × la tasa de hoy; sin tasa no hay Bs', () => {
    expect(bsDeHoy(3.78, 900)).toBe(3402);
    expect(bsDeHoy(3.78, null)).toBeNull();
    expect(textoUsdYBs(3.78, 900)).toContain('3.402,00');
    expect(textoUsdYBs(3.78, null)).not.toContain('Bs');
  });

  it('montoBsParaBanco usa coma decimal y no separa miles', () => {
    expect(montoBsParaBanco(3402)).toBe('3402,00');
    expect(montoBsParaBanco(1234567.5)).toBe('1234567,50');
  });

  it('textoDatosPagoMovil junta nombre, cédula, teléfono, banco y monto en Bs y $', () => {
    const t = textoDatosPagoMovil(promotor, 900);
    expect(t).toContain('Nombre: Eliezer Vasquez');
    expect(t).toContain('Cédula: V-27868051');
    expect(t).toContain('Banco: Provincial');
    expect(t).toMatch(/Monto: Bs\. 3\.402,00 \(\$3\.78\)/);
    expect(textoDatosPagoMovil({ ...promotor, banco: null }, 900)).toContain('Banco: (sin registrar)');
  });

  it('hay un solo botón de copiar y lleva todos los datos del pago', () => {
    const html = htmlBotonesCopiarPago(promotor, 900);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('Cédula: V-27868051');
    expect(html).toContain('Teléfono: 0424-531 6626');
    expect(html).toContain('Bs. 3.402,00');
    expect(html).not.toContain('>Cédula<');
    expect(html).not.toContain('Monto Bs');
  });

  it('el monto se parte en dos mitades con una barra: dólares a la izquierda y bolívares a la derecha', () => {
    expect(partesUsdYBs(3.78, 900)).toEqual({ usd: '$3.78', bs: 'Bs. 3.402,00' });
    expect(textoUsdYBs(3.78, 900)).toBe('$3.78 | Bs. 3.402,00');
    const html = htmlMontoDividido(3.78, 900);
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('border-l');
    expect(html).toContain('3.402,00');
    expect(html).not.toContain('·');
    const sinTasa = htmlMontoDividido(3.78, null);
    expect(sinTasa).not.toContain('border-l');
    expect(sinTasa).toContain('$3.78');
  });

  it('un nombre con comillas no rompe el atributo del botón', () => {
    const html = htmlBotonesCopiarPago({ ...promotor, nombre: 'Ana "la jefa" <b>' }, 900);
    expect(html).not.toContain('"la jefa"');
    expect(html).toContain('&quot;la jefa&quot;');
  });
});
