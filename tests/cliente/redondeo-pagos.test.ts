// Pago de más en bolívares (el cliente redondeó el monto): la venta se registra igual con lo que pagó y lo que debía.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { absorberExcesoEnBs, bsDeMas, REDONDEO_MAXIMO_USD, redondeoValido } from '../../src/utils/pagos';
import type { PagoVenta } from '../../src/types/database.types';

describe('absorberExcesoEnBs', () => {
  const tasa = 100;
  const movil: PagoVenta = { metodo: 'BS_PAGO_MOVIL', monto_bs: 710, monto_usd: 7.1 };

  it('el exceso sale del pago en Bs: el total en dólares cuadra y queda lo que pagó y lo que debía', () => {
    const r = absorberExcesoEnBs([movil], 0.1, tasa)!;
    expect(r[0]).toMatchObject({ monto_bs: 710, monto_usd: 7, monto_bs_debido: 700 });
    expect(bsDeMas(r[0])).toBe(10);
  });

  it('con varios pagos se descuenta del ÚLTIMO en bolívares, no del de dólares', () => {
    const r = absorberExcesoEnBs([{ metodo: 'BS_PAGO_MOVIL', monto_bs: 300, monto_usd: 3 }, { metodo: 'USD_EFECTIVO', monto_usd: 2, monto_bs: null }, { metodo: 'BS_EFECTIVO', monto_bs: 250, monto_usd: 2.5 }], 0.3, tasa)!;
    expect(r[0].monto_bs_debido).toBeUndefined();
    expect(r[1]).toMatchObject({ monto_usd: 2, monto_bs: null });
    expect(r[2]).toMatchObject({ monto_usd: 2.2, monto_bs_debido: 220 });
  });

  it('no se absorbe sin pago en Bs, con exceso mayor al tope o si dejaría el pago en cero', () => {
    expect(absorberExcesoEnBs([{ metodo: 'USD_EFECTIVO', monto_usd: 10, monto_bs: null }], 0.5, tasa)).toBeNull();
    expect(absorberExcesoEnBs([{ metodo: 'BS_PAGO_MOVIL', monto_bs: 10000, monto_usd: 100 }], REDONDEO_MAXIMO_USD + 0.01, tasa)).toBeNull();
    expect(absorberExcesoEnBs([movil], 7.1, tasa)).toBeNull();
    expect(absorberExcesoEnBs([movil], 0, tasa)).toBeNull();
  });

  it('no cambia los pagos originales', () => {
    absorberExcesoEnBs([movil], 0.1, tasa);
    expect(movil).toEqual({ metodo: 'BS_PAGO_MOVIL', monto_bs: 710, monto_usd: 7.1 });
  });
});

describe('redondeoValido', () => {
  it('sin redondeo siempre vale; con redondeo exige tipo en Bs, debido menor a lo pagado y dentro del tope', () => {
    expect(redondeoValido({ metodo: 'USD_EFECTIVO', monto_bs: null }, 100)).toBe(true);
    expect(redondeoValido({ metodo: 'BS_PAGO_MOVIL', monto_bs: 710, monto_bs_debido: 700 }, 100)).toBe(true);
    expect(redondeoValido({ metodo: 'USD_EFECTIVO', monto_bs: null, monto_bs_debido: 700 }, 100)).toBe(false);
    expect(redondeoValido({ metodo: 'BS_PAGO_MOVIL', monto_bs: 700, monto_bs_debido: 710 }, 100)).toBe(false);
    expect(redondeoValido({ metodo: 'BS_PAGO_MOVIL', monto_bs: 1500, monto_bs_debido: 700 }, 100)).toBe(false); // $8 de más
  });
});

// --- Demo (LocalStorage) ---------------------------------------------------------------------------------------
function almacenSimulado() {
  const datos = new Map<string, string>();
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
    clear: () => datos.clear(),
    get length() {
      return datos.size;
    },
    key: (i: number) => [...datos.keys()][i] ?? null,
  };
}

describe('demo: venta con pago móvil redondeado', () => {
  beforeEach(() => {
    const almacen = almacenSimulado();
    vi.stubGlobal('localStorage', almacen);
    vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function servicio() {
    vi.resetModules();
    vi.stubEnv('PUBLIC_USAR_API', 'false');
    const auth = await import('../../src/lib/auth');
    await auth.iniciarSesion('encargado@edwardaccesorios.com', 'encargado123');
    return import('../../src/lib/inventoryService');
  }

  it('queda guardado lo que pagó y lo que debía, y el total en Bs es lo que entró', async () => {
    const s = await servicio();
    const prod = await s.crearProducto({ codigo_barras: '2000000000015', nombre: 'Forro redondeo', categoria: 'Forros', precio_venta: 7, control_por_cantidad: 0 });
    await s.registrarMovimiento({ producto_id: prod.id, tipo: 'ENTRADA', cantidad: 5, motivo: 'Compra' });
    const tasa = 100;
    // Debía 7 $ = Bs 700; el cliente mandó Bs 710 (el sistema descuenta el exceso del pago en Bs)
    const pagos = absorberExcesoEnBs([{ metodo: 'BS_PAGO_MOVIL', monto_bs: 710, monto_usd: 7.1 }], 0.1, tasa)!;
    const v = await s.registrarVenta([{ producto_id: prod.id, nombre: prod.nombre, codigo_barras: prod.codigo_barras, cantidad: 1, precio_unitario: 7 }], {
      cliente: { cedula: 'V-11111111', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567' },
      pagos,
      tasa_cambio: tasa,
      referenciaPagoMovil: '1234',
    });
    expect(v.total).toBe(7);
    expect(v.total_bs).toBe(710);
    expect(v.pagos?.[0]).toMatchObject({ monto_bs: 710, monto_usd: 7, monto_bs_debido: 700 });

    await expect(
      s.registrarVenta([{ producto_id: prod.id, nombre: prod.nombre, codigo_barras: prod.codigo_barras, cantidad: 1, precio_unitario: 7 }], {
        cliente: { cedula: 'V-11111111', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567' },
        pagos: [{ metodo: 'BS_PAGO_MOVIL', monto_bs: 710, monto_usd: 7, monto_bs_debido: 900 }],
        tasa_cambio: tasa,
        referenciaPagoMovil: '1234',
      })
    ).rejects.toThrow(/redondeo/i);
  });
});
