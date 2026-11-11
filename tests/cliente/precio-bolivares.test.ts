// Modo demo (LocalStorage): mismas reglas que el servidor para el precio fijo en bolívares y el cambio de precios en lote.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { htmlPrecioDual } from '../../src/utils/format';
import { PRECIO_BS_MAXIMO, errorPrecioBs, precioEnBolivares, tienePrecioEnBs, usdDesdeBs } from '../../src/utils/precioBs';

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

async function cargarServicio() {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion('admin@edwardaccesorios.com', 'admin123');
  return import('../../src/lib/inventoryService');
}

const vidrio = (n: number, extra: object = {}) => ({ codigo_barras: `20000000000${n}0`, nombre: `Vidrio sencillo modelo ${n}`, categoria: 'Vidrios Templados', precio_venta: 1.22, ...extra });

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('utils/precioBs', () => {
  it('usdDesdeBs guarda 6 decimales y vuelve a dar los Bs exactos con la misma tasa', () => {
    const usd = usdDesdeBs(1100, 900);
    expect(usd).toBeCloseTo(1.222222, 6);
    expect(Math.round(usd * 900 * 100) / 100).toBe(1100);
  });

  it('errorPrecioBs rechaza 0, negativos, NaN y lo que pasa del tope', () => {
    expect(errorPrecioBs(1100)).toBeNull();
    expect(errorPrecioBs(0)).not.toBeNull();
    expect(errorPrecioBs(-1)).not.toBeNull();
    expect(errorPrecioBs(Number.NaN)).not.toBeNull();
    expect(errorPrecioBs(PRECIO_BS_MAXIMO + 1)).not.toBeNull();
  });

  it('precioEnBolivares usa el fijo si lo hay y, si no, el de dólares × tasa', () => {
    expect(tienePrecioEnBs({ moneda_precio: 'BS', precio_bs: 1100 })).toBe(true);
    expect(tienePrecioEnBs({ moneda_precio: 'USD', precio_bs: null })).toBe(false);
    expect(precioEnBolivares({ moneda_precio: 'BS', precio_bs: 1100, precio_venta: 1.22 }, 900)).toBe(1100);
    expect(precioEnBolivares({ moneda_precio: 'USD', precio_bs: null, precio_venta: 2 }, 900)).toBe(1800);
    expect(precioEnBolivares({ moneda_precio: 'USD', precio_bs: null, precio_venta: 2 }, null)).toBeNull();
  });
});

describe('htmlPrecioDual con precio fijo en Bs', () => {
  it('muestra los Bs exactos (1.100,00) y no los del dólar redondeado a centavos (1.098,00)', () => {
    expect(htmlPrecioDual(1.22, 900)).toContain('1.098,00');
    const exacto = htmlPrecioDual(1.22, 900, '', 1100);
    expect(exacto).toContain('1.100,00');
    expect(exacto).not.toContain('1.098,00');
  });
});

describe('demo: precio fijo en bolívares', () => {
  it('sin tasa no se puede fijar; con tasa se guarda el equivalente en dólares', async () => {
    const s = await cargarServicio();
    const tasaInicial = (await s.obtenerTasaVigente()).ultima;
    if (!tasaInicial) {
      await expect(s.crearProducto(vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 }))).rejects.toThrow(/tasa/);
    }
    await s.registrarTasa(900);
    const p = await s.crearProducto(vidrio(2, { moneda_precio: 'BS', precio_bs: 1100 }));
    expect(p.moneda_precio).toBe('BS');
    expect(p.precio_bs).toBe(1100);
    expect(p.precio_venta).toBeCloseTo(1100 / 900, 6);
  });

  it('registrar una tasa nueva recalcula el equivalente en dólares y no toca los productos en dólares', async () => {
    const s = await cargarServicio();
    await s.registrarTasa(900);
    const enBs = await s.crearProducto(vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 }));
    const enUsd = await s.crearProducto(vidrio(2, { precio_venta: 5 }));
    await s.registrarTasa(1000);
    const lista = await s.listarProductos({ catalogoCompleto: true });
    expect(lista.find((p) => p.id === enBs.id)!.precio_venta).toBeCloseTo(1.1, 6);
    expect(lista.find((p) => p.id === enBs.id)!.precio_bs).toBe(1100);
    expect(lista.find((p) => p.id === enUsd.id)!.precio_venta).toBe(5);
  });

  it('un precio_venta suelto no cambia a un producto con precio en Bs; pedirlo con moneda_precio sí', async () => {
    const s = await cargarServicio();
    await s.registrarTasa(900);
    const p = await s.crearProducto(vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 }));
    await s.actualizarProducto(p.id, { precio_venta: 9 });
    let visto = (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.id === p.id)!;
    expect(visto.precio_bs).toBe(1100);
    expect(visto.precio_venta).toBeCloseTo(1100 / 900, 6);
    await s.actualizarProducto(p.id, { moneda_precio: 'USD', precio_venta: 9 });
    visto = (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.id === p.id)!;
    expect(visto).toMatchObject({ moneda_precio: 'USD', precio_bs: null, precio_venta: 9 });
  });
});

describe('demo: cambiar los precios en lote', () => {
  it('pone Bs 1250 a los elegidos y deja los demás como estaban', async () => {
    const s = await cargarServicio();
    await s.registrarTasa(900);
    const a = await s.crearProducto(vidrio(1));
    const b = await s.crearProducto(vidrio(2));
    const otro = await s.crearProducto({ ...vidrio(3), categoria: 'Forros', precio_venta: 6 });
    const r = await s.cambiarPreciosLote([a.id, b.id], 'BS', 1250);
    expect(r.actualizados).toBe(2);
    const lista = await s.listarProductos({ catalogoCompleto: true });
    for (const id of [a.id, b.id]) expect(lista.find((p) => p.id === id)).toMatchObject({ moneda_precio: 'BS', precio_bs: 1250 });
    expect(lista.find((p) => p.id === otro.id)).toMatchObject({ moneda_precio: 'USD', precio_venta: 6 });
  });

  it('valida: lista vacía, precio inválido y producto por cantidad que quedaría en $3 o más', async () => {
    const s = await cargarServicio();
    await s.registrarTasa(900);
    const normal = await s.crearProducto(vidrio(1));
    const porCantidad = await s.crearProducto(vidrio(2, { control_por_cantidad: 1 }));
    await expect(s.cambiarPreciosLote([], 'BS', 1100)).rejects.toThrow(/al menos un producto/);
    await expect(s.cambiarPreciosLote([normal.id], 'BS', 0)).rejects.toThrow(/mayor a 0/);
    await expect(s.cambiarPreciosLote([normal.id, porCantidad.id], 'BS', 3000)).rejects.toThrow(/por cantidad/);
    const lista = await s.listarProductos({ catalogoCompleto: true });
    expect(lista.find((p) => p.id === normal.id)).toMatchObject({ moneda_precio: 'USD' });
  });
});
