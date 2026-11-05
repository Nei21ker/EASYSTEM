import { describe, expect, it } from 'vitest';
import { FORMATOS_ETIQUETA } from '../../src/utils/etiquetas';
import { ajustarNombre, nombreArchivoEtiqueta, partirEnLineas, svgEtiqueta, DPI_IMAGEN } from '../../src/utils/etiquetaImagen';

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

/** Los renglones de texto de la etiqueta, unidos. */
const textoDe = (svg: string) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');

describe('svgEtiqueta', () => {
  it('tiene el tamaño exacto del rollo a 300 dpi y fondo blanco', () => {
    const svg = svgEtiqueta({ codigo: '2100000000012', nombre: 'Cargador Honor sencillo Tipo C' }, rollo50x30);
    expect(svg).toContain(`width="${mmAPx(50)}" height="${mmAPx(30)}"`);
    expect(svg).toContain('fill="#fff"');
    const chica = svgEtiqueta({ codigo: '2100000000012', nombre: 'X' }, rollo40x25);
    expect(chica).toContain(`width="${mmAPx(40)}" height="${mmAPx(25)}"`);
  });

  it('con QR lleva el QR, el nombre y debajo el código escrito; con barras, las barras y los mismos textos', () => {
    const e = { codigo: 'INF000001', nombre: 'Cargador Tecno doble usb' };
    const conQr = svgEtiqueta(e, rollo50x30, 'qr');
    expect(conQr).not.toContain('>N.º');
    expect(textoDe(conQr)).toBe('Cargador Tecno doble usb INF000001');
    expect(conQr).toContain('<svg x='); // el QR va incrustado
    const conBarras = svgEtiqueta(e, rollo50x30, 'barras');
    expect(conBarras).not.toContain('>N.º');
    expect(conBarras).toContain('aria-label="Código de barras INF000001"');
    expect(textoDe(conBarras)).toBe('Cargador Tecno doble usb INF000001');
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

describe('nombre grande y centrado', () => {
  const tam = (svg: string) => Number(/font-size="(\d+)"/.exec(svg)![1]);

  it('un nombre corto se imprime más grande que uno largo, y siempre cabe en la etiqueta', () => {
    const corto = ajustarNombre('Cargador Tecno', 260, 300, 30, 90, 3);
    const largo = ajustarNombre('Cargador Infinix doble usb Micro-USB reforzado', 260, 300, 30, 90, 3);
    expect(corto.tam).toBeGreaterThan(largo.tam);
    for (const r of [corto, largo]) {
      expect(r.lineas.length).toBeLessThanOrEqual(3);
      expect(r.lineas.length * r.tam * 1.15).toBeLessThanOrEqual(300 + 1);
    }
  });

  it('prefiere no cortar el nombre: usa una letra menor antes de poner puntos suspensivos', () => {
    const r = ajustarNombre('Cargador Infinix doble usb Micro-USB', 260, 300, 30, 90, 3);
    expect(r.lineas.join(' ')).toBe('Cargador Infinix doble usb Micro-USB');
  });

  it('el nombre sale centrado (text-anchor middle) y más grande que la letra base del formato, con QR y con barras', () => {
    const e = { codigo: '2100000000012', nombre: 'Cargador Honor' };
    const baseQr = Math.round((rollo50x30.nombrePt / 72) * DPI_IMAGEN);
    for (const tipo of ['qr', 'barras'] as const) {
      const svg = svgEtiqueta(e, rollo50x30, tipo);
      expect(svg).toContain('text-anchor="middle"');
      expect(tam(svg)).toBeGreaterThan(baseQr);
    }
  });

  it('con QR el nombre queda dentro de la etiqueta, a la derecha del código', () => {
    const svg = svgEtiqueta({ codigo: '2100000000012', nombre: 'Cargador Honor sencillo Tipo C' }, rollo50x30, 'qr');
    const W = mmAPx(50);
    for (const m of svg.matchAll(/<text x="([\d.]+)"/g)) {
      expect(Number(m[1])).toBeGreaterThan(mmAPx(22)); // pasado el QR
      expect(Number(m[1])).toBeLessThan(W);
    }
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

  it('21 etiquetas de 50×25 mm salen como 21 páginas, cada una de 141.73×70.87 pt (una etiqueta por página)', () => {
    const t = texto(construirPdfDeJpegs(Array.from({ length: 21 }, (_, i) => jpeg(i)), 50, 25));
    expect(t).toContain('/Count 21');
    expect((t.match(/\/MediaBox \[0 0 141\.73 70\.87\]/g) ?? []).length).toBe(21);
  });

  it('guarda los bytes del JPEG sin alterarlos y rechaza un PDF sin páginas', () => {
    const pdf = construirPdfDeJpegs([jpeg(7)], 40, 25);
    expect(texto(pdf).indexOf('stream\nÿØ\u0007ÿÙ')).toBeGreaterThan(0);
    expect(() => construirPdfDeJpegs([], 40, 25)).toThrow(/páginas/);
  });
});

describe('renglones parejos', () => {
  it('no deja una palabra suelta sola en el último renglón', () => {
    const r = ajustarNombre('Cargador Honor sencillo Tipo C', 300, 300, 30, 90, 3);
    expect(r.lineas.every((l) => l.length >= 5)).toBe(true);
    expect(r.lineas.join(' ')).toBe('Cargador Honor sencillo Tipo C');
  });
});

describe('formato de rollo 50 × 25 mm', () => {
  it('existe en la lista fija y no cambia el formato por defecto', () => {
    const f = FORMATOS_ETIQUETA.find((x) => x.id === 'rollo-50x25');
    expect(f).toMatchObject({ anchoMm: 50, altoMm: 25 });
    expect(FORMATOS_ETIQUETA[0].id).toBe('rollo-50x30');
  });
});

describe('el código de la unidad se imprime bajo el nombre', () => {
  const e = { codigo: 'INF000014', nombre: 'Cargador Infinix 20W' };
  const textos = (svg: string) => [...svg.matchAll(/<text [^>]*y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ y: Number(m[1]), texto: m[2] }));

  it('con QR y con barras el código sale DEBAJO del nombre y dentro de la etiqueta', () => {
    for (const tipo of ['qr', 'barras'] as const) {
      const lineas = textos(svgEtiqueta(e, rollo50x30, tipo));
      const codigo = lineas.find((l) => l.texto === 'INF000014')!;
      const nombre = lineas.filter((l) => l.texto !== 'INF000014');
      expect(codigo).toBeDefined();
      expect(nombre.length).toBeGreaterThan(0);
      for (const l of nombre) expect(codigo.y).toBeGreaterThan(l.y);
      expect(codigo.y).toBeLessThan(mmAPx(30));
    }
  });

  it('también con un nombre largo y en el rollo más chico (50 × 25)', () => {
    const chico = FORMATOS_ETIQUETA.find((f) => f.id === 'rollo-50x25')!;
    const svg = svgEtiqueta({ codigo: 'INF000014', nombre: 'Cargador Infinix doble usb Micro-USB reforzado 30W' }, chico, 'qr');
    const codigo = textos(svg).find((l) => l.texto === 'INF000014')!;
    expect(codigo.y).toBeLessThan(mmAPx(25));
  });
});
