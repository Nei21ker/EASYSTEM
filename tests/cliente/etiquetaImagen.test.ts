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

import { construirPdfDeJpegs } from '../../src/utils/etiquetaImagen';

describe('construirPdfDeJpegs', () => {
  const jpeg = (n: number) => ({ bytes: new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]), ancho: 591, alto: 354 });
  const texto = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

  it('es un PDF válido con una página por etiqueta y del tamaño exacto (50×30 mm = 141.73×85.04 pt)', () => {
    const t = texto(construirPdfDeJpegs([jpeg(1), jpeg(2), jpeg(3)], 50, 30));
    expect(t.startsWith('%PDF-1.4')).toBe(true);
    expect(t.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(t).toContain('/Count 3');
    expect((t.match(/\/Type \/Page /g) ?? []).length).toBe(3);
    expect((t.match(/\/MediaBox \[0 0 141\.73 85\.04\]/g) ?? []).length).toBe(3);
  });

  it('la tabla xref apunta exactamente al inicio de cada objeto', () => {
    const t = texto(construirPdfDeJpegs([jpeg(1), jpeg(2)], 50, 30));
    const inicioXref = Number(/startxref\n(\d+)/.exec(t)![1]);
    expect(t.slice(inicioXref, inicioXref + 4)).toBe('xref');
    const entradas = [...t.slice(inicioXref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entradas).toHaveLength(8); // catálogo, páginas y 3 objetos por página
    entradas.forEach((pos, i) => expect(t.slice(pos, pos + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it('guarda los bytes del JPEG sin alterarlos y rechaza un PDF sin páginas', () => {
    const pdf = construirPdfDeJpegs([jpeg(7)], 40, 25);
    expect(texto(pdf).indexOf('stream\nÿØ\u0007ÿÙ')).toBeGreaterThan(0);
    expect(() => construirPdfDeJpegs([], 40, 25)).toThrow(/páginas/);
  });
});
