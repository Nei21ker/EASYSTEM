import { describe, expect, it } from 'vitest';
import { agruparPorCategoria, htmlInventarioPorPieza, htmlInventarioPorProducto, type FilaInventario, type PiezaInventario } from '../../src/utils/hojasImpresas';

const filas: FilaInventario[] = [
  { categoria: 'Forros', codigo: '2000000000015', nombre: 'Forro iPhone 11', stock: 12 },
  { categoria: 'Cables', codigo: '2000000000022', nombre: 'Cable USB tipo C', stock: 5 },
  { categoria: 'Forros', codigo: '2000000000039', nombre: 'Forro Samsung A54', stock: 8 },
  { categoria: '', codigo: '2000000000046', nombre: 'Producto suelto', stock: 0 },
];
const base = { local: 'Local Accesorios', ahora: new Date('2026-11-04T15:30:00.000Z'), impresoPor: 'Ana Pérez' };

describe('agruparPorCategoria', () => {
  it('ordena las categorías y los productos alfabéticamente y manda lo sin categoría al final', () => {
    const g = agruparPorCategoria(filas);
    expect(g.map((x) => x.categoria)).toEqual(['Cables', 'Forros', 'Sin categoría']);
    expect(g[1].filas.map((f) => f.nombre)).toEqual(['Forro iPhone 11', 'Forro Samsung A54']);
  });
});

describe('htmlInventarioPorProducto', () => {
  it('lleva el local, la fecha de las existencias y quién imprime', () => {
    const html = htmlInventarioPorProducto({ ...base, filas });
    expect(html).toContain('Inventario físico');
    expect(html).toContain('Local Accesorios');
    expect(html).toContain('Ana Pérez');
    expect(html).toContain('2026');
  });

  it('lista cada producto con su código y la cantidad que dice el sistema', () => {
    const html = htmlInventarioPorProducto({ ...base, filas });
    for (const f of filas) {
      expect(html).toContain(f.nombre);
      expect(html).toContain(f.codigo);
    }
    expect(html).toMatch(/Forro iPhone 11[\s\S]*?>12</);
  });

  it('deja columnas en blanco para anotar lo contado y la diferencia', () => {
    const html = htmlInventarioPorProducto({ ...base, filas });
    expect(html).toContain('Contado');
    expect(html).toContain('Diferencia');
    expect(html.match(/class="hi-blanco"/g)?.length).toBe(filas.length * 2);
  });

  it('da el subtotal de unidades de cada categoría y el total general', () => {
    const html = htmlInventarioPorProducto({ ...base, filas });
    expect(html).toMatch(/Forros[^<]*<\/h2>/);
    expect(html).toMatch(/Subtotal Forros[\s\S]*?>20</); // 12 + 8
    expect(html).toMatch(/Total de unidades:?\s*<\/strong>\s*25/);
    expect(html).toMatch(/Productos:?\s*<\/strong>\s*4/);
  });

  it('trae las líneas de firma de quien cuenta y quien revisa', () => {
    const html = htmlInventarioPorProducto({ ...base, filas });
    expect(html).toContain('Contó');
    expect(html).toContain('Revisó');
  });

  it('escapa el HTML de los nombres', () => {
    const html = htmlInventarioPorProducto({ ...base, filas: [{ categoria: '<i>x</i>', codigo: '1', nombre: '<script>alert(1)</script>', stock: 1 }] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sin productos avisa que no hay nada que contar', () => {
    expect(htmlInventarioPorProducto({ ...base, filas: [] })).toContain('No hay productos');
  });
});

const piezas: PiezaInventario[] = [
  { codigo: '2100000000012', producto_id: 'p1', nombre: 'Forro iPhone 11', categoria: 'Forros' },
  { codigo: '2100000000029', producto_id: 'p1', nombre: 'Forro iPhone 11', categoria: 'Forros' },
  { codigo: '2100000000036', producto_id: 'p1', nombre: 'Forro iPhone 11', categoria: 'Forros' },
  { codigo: '2100000000043', producto_id: 'p1', nombre: 'Forro iPhone 11', categoria: 'Forros' },
  { codigo: '2100000000050', producto_id: 'p2', nombre: 'Cable USB tipo C', categoria: 'Cables' },
];

describe('htmlInventarioPorPieza', () => {
  it('lista el código de CADA pieza con su casilla para marcarla como encontrada', () => {
    const html = htmlInventarioPorPieza({ ...base, piezas });
    for (const p of piezas) expect(html).toContain(p.codigo);
    expect(html.match(/☐/g)?.length).toBe(piezas.length);
  });

  it('agrupa por producto con su cantidad según el sistema', () => {
    const html = htmlInventarioPorPieza({ ...base, piezas });
    expect(html).toMatch(/Forro iPhone 11[\s\S]*?4 piezas/);
    expect(html).toMatch(/Cable USB tipo C[\s\S]*?1 pieza\b/);
  });

  it('da el total de piezas y deja una línea para anotar las que sobran o faltan', () => {
    const html = htmlInventarioPorPieza({ ...base, piezas });
    expect(html).toMatch(/Total de piezas:?\s*<\/strong>\s*5/);
    expect(html).toContain('Piezas que sobran');
    expect(html).toContain('Piezas que faltan');
  });

  it('con muchas piezas imprime todas, sin cortar la lista', () => {
    const muchas: PiezaInventario[] = Array.from({ length: 700 }, (_, i) => ({ codigo: `21${String(i).padStart(11, '0')}`, producto_id: 'p', nombre: 'Pieza', categoria: 'Varios' }));
    expect(htmlInventarioPorPieza({ ...base, piezas: muchas }).match(/☐/g)?.length).toBe(700);
  });

  it('sin piezas avisa que no hay nada que contar', () => {
    expect(htmlInventarioPorPieza({ ...base, piezas: [] })).toContain('No hay piezas');
  });
});
