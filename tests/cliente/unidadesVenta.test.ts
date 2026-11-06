import { describe, expect, it } from 'vitest';
import { alertaUnidadNoVendible } from '../../src/utils/unidadesVenta';
import type { UnidadProducto } from '../../src/types/database.types';

const LOCAL = '00000000-0000-0000-0000-000000000001';

function unidad(extra: Partial<UnidadProducto> = {}): UnidadProducto {
  return { id: 'u1', producto_id: 'p1', local_id: LOCAL, codigo: 'INF000014', estado: 'DISPONIBLE', created_at: '2026-01-01T00:00:00.000Z', ...extra };
}

describe('alertaUnidadNoVendible: qué se avisa al leer un QR en el POS', () => {
  it('una pieza disponible del local activo no genera alerta', () => {
    expect(alertaUnidadNoVendible(unidad(), 'INF000014', LOCAL)).toBeNull();
  });

  it('un QR de una pieza ya vendida avisa que ya se vendió y que el QR ya no está disponible', () => {
    const a = alertaUnidadNoVendible(unidad({ estado: 'VENDIDA', vendida_en: '2026-03-05T15:00:00.000Z' }), 'INF000014', LOCAL);
    expect(a?.titulo).toBe('Este producto ya se vendió');
    expect(a?.detalle).toContain('INF000014');
    expect(a?.detalle).toContain('ya no está disponible');
    expect(a?.detalle).toMatch(/\d{2}\/\d{2}\/2026/);
  });

  it('una pieza vendida sin fecha también avisa (sin inventar la fecha)', () => {
    const a = alertaUnidadNoVendible(unidad({ estado: 'VENDIDA', vendida_en: null }), 'INF000014', LOCAL);
    expect(a?.titulo).toBe('Este producto ya se vendió');
    expect(a?.detalle).not.toContain(' el ');
  });

  it('un código que no existe avisa que el QR no existe', () => {
    expect(alertaUnidadNoVendible(null, 'INF999999', LOCAL)?.titulo).toBe('Ese QR no existe');
  });

  it('una pieza de otro local no se vende desde este', () => {
    const a = alertaUnidadNoVendible(unidad({ local_id: '00000000-0000-0000-0000-000000000002' }), 'INF000014', LOCAL);
    expect(a?.titulo).toBe('Esa pieza es de otro local');
  });

  it('el administrador en "Todos" (sin local activo) no recibe el aviso de otro local', () => {
    expect(alertaUnidadNoVendible(unidad({ local_id: '00000000-0000-0000-0000-000000000002' }), 'INF000014', '')).toBeNull();
  });

  it('una pieza en tránsito o dada de baja tampoco se puede vender (antes entraba al carrito y fallaba al cobrar)', () => {
    expect(alertaUnidadNoVendible(unidad({ estado: 'EN_TRANSITO' }), 'INF000014', LOCAL)?.titulo).toMatch(/camino/);
    expect(alertaUnidadNoVendible(unidad({ estado: 'BAJA' }), 'INF000014', LOCAL)?.titulo).toMatch(/baja/);
  });
});
