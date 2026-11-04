import { describe, expect, it } from 'vitest';
import { FORMATOS_ETIQUETA } from '../../src/utils/etiquetas';
import { nombreArchivoEtiqueta, partirEnLineas, svgEtiqueta, DPI_IMAGEN } from '../../src/utils/etiquetaImagen';

const rollo50x30 = FORMATOS_ETIQUETA.find((f) => f.id === 'rollo-50x30')!;
const rollo40x25 = FORMATOS_ETIQUETA.find((f) => f.id === 'rollo-40x25')!;
const mmAPx = (mm: number) => Math.round((mm / 25.4) * DPI_IMAGEN);

describe('partirEnLineas', () => {
  it('parte por palabras sin pasar del ancho y respeta el máximo de renglones', () => {
    expect(partirEnLineas('Cargador Infinix doble usb Micro-USB', 16, 3)).toEqual(['Cargador Infinix', 'doble usb', 'Micro-USB']);
  });

  it('corta con puntos suspensivos lo que no cabe en los renglones permitidos', () => {
    const lineas = partirEnLineas('Cargador Tecno sencillo con cable extra largo reforzado', 12, 2);
    expect(lineas).toHaveLength(2);
    expect(lineas[1].endsWith('…')).toBe(true);
    expect(lineas.every((l) => l.length <= 12)).toBe(true);
  });

  it('una palabra más larga que el renglón se recorta y un texto vacío da cero renglones', () => {
    expect(partirEnLineas('Supercalifragilistico', 8, 2)[0]).toHaveLength(8);
    expect(partirEnLineas('   ', 8, 2)).toEqual([]);
  });
});

describe('svgEtiqueta', () => {
  it('tiene el tamaño exacto del rollo a 300 dpi y fondo blanco', () => {
    const svg = svgEtiqueta({ codigo: '2100000000012', nombre: 'Cargador Honor sencillo Tipo C' }, rollo50x30);
    expect(svg).toContain(`width="${mmAPx(50)}" height="${mmAPx(30)}"`);
    expect(svg).toContain('fill="#fff"');
    const chica = svgEtiqueta({ codigo: '2100000000012', nombre: 'X' }, rollo40x25);
    expect(chica).toContain(`width="${mmAPx(40)}" height="${mmAPx(25)}"`);
  });

  it('con QR lleva el código, el número y el nombre; con barras, las barras y los mismos textos', () => {
    const e = { codigo: '2100000000012', nombre: 'Cargador Tecno doble usb' };
    const conQr = svgEtiqueta(e, rollo50x30, 'qr');
    expect(conQr).toContain('>2100000000012</text>');
    expect(conQr).toContain('Cargador Tecno');
    expect(conQr).toContain('<svg x='); // el QR va incrustado
    const conBarras = svgEtiqueta(e, rollo50x30, 'barras');
    expect(conBarras).toContain('>2100000000012</text>');
    expect(conBarras).toContain('aria-label="Código de barras 2100000000012"');
    expect(conBarras).not.toBe(conQr);
  });

  it('escapa los caracteres especiales del nombre (no rompe el SVG)', () => {
    const svg = svgEtiqueta({ codigo: '2100000000012', nombre: 'Cable <USB> & "Tipo C"' }, rollo50x30);
    expect(svg).toContain('&lt;USB&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).not.toContain('<USB>');
  });

  it('un código que no se puede dibujar en barras deja un aviso en vez de una etiqueta vacía', () => {
    const svg = svgEtiqueta({ codigo: 'código ñandú', nombre: 'Prueba' }, rollo50x30, 'barras');
    expect(svg).toContain('Código no imprimible');
  });
});

describe('nombreArchivoEtiqueta', () => {
  it('usa el código único y nunca deja caracteres raros', () => {
    expect(nombreArchivoEtiqueta('2100000000012')).toBe('etiqueta-2100000000012.png');
    expect(nombreArchivoEtiqueta('../x y.png')).toBe('etiqueta-xypng.png');
  });
});
