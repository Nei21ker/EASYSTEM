import { describe, expect, it } from 'vitest';
import { htmlHojaDespacho, resumenPorProducto } from '../../src/utils/hojasImpresas';
import type { Traslado } from '../../src/types/database.types';

const traslado = (cambios: Partial<Traslado> = {}): Traslado => ({
  id: 't1',
  folio: 7,
  origen_local_id: 'o',
  destino_local_id: 'd',
  origen_nombre: 'Local Accesorios',
  destino_nombre: 'Local Vidrios',
  estado: 'EN_TRANSITO',
  creado_en: '2026-11-04T15:30:00.000Z',
  enviado_por: 'Ana Pérez',
  recibido_en: null,
  recibido_por: null,
  cerrado_en: null,
  notas: null,
  unidades: [
    { codigo: '2100000000012', producto_id: 'p1', producto_nombre: 'Forro iPhone 11', recibida_en: null, devuelta_en: null },
    { codigo: '2100000000029', producto_id: 'p1', producto_nombre: 'Forro iPhone 11', recibida_en: null, devuelta_en: null },
    { codigo: '2100000000036', producto_id: 'p2', producto_nombre: 'Cable USB tipo C', recibida_en: null, devuelta_en: null },
  ],
  ...cambios,
});

describe('resumenPorProducto', () => {
  it('agrupa las piezas por producto, con su cantidad, en orden alfabético', () => {
    expect(resumenPorProducto(traslado().unidades)).toEqual([
      { producto_id: 'p2', nombre: 'Cable USB tipo C', cantidad: 1 },
      { producto_id: 'p1', nombre: 'Forro iPhone 11', cantidad: 2 },
    ]);
  });
});

describe('htmlHojaDespacho', () => {
  it('lleva el folio, los dos locales, quién despachó y el total de piezas', () => {
    const html = htmlHojaDespacho(traslado());
    expect(html).toContain('Hoja de despacho');
    expect(html).toContain('#0007');
    expect(html).toContain('Local Accesorios');
    expect(html).toContain('Local Vidrios');
    expect(html).toContain('Ana Pérez');
    expect(html).toMatch(/Total de piezas:?\s*<\/strong>\s*3|Total de piezas[^<]*3/);
  });

  it('lista el resumen por producto y el código de CADA pieza', () => {
    const html = htmlHojaDespacho(traslado());
    expect(html).toContain('Forro iPhone 11');
    expect(html).toContain('Cable USB tipo C');
    for (const c of ['2100000000012', '2100000000029', '2100000000036']) expect(html).toContain(c);
  });

  it('deja una casilla vacía por pieza para marcar lo que llega, y marca las ya recibidas', () => {
    const t = traslado();
    t.unidades[0].recibida_en = '2026-11-04T18:00:00.000Z';
    const html = htmlHojaDespacho(t);
    expect(html.match(/☐/g)?.length).toBe(2);
    expect(html.match(/☑/g)?.length).toBe(1);
  });

  it('trae las líneas de firma de quien entrega, quien transporta y quien recibe', () => {
    const html = htmlHojaDespacho(traslado());
    expect(html).toContain('Entrega');
    expect(html).toContain('Transporta');
    expect(html).toContain('Recibe');
  });

  it('muestra la nota solo si hay', () => {
    expect(htmlHojaDespacho(traslado())).not.toContain('Nota:');
    expect(htmlHojaDespacho(traslado({ notas: 'Lo lleva Pedro' }))).toContain('Lo lleva Pedro');
  });

  it('escapa el HTML de nombres y notas (no se puede colar una etiqueta)', () => {
    const t = traslado({ notas: '<img src=x onerror=alert(1)>' });
    t.unidades[0].producto_nombre = '<b>Forro</b>';
    const html = htmlHojaDespacho(t);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>Forro</b>');
    expect(html).toContain('&lt;b&gt;Forro&lt;/b&gt;');
  });

  it('marca como pendientes de devolver las piezas que volvieron al origen y no cuenta casilla para ellas', () => {
    const t = traslado({ estado: 'RECIBIDO' });
    t.unidades[2].devuelta_en = '2026-11-05T10:00:00.000Z';
    const html = htmlHojaDespacho(t);
    expect(html).toContain('Volvió al origen');
  });

  it('con un traslado de muchas piezas imprime todas (no se corta)', () => {
    const t = traslado({
      unidades: Array.from({ length: 120 }, (_, i) => ({ codigo: `21${String(i).padStart(11, '0')}`, producto_id: 'p', producto_nombre: 'Pieza', recibida_en: null, devuelta_en: null })),
    });
    const html = htmlHojaDespacho(t);
    expect(html.match(/☐/g)?.length).toBe(120);
  });
});
