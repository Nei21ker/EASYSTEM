import { describe, expect, it } from 'vitest';
import { FORMATOS_ETIQUETA, FORMATO_PERSONALIZADO_ID, buscarFormatoEtiqueta, formatoPersonalizado, htmlEtiqueta } from '../../src/utils/etiquetas';
import { svgEtiqueta } from '../../src/utils/etiquetaImagen';

describe('formatoPersonalizado', () => {
  it('toma el ancho y el alto que se le dan y se identifica como personalizado', () => {
    const f = formatoPersonalizado(60, 40);
    expect(f.id).toBe(FORMATO_PERSONALIZADO_ID);
    expect(f.anchoMm).toBe(60);
    expect(f.altoMm).toBe(40);
    expect(f.nombre).toContain('60 × 40');
    expect(f.hoja).toBeUndefined(); // una etiqueta por página (rollo)
  });

  it('el QR, las barras y la letra se ajustan al tamaño y se parecen a los formatos de rollo conocidos', () => {
    const f = formatoPersonalizado(50, 30);
    const conocido = FORMATOS_ETIQUETA.find((x) => x.id === 'rollo-50x30')!;
    expect(Math.abs(f.qrMm - conocido.qrMm)).toBeLessThanOrEqual(1);
    expect(Math.abs(f.barrasMm - conocido.barrasMm)).toBeLessThanOrEqual(1);
    expect(Math.abs(f.nombrePt - conocido.nombrePt)).toBeLessThanOrEqual(0.5);
  });

  it('el formato fijo de 40 × 30 mm existe y coincide con lo que calcularía el tamaño personalizado', () => {
    const fijo = FORMATOS_ETIQUETA.find((x) => x.id === 'rollo-40x30')!;
    expect(fijo).toBeDefined();
    expect([fijo.anchoMm, fijo.altoMm]).toEqual([40, 30]);
    const calculado = formatoPersonalizado(40, 30);
    expect(fijo.qrMm).toBe(calculado.qrMm);
    expect(fijo.barrasMm).toBe(calculado.barrasMm);
    expect(fijo.nombrePt).toBe(calculado.nombrePt);
  });

  it('una etiqueta más grande lleva QR y letra más grandes', () => {
    const chica = formatoPersonalizado(40, 25);
    const grande = formatoPersonalizado(100, 60);
    expect(grande.qrMm).toBeGreaterThan(chica.qrMm);
    expect(grande.nombrePt).toBeGreaterThan(chica.nombrePt);
  });

  it('el QR nunca es más alto que la etiqueta ni ocupa más de la mitad de su ancho', () => {
    for (const [ancho, alto] of [[30, 30], [80, 20], [120, 100], [25, 12]] as const) {
      const f = formatoPersonalizado(ancho, alto);
      expect(f.qrMm).toBeLessThanOrEqual(alto - 3);
      expect(f.qrMm).toBeLessThanOrEqual(ancho / 2);
    }
  });

  it('mantiene los valores dentro de lo razonable: ancho 20–120 mm, alto 12–100 mm', () => {
    expect(formatoPersonalizado(5, 5)).toMatchObject({ anchoMm: 20, altoMm: 12 });
    expect(formatoPersonalizado(500, 500)).toMatchObject({ anchoMm: 120, altoMm: 100 });
  });

  it('un valor que no es número (campo vacío o texto) vuelve al tamaño del rollo por defecto', () => {
    expect(formatoPersonalizado(NaN, NaN)).toMatchObject({ anchoMm: 50, altoMm: 30 });
    expect(formatoPersonalizado(Number('abc'), 40)).toMatchObject({ anchoMm: 50, altoMm: 40 });
  });

  it('acepta decimales con un solo decimal (por ejemplo 38,5 mm)', () => {
    expect(formatoPersonalizado(38.46, 25.04)).toMatchObject({ anchoMm: 38.5, altoMm: 25 });
  });
});

describe('buscarFormatoEtiqueta con tamaño personalizado', () => {
  it('con el id "personalizado" usa el tamaño indicado', () => {
    const f = buscarFormatoEtiqueta(FORMATO_PERSONALIZADO_ID, { anchoMm: 45, altoMm: 28 });
    expect(f.anchoMm).toBe(45);
    expect(f.altoMm).toBe(28);
  });

  it('sin tamaño indicado, "personalizado" cae en el rollo por defecto', () => {
    expect(buscarFormatoEtiqueta(FORMATO_PERSONALIZADO_ID)).toMatchObject({ anchoMm: 50, altoMm: 30 });
  });

  it('los formatos de siempre siguen igual', () => {
    expect(buscarFormatoEtiqueta('a4-3x8').hoja).toEqual({ columnas: 3, filas: 8 });
    expect(buscarFormatoEtiqueta('no-existe').id).toBe(FORMATOS_ETIQUETA[0].id);
  });
});

describe('etiquetas con el formato personalizado', () => {
  const e = { codigo: '2100000000741', nombre: 'Cargador Honor sencillo Tipo C' };

  it('la etiqueta en imagen mide exactamente el tamaño pedido a 300 dpi', () => {
    const f = formatoPersonalizado(60, 40);
    const svg = svgEtiqueta(e, f);
    expect(svg).toContain(`width="${Math.round((60 / 25.4) * 300)}"`);
    expect(svg).toContain(`height="${Math.round((40 / 25.4) * 300)}"`);
  });

  it('la etiqueta en HTML usa ese ancho y alto', () => {
    const html = htmlEtiqueta(e, formatoPersonalizado(60, 40));
    expect(html).toContain('60mm');
    expect(html).toContain('40mm');
  });
});
