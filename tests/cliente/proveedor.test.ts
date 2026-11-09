import { describe, expect, it } from 'vitest';
import { MAX_PROVEEDOR, motivoDeIngreso, MOTIVO_INGRESO_SIN_PROVEEDOR } from '../../src/utils/proveedor';

describe('motivo del ingreso con proveedor opcional', () => {
  it('sin proveedor (vacío, espacios o nulo) usa el texto general', () => {
    for (const v of ['', '   ', null, undefined]) expect(motivoDeIngreso(v)).toBe(MOTIVO_INGRESO_SIN_PROVEEDOR);
  });

  it('con proveedor lo anota, sin espacios de más', () => {
    expect(motivoDeIngreso('  Distribuidora   Los Andes ')).toBe('Compra a proveedor: Distribuidora Los Andes');
  });

  it('un nombre larguísimo se recorta para que el motivo quepa en el límite del servidor (200)', () => {
    const motivo = motivoDeIngreso('x'.repeat(500));
    expect(motivo).toBe(`Compra a proveedor: ${'x'.repeat(MAX_PROVEEDOR)}`);
    expect(motivo.length).toBeLessThanOrEqual(200);
  });
});
