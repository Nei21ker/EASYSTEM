import { describe, expect, it } from 'vitest';
import {
  descripcionInstalacionPromotor,
  errorPrecioInstalacion,
  hayInstalacionDelPromotor,
  instalacionDelLocal,
  instalacionDelPromotor,
  limpiarInstalacion,
  montoInstalacion,
  totalDeItems,
  totalLinea,
} from '../../src/utils/instalacion';

const item = (extra = {}) => ({ nombre: 'Vidrio A15', cantidad: 2, precio_unitario: 7, ...extra });

describe('instalación de vidrios', () => {
  it('el total de la línea suma la instalación por unidad', () => {
    expect(totalLinea(item())).toBe(14);
    expect(totalLinea(item({ instalacion_por: 'LOCAL', instalacion_usd: 3 }))).toBe(20);
    expect(montoInstalacion(item({ instalacion_por: 'PROMOTOR', instalacion_usd: 3 }))).toBe(6);
    expect(montoInstalacion(item({ instalacion_usd: 3 }))).toBe(0); // sin «quién», no cuenta
  });

  it('separa lo del local de lo del promotor y suma el total de la venta', () => {
    const items = [item({ instalacion_por: 'LOCAL', instalacion_usd: 3 }), item({ instalacion_por: 'PROMOTOR', instalacion_usd: 2.5 }), item()];
    expect(instalacionDelLocal(items)).toBe(6);
    expect(instalacionDelPromotor(items)).toBe(5);
    expect(totalDeItems(items)).toBe(14 + 6 + 14 + 5 + 14);
    expect(hayInstalacionDelPromotor(items)).toBe(true);
    expect(hayInstalacionDelPromotor([item({ instalacion_por: 'LOCAL', instalacion_usd: 3 })])).toBe(false);
  });

  it('valida el precio y descarta lo inválido', () => {
    expect(errorPrecioInstalacion(3)).toBeNull();
    expect(errorPrecioInstalacion(0)).toMatch(/mayor a 0/);
    expect(errorPrecioInstalacion(Number.NaN)).toMatch(/mayor a 0/);
    expect(errorPrecioInstalacion(101)).toMatch(/no puede pasar/);
    expect(limpiarInstalacion(item({ instalacion_por: 'LOCAL', instalacion_usd: -1 }))).not.toHaveProperty('instalacion_por');
    expect(limpiarInstalacion(item({ instalacion_por: 'OTRO' as never, instalacion_usd: 3 }))).not.toHaveProperty('instalacion_usd');
    expect(limpiarInstalacion(item({ instalacion_por: 'LOCAL', instalacion_usd: 3.456 }))).toMatchObject({ instalacion_por: 'LOCAL', instalacion_usd: 3.46 });
  });

  it('describe solo las instalaciones del promotor', () => {
    expect(descripcionInstalacionPromotor([item({ instalacion_por: 'PROMOTOR', instalacion_usd: 3 }), item({ instalacion_por: 'LOCAL', instalacion_usd: 3 })])).toBe('2 × Vidrio A15 ($3 c/u)');
  });
});
