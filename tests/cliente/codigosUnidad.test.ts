import { describe, expect, it } from 'vitest';
import { construirCodigoUnidad, esCodigoUnidad, esPrefijoValido, normalizarCodigoUnidad, prefijoDelCodigo, sugerirPrefijo } from '../../src/utils/codigos';

describe('código de una unidad: prefijo + 6 dígitos', () => {
  it('se arma con el prefijo del producto y el número, con ceros a la izquierda', () => {
    expect(construirCodigoUnidad('INF', 1)).toBe('INF000001');
    expect(construirCodigoUnidad('tec', 42)).toBe('TEC000042');
    expect(construirCodigoUnidad('HON', 999999)).toBe('HON999999');
  });

  it('rechaza un prefijo inválido o un número fuera de 1 a 999999', () => {
    expect(() => construirCodigoUnidad('I', 1)).toThrow();
    expect(() => construirCodigoUnidad('INF1', 1)).toThrow();
    expect(() => construirCodigoUnidad('INF', 0)).toThrow();
    expect(() => construirCodigoUnidad('INF', 1_000_000)).toThrow();
  });

  it('esCodigoUnidad: 2 a 4 letras mayúsculas y 6 dígitos', () => {
    for (const bueno of ['INF000001', 'TEC000123', 'AB000001', 'ABCD000001']) expect(esCodigoUnidad(bueno)).toBe(true);
    for (const malo of ['inf000001', 'INF00001', 'INF0000001', 'INF 000001', 'A000001', 'ABCDE000001', '2000000000015', '2100000000074', '', 'INF00000A']) {
      expect(esCodigoUnidad(malo)).toBe(false);
    }
  });

  it('prefijoDelCodigo devuelve las letras del código de unidad', () => {
    expect(prefijoDelCodigo('INF000001')).toBe('INF');
    expect(prefijoDelCodigo('2000000000015')).toBeNull();
  });
});

describe('normalizarCodigoUnidad: lo que se escribe o se escanea', () => {
  it('pasa a mayúsculas y quita espacios', () => {
    expect(normalizarCodigoUnidad(' inf000014 ')).toBe('INF000014');
  });

  it('completa los ceros: inf14 → INF000014', () => {
    expect(normalizarCodigoUnidad('inf14')).toBe('INF000014');
    expect(normalizarCodigoUnidad('TEC7')).toBe('TEC000007');
    expect(normalizarCodigoUnidad('inf-14')).toBe('INF000014');
  });

  it('no inventa nada con lo que no es un código de unidad', () => {
    for (const malo of ['', '14', 'inf', 'inf0', 'inf1234567', 'i14', '2000000000015', 'inf 1 2', 'abcde1']) expect(normalizarCodigoUnidad(malo)).toBeNull();
  });
});

describe('prefijo del producto', () => {
  it('esPrefijoValido: 2 a 4 letras A-Z en mayúsculas', () => {
    for (const bueno of ['INF', 'TEC', 'AB', 'ABCD']) expect(esPrefijoValido(bueno)).toBe(true);
    for (const malo of ['inf', 'I', 'ABCDE', 'IN1', 'IÑF', '', 'IN F']) expect(esPrefijoValido(malo)).toBe(false);
  });

  const marcas = ['Samsung', 'Infinix', 'Tecno', 'Apple', 'Xiaomi', 'Honor'];

  it('sugiere las 3 primeras letras de la marca que aparece en el nombre', () => {
    expect(sugerirPrefijo('Cargador Infinix 20W', 'Cargadores', marcas)).toBe('INF');
    expect(sugerirPrefijo('Forro silicona Tecno Spark 10', 'Forros', marcas)).toBe('TEC');
    expect(sugerirPrefijo('Cable tipo C para HONOR', 'Cables', marcas)).toBe('HON');
  });

  it('un iPhone en el nombre da IPH (aunque la marca del catálogo sea Apple)', () => {
    expect(sugerirPrefijo('Forro silicona iPhone 13', 'Forros', marcas)).toBe('IPH');
  });

  it('sin marca en el nombre usa las 3 primeras letras de la categoría', () => {
    expect(sugerirPrefijo('Cargador de carro 3.1A', 'Cargadores', marcas)).toBe('CAR');
    expect(sugerirPrefijo('Audífonos in-ear', 'Audífonos', marcas)).toBe('AUD'); // sin acentos ni ñ
  });

  it('sin marca ni categoría usable cae en GEN', () => {
    expect(sugerirPrefijo('Cosa', '', marcas)).toBe('GEN');
    expect(sugerirPrefijo('Cosa', '123', marcas)).toBe('GEN');
  });

  it('la marca de un nombre más largo gana sobre una contenida en ella', () => {
    expect(sugerirPrefijo('Forro iPhone Apple', 'Forros', ['Apple', 'Pple'])).toBe('APP');
  });

  it('solo reconoce la marca como palabra entera', () => {
    expect(sugerirPrefijo('Cargador Honorable', 'Cargadores', ['Honor'])).toBe('CAR');
  });
});
