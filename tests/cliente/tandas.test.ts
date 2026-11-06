import { describe, expect, it } from 'vitest';
import { partirEnTandas } from '../../src/utils/tandas';

describe('partirEnTandas: respeta los topes del servidor', () => {
  it('una lista pequeña va en una sola tanda, en orden', () => {
    expect(partirEnTandas([3, 1, 5])).toEqual([[0, 1, 2]]);
  });

  it('una lista vacía no genera tandas', () => {
    expect(partirEnTandas([])).toEqual([]);
  });

  it('parte cuando se llega a 50 movimientos', () => {
    const tandas = partirEnTandas(Array.from({ length: 120 }, () => 1));
    expect(tandas.map((t) => t.length)).toEqual([50, 50, 20]);
    expect(tandas.flat()).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });

  it('parte cuando las unidades pasarían de 500', () => {
    expect(partirEnTandas([300, 150, 100, 10])).toEqual([[0, 1], [2, 3]]);
    expect(partirEnTandas([500, 1])).toEqual([[0], [1]]);
  });

  it('un movimiento que solo pasa del tope va en su propia tanda (no se parte)', () => {
    expect(partirEnTandas([2, 700, 3])).toEqual([[0], [1], [2]]);
  });
});
