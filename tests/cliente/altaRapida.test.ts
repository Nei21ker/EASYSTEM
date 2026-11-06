import { describe, expect, it } from 'vitest';
import { leerPrecio, MAX_LINEAS_ALTA, normalizarNombre, parsearAltaRapida, problemaDeAlta } from '../../src/utils/altaRapida';

const POR_DEFECTO = { cantidad: 1, precio: 8 };

describe('parsearAltaRapida: un producto por línea', () => {
  it('cada línea es un producto con la cantidad y el precio de por defecto', () => {
    const r = parsearAltaRapida('Control A/C Samsung\nControl A/C LG\n', POR_DEFECTO);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ linea: 1, nombre: 'Control A/C Samsung', cantidad: 1, precio: 8, error: null });
    expect(r[1]).toMatchObject({ linea: 2, nombre: 'Control A/C LG', cantidad: 1, precio: 8, error: null });
  });

  it('x5 al final es la cantidad (también × y *, con o sin espacio) y se quita del nombre', () => {
    for (const escrito of ['Control Roku x5', 'Control Roku X5', 'Control Roku ×5', 'Control Roku *5', 'Control Roku x 5']) {
      expect(parsearAltaRapida(escrito, POR_DEFECTO)[0]).toMatchObject({ nombre: 'Control Roku', cantidad: 5 });
    }
  });

  it('$12 o $12,50 al final es el precio de esa línea, y se pueden poner los dos en cualquier orden', () => {
    expect(parsearAltaRapida('Control Roku $12', POR_DEFECTO)[0]).toMatchObject({ nombre: 'Control Roku', precio: 12, cantidad: 1 });
    expect(parsearAltaRapida('Control Roku $12,50', POR_DEFECTO)[0].precio).toBe(12.5);
    expect(parsearAltaRapida('Control Roku x3 $12', POR_DEFECTO)[0]).toMatchObject({ nombre: 'Control Roku', cantidad: 3, precio: 12 });
    expect(parsearAltaRapida('Control Roku $12 x3', POR_DEFECTO)[0]).toMatchObject({ nombre: 'Control Roku', cantidad: 3, precio: 12 });
  });

  it('un número que es parte del nombre no se confunde con la cantidad ni el precio', () => {
    const r = parsearAltaRapida('Control universal 2 en 1\nConvertidor Android TV 4K', POR_DEFECTO);
    expect(r.map((l) => l.nombre)).toEqual(['Control universal 2 en 1', 'Convertidor Android TV 4K']);
    expect(r.every((l) => l.cantidad === 1 && l.precio === 8)).toBe(true);
  });

  it('ignora las líneas vacías y los espacios de más, pero conserva el número de renglón para los avisos', () => {
    const r = parsearAltaRapida('\n  Control   A/C   Samsung  \n\n   \nControl LG', POR_DEFECTO);
    expect(r.map((l) => [l.linea, l.nombre])).toEqual([[2, 'Control A/C Samsung'], [5, 'Control LG']]);
  });

  it('el mismo producto escrito dos veces se junta y suma las cantidades (no crea un duplicado)', () => {
    const r = parsearAltaRapida('Control LG x2\ncontrol  lg\nControl LG x3', POR_DEFECTO);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ nombre: 'Control LG', cantidad: 6 });
  });

  it('cantidad 0 es válida (se crea el producto sin stock)', () => {
    expect(parsearAltaRapida('Control LG x0', POR_DEFECTO)[0]).toMatchObject({ cantidad: 0, error: null });
  });
});

describe('parsearAltaRapida: líneas con problema', () => {
  it('sin precio de por defecto y sin $ en la línea, avisa que falta el precio', () => {
    const r = parsearAltaRapida('Control LG\nControl Sony $9', { cantidad: 1, precio: null });
    expect(r[0].error).toMatch(/precio/i);
    expect(r[1]).toMatchObject({ precio: 9, error: null });
  });

  it('rechaza nombres muy cortos, sin letras, o demasiado largos', () => {
    expect(parsearAltaRapida('ab', POR_DEFECTO)[0].error).toMatch(/corto/i);
    expect(parsearAltaRapida('12345', POR_DEFECTO)[0].error).toMatch(/letras/i);
    expect(parsearAltaRapida('A'.repeat(121), POR_DEFECTO)[0].error).toMatch(/pasa de/i);
  });

  it('rechaza una cantidad fuera de rango', () => {
    expect(parsearAltaRapida('Control LG x5000', POR_DEFECTO)[0].error).toBeTruthy();
    expect(parsearAltaRapida('Control LG', { cantidad: -1, precio: 8 })[0].error).toMatch(/cantidad/i);
  });
});

describe('problemaDeAlta', () => {
  it('sin líneas pide escribir algo', () => {
    expect(problemaDeAlta([])).toMatch(/al menos un producto/i);
  });

  it('señala el primer renglón con problema', () => {
    const lineas = parsearAltaRapida('Control LG\nab\nControl Sony', POR_DEFECTO);
    expect(problemaDeAlta(lineas)).toMatch(/^Línea 2:/);
  });

  it('no deja pasar de la cantidad máxima de productos por tanda', () => {
    const texto = Array.from({ length: MAX_LINEAS_ALTA + 1 }, (_, i) => `Control número ${i}`).join('\n');
    expect(problemaDeAlta(parsearAltaRapida(texto, POR_DEFECTO))).toMatch(/demasiados/i);
  });

  it('todo bien = sin problema', () => {
    expect(problemaDeAlta(parsearAltaRapida('Control LG x2\nControl Sony $9', POR_DEFECTO))).toBeNull();
  });
});

describe('utilidades', () => {
  it('normalizarNombre ignora mayúsculas, acentos y espacios de más', () => {
    expect(normalizarNombre('  Control   TELEVISIÓN  ')).toBe('control television');
  });

  it('leerPrecio acepta coma o punto y rechaza lo que no es un monto', () => {
    expect(leerPrecio('12,5')).toBe(12.5);
    expect(leerPrecio('12.50')).toBe(12.5);
    expect(leerPrecio('12')).toBe(12);
    expect(leerPrecio('abc')).toBeNull();
    expect(leerPrecio('1.234')).toBeNull();
    expect(leerPrecio('-3')).toBeNull();
  });
});
