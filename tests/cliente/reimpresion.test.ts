import { describe, expect, it } from 'vitest';
import { agruparUnidadesParaReimprimir, resumenReimpresion } from '../../src/utils/reimpresion';
import type { UnidadProducto } from '../../src/types/database.types';

const unidad = (codigo: string, producto_id: string, extra: Partial<UnidadProducto> = {}): UnidadProducto => ({
  id: codigo,
  producto_id,
  local_id: 'L1',
  codigo,
  estado: 'DISPONIBLE',
  created_at: '2026-11-01T10:00:00.000Z',
  ...extra,
});

const productos = [
  { id: 'p1', nombre: 'Cargador Honor sencillo Tipo C', codigo_barras: '2000000000015' },
  { id: 'p2', nombre: 'Audífonos Bluetooth in-ear', codigo_barras: '2000000000022' },
  { id: 'p3', nombre: 'Cable USB-C', codigo_barras: '2000000000039' },
];

const unidades = [
  unidad('2100000000741', 'p1', { created_at: '2026-11-01T09:00:00.000Z' }), // la más antigua
  unidad('2100000000819', 'p1', { created_at: '2026-11-02T09:00:00.000Z', reimpresiones: 2, ultima_reimpresion: '2026-11-03T10:00:00.000Z' }),
  unidad('2100000000901', 'p1', { estado: 'VENDIDA' }),
  unidad('2100000001002', 'p2'),
  unidad('2100000001019', 'p3'),
];

describe('agruparUnidadesParaReimprimir', () => {
  it('agrupa por producto, ordenado por nombre, y NO ofrece las unidades vendidas', () => {
    const grupos = agruparUnidadesParaReimprimir(unidades, productos, '');
    expect(grupos.map((g) => g.producto.nombre)).toEqual(['Audífonos Bluetooth in-ear', 'Cable USB-C', 'Cargador Honor sencillo Tipo C']);
    const cargador = grupos.find((g) => g.producto.id === 'p1')!;
    expect(cargador.unidades.map((u) => u.codigo)).toEqual(['2100000000741', '2100000000819']);
  });

  it('busca por nombre sin importar mayúsculas ni tildes', () => {
    expect(agruparUnidadesParaReimprimir(unidades, productos, 'AUDIFONOS').map((g) => g.producto.id)).toEqual(['p2']);
    expect(agruparUnidadesParaReimprimir(unidades, productos, 'honor tipo').map((g) => g.producto.id)).toEqual(['p1']);
  });

  it('busca por el código completo de la unidad y deja solo esa unidad', () => {
    const grupos = agruparUnidadesParaReimprimir(unidades, productos, '2100000000819');
    expect(grupos).toHaveLength(1);
    expect(grupos[0].unidades.map((u) => u.codigo)).toEqual(['2100000000819']);
  });

  it('busca por el código de barras del producto y muestra todas sus unidades disponibles', () => {
    const grupos = agruparUnidadesParaReimprimir(unidades, productos, '2000000000015');
    expect(grupos[0].unidades).toHaveLength(2);
  });

  it('un producto sin unidades disponibles no aparece, y una búsqueda sin resultados da lista vacía', () => {
    expect(agruparUnidadesParaReimprimir([unidades[2]], productos, '')).toEqual([]);
    expect(agruparUnidadesParaReimprimir(unidades, productos, 'zzzz')).toEqual([]);
  });

  it('ignora unidades de un producto que ya no está en el catálogo', () => {
    expect(agruparUnidadesParaReimprimir([unidad('2100000002003', 'borrado')], productos, '')).toEqual([]);
  });

  it('con un producto indicado solo trae ese producto', () => {
    const grupos = agruparUnidadesParaReimprimir(unidades, productos, '', 'p2');
    expect(grupos.map((g) => g.producto.id)).toEqual(['p2']);
  });
});

describe('resumenReimpresion', () => {
  it('dice si nunca se reimprimió o cuántas veces', () => {
    expect(resumenReimpresion(unidades[0])).toBe('Nunca reimpresa');
    expect(resumenReimpresion(unidad('2100000003004', 'p1', { reimpresiones: 1 }))).toBe('Reimpresa 1 vez');
    expect(resumenReimpresion(unidades[1])).toBe('Reimpresa 2 veces');
  });
});
