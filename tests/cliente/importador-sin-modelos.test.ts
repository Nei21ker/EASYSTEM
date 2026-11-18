import { expect, it } from 'vitest';
import { PLANTILLA_CSV, prepararImportacion } from '../../src/lib/importador';

it('acepta CSV anteriores sin importar su columna de compatibilidad', () => {
  const csv = 'nombre,categoria,precio_venta,compatible_con\nForro,Accesorios,5,Modelo antiguo';
  const plan = prepararImportacion(csv, []);

  expect(plan.errores).toEqual([]);
  expect(plan.advertencias).toEqual([]);
  expect(plan.filas).toHaveLength(1);
  expect(plan.filas[0].modeloIds).toBeNull();
  expect(PLANTILLA_CSV).not.toContain('compatible_con');
});
