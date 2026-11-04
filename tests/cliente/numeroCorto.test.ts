import { describe, expect, it } from 'vitest';
import { codigoDeNumeroCorto, construirCodigoUnidad, numeroCortoUnidad } from '../../src/utils/codigos';
import { FORMATOS_ETIQUETA, htmlEtiqueta } from '../../src/utils/etiquetas';
import { svgEtiqueta } from '../../src/utils/etiquetaImagen';

const rollo = FORMATOS_ETIQUETA[0];

describe('número corto de una unidad', () => {
  it('las unidades 7 y 8 llevan códigos que NO parecen seguidos (el dígito verificador cambia el final), pero sus números cortos sí', () => {
    expect(construirCodigoUnidad(7)).toBe('2100000000074');
    expect(construirCodigoUnidad(8)).toBe('2100000000081');
    expect(numeroCortoUnidad('2100000000074')).toBe(7);
    expect(numeroCortoUnidad('2100000000081')).toBe(8);
  });

  it('solo los códigos de unidad válidos tienen número corto', () => {
    expect(numeroCortoUnidad('2000000000015')).toBeNull(); // código de producto
    expect(numeroCortoUnidad('2100000000075')).toBeNull(); // dígito verificador incorrecto
    expect(numeroCortoUnidad('abc')).toBeNull();
  });

  it('ida y vuelta: del número corto se obtiene el código completo', () => {
    for (const n of [1, 7, 74, 999, 1234567]) expect(numeroCortoUnidad(codigoDeNumeroCorto(String(n))!)).toBe(n);
    expect(codigoDeNumeroCorto(' 7 ')).toBe('2100000000074');
  });

  it('no confunde con otros códigos: cero, demasiado largo, con letras o un código de barras normal', () => {
    for (const malo of ['0', '', '12345678', '2100000000074', '7a', '-3', '7.5']) expect(codigoDeNumeroCorto(malo)).toBeNull();
  });
});

describe('texto de la etiqueta', () => {
  it('la etiqueta (imagen y HTML) NO imprime ni el número ni el código largo: solo el nombre; el QR conserva el código completo', () => {
    const e = { codigo: '2100000000074', nombre: 'Cargador Honor' };
    const svg = svgEtiqueta(e, rollo, 'qr');
    expect(svg).not.toContain('N.º');
    expect(svg).not.toContain('>2100000000074<');
    expect([...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ')).toBe('Cargador Honor');
    expect(svg).toContain('aria-label="Código QR 2100000000074"'); // el QR lleva el código por dentro
    const html = htmlEtiqueta(e, rollo, 'qr');
    expect(html).not.toContain('N.º');
    expect(html).not.toContain('>2100000000074<');
    expect(html).toContain('Cargador Honor');
    const barras = svgEtiqueta(e, rollo, 'barras');
    expect(barras).not.toContain('N.º');
    expect(barras).not.toContain('>2100000000074<');
  });
});
