import { describe, expect, it } from 'vitest';
import { separarEquipo } from '../../src/utils/equipoRecepcion';

describe('equipo en un solo campo', () => {
  it('reconoce marcas de varias palabras y conserva el texto del modelo', () => {
    expect(separarEquipo('  Sony  Ericsson   Xperia X10 ', ['Sony', 'Sony Ericsson'])).toEqual({
      equipo_marca: 'Sony Ericsson', equipo_modelo: 'Xperia X10',
    });
  });

  it('admite equipos fuera del catálogo y exige marca y modelo', () => {
    expect(separarEquipo('Motorola G54', [])).toEqual({ equipo_marca: 'Motorola', equipo_modelo: 'G54' });
    expect(separarEquipo('Samsung', ['Samsung'])).toBeNull();
  });
});
