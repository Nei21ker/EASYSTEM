// Modo demo (LocalStorage): precio en divisas (el cliente paga todo en dólares en efectivo/Binance, el precio baja y una parte fija por unidad
// es del promotor). Mismas reglas que el servidor (tests/server/precio-divisas.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_VIDRIOS_ID } from '../../src/lib/constantes-locales';

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

async function cargarComo(email: string, clave: string) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  localStorage.setItem('easystem:local-activo', LOCAL_VIDRIOS_ID);
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(email, clave);
  return import('../../src/lib/inventoryService');
}
const admin = () => cargarComo('admin@edwardaccesorios.com', 'admin123');

const promotor = { cedula: 'V-12345678', nombre: 'Luis', apellido: 'Rojas', telefono: '04141112233', banco: 'Banesco' };
const control = { codigo_barras: '2000000000015', nombre: 'Control A/C Samsung', categoria: 'Controles', precio_venta: 12, control_por_cantidad: 0 };
const cliente = { cedula: 'V-11111111', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567' };

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function prepararControl(s: Awaited<ReturnType<typeof admin>>) {
  const producto = await s.crearProducto(control);
  await s.registrarMovimiento({ producto_id: producto.id, tipo: 'ENTRADA', cantidad: 6, motivo: 'Compra' });
  return producto;
}

describe('demo: autorizarPrecioVenta en modo divisas', () => {
  it('lo anota quien vende sin contraseña; exige precio menor al del catálogo y comisión válida', async () => {
    const s = await admin();
    const prod = await prepararControl(s);
    const ok = await s.autorizarPrecioVenta({ modo: 'divisas', promotor, lineas: [{ producto_id: prod.id, precio: 10, comision: 1 }] });
    expect(ok).toMatchObject({ modo: 'divisas', autorizado_por: '' });
    await expect(s.autorizarPrecioVenta({ modo: 'divisas', promotor, lineas: [{ producto_id: prod.id, precio: 12, comision: 1 }] })).rejects.toThrow(/menor al del catálogo/);
    await expect(s.autorizarPrecioVenta({ modo: 'divisas', promotor, lineas: [{ producto_id: prod.id, precio: 10 }] })).rejects.toThrow(/cuánto se le da al promotor/);
    await expect(s.autorizarPrecioVenta({ modo: 'divisas', promotor, lineas: [{ producto_id: prod.id, precio: 10, comision: 11 }] })).rejects.toThrow(/no puede ser mayor/);
  });
});

describe('demo: venta con precio en divisas', () => {
  async function vender(s: Awaited<ReturnType<typeof admin>>, pagos: { metodo: 'USD_EFECTIVO' | 'BINANCE_USDT' | 'BS_PUNTO_VENTA'; monto_usd: number; monto_bs: number | null }[]) {
    const prod = (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.codigo_barras === control.codigo_barras) ?? (await s.crearProducto(control));
    if (prod.stock_actual < 2) await s.registrarMovimiento({ producto_id: prod.id, tipo: 'ENTRADA', cantidad: 6, motivo: 'Compra' });
    const autorizacion = await s.autorizarPrecioVenta({ modo: 'divisas', promotor, lineas: [{ producto_id: prod.id, precio: 10, comision: 1 }] });
    return s.registrarVenta(
      [{ producto_id: prod.id, nombre: prod.nombre, codigo_barras: prod.codigo_barras, cantidad: 2, precio_unitario: 10, precio_lista: 12 }],
      { cliente, pagos, tasa_cambio: 40, precioPromotor: { promotor, autorizacion } }
    );
  }

  it('guarda el precio rebajado, la comisión (cantidad × comisión por unidad), el promotor y la comisión en Pendientes', async () => {
    const s = await admin();
    const venta = await vender(s, [{ metodo: 'USD_EFECTIVO', monto_usd: 20, monto_bs: null }]);
    expect(venta.comision).toBe(2);
    expect(venta.promotor_nombre).toBe('Luis Rojas');
    expect(venta.precio_autorizado_por).toBeNull();
    expect(venta.items[0]).toMatchObject({ precio_unitario: 10, precio_lista: 12, precio_tipo: 'divisas', comision_unidad: 1 });
    const pendientes = await s.listarPendientes({ tipo: 'COMISION' });
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]).toMatchObject({ estado: 'PENDIENTE', monto_usd: 2, promotor_cedula: 'V-12345678' });
    expect(pendientes[0].descripcion).toMatch(/en divisas con descuento/);
  });

  it('acepta Binance; un pago en bolívares se rechaza ANTES de tocar el inventario', async () => {
    const s = await admin();
    expect((await vender(s, [{ metodo: 'BINANCE_USDT', monto_usd: 20, monto_bs: null }])).comision).toBe(2);
    const prod = (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.codigo_barras === control.codigo_barras)!;
    const stockAntes = prod.stock_actual;
    await expect(vender(s, [{ metodo: 'BS_PUNTO_VENTA', monto_usd: 20, monto_bs: 800 }])).rejects.toThrow(/solo vale si se paga todo en dólares/);
    expect((await s.listarProductos({ catalogoCompleto: true })).find((x) => x.id === prod.id)!.stock_actual).toBe(stockAntes);
  });
});
