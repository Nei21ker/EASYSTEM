// El POS pide «Nombre y apellido» en un solo campo escrito corrido y lo parte en las dos piezas que guarda el sistema.
import { describe, expect, it } from 'vitest';
import { normalizarPromotor, separarNombreCompleto, unirNombre } from '../../src/utils/promotor';

describe('separarNombreCompleto', () => {
  it('una palabra es solo el nombre', () => {
    expect(separarNombreCompleto('Maria')).toEqual({ nombre: 'Maria', apellido: '' });
    expect(separarNombreCompleto('')).toEqual({ nombre: '', apellido: '' });
    expect(separarNombreCompleto(null)).toEqual({ nombre: '', apellido: '' });
  });

  it('dos palabras: nombre y apellido; tres: el primero y el resto; cuatro o más: mitad y mitad', () => {
    expect(separarNombreCompleto('Eliezer Vasquez')).toEqual({ nombre: 'Eliezer', apellido: 'Vasquez' });
    expect(separarNombreCompleto('Juan Perez Lopez')).toEqual({ nombre: 'Juan', apellido: 'Perez Lopez' });
    expect(separarNombreCompleto('Maria Jose Perez Lara')).toEqual({ nombre: 'Maria Jose', apellido: 'Perez Lara' });
    expect(separarNombreCompleto('Ana Maria de los Rios Lara')).toEqual({ nombre: 'Ana Maria de', apellido: 'los Rios Lara' });
  });

  it('ignora espacios de más y al unir devuelve lo que se escribió', () => {
    for (const escrito of ['  Eliezer    Vasquez ', 'Juan Perez Lopez', 'Maria Jose Perez Lara']) {
      const { nombre, apellido } = separarNombreCompleto(escrito);
      expect(unirNombre(nombre, apellido)).toBe(escrito.trim().replace(/\s+/g, ' '));
    }
  });
});

describe('unirNombre', () => {
  it('junta nombre y apellido guardados por separado, sin repetir el apellido si el nombre ya lo traía', () => {
    expect(unirNombre('Eliezer', 'Vasquez')).toBe('Eliezer Vasquez');
    expect(unirNombre('Eliezer Vasquez', 'Vasquez')).toBe('Eliezer Vasquez');
    expect(unirNombre('Eliezer', '')).toBe('Eliezer');
    expect(unirNombre(undefined, undefined)).toBe('');
  });
});

describe('el promotor escrito corrido pasa la validación de siempre', () => {
  it('nombre y apellido separados del campo único', () => {
    const r = normalizarPromotor({ cedula: 'V-27868051', ...separarNombreCompleto('Eliezer Vasquez'), telefono: '', banco: 'Provincial' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.promotor.nombre).toBe('Eliezer Vasquez');
      expect(r.promotor.apellido).toBe('Vasquez');
    }
  });
});
