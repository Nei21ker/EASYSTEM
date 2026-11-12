// Venta EN ESPERA (Local Vidrios), modo demo: mismas reglas que el servidor (tests/server/espera.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACCESORIOS_ID, LOCAL_VIDRIOS_ID } from '../../src/lib/constantes-locales';

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

async function cargarComo(email: string, clave: string, local = LOCAL_VIDRIOS_ID) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  localStorage.setItem('easystem:local-activo', local);
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(email, clave);
  return import('../../src/lib/inventoryService');
}

const admin = () => cargarComo('admin@edwardaccesorios.com', 'admin123');
const vendedor = () => cargarComo('vendedor@edwardaccesorios.com', 'vendedor123');
const tecnico = () => cargarComo('tecnico@edwardaccesorios.com', 'tecnico123');

const vidrio = { codigo_barras: '2000000000015', nombre: 'Vidrio blindado Infinix Note 40', categoria: 'Vidrios Templados', precio_venta: 5, control_por_cantidad: 0 };

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function conStock(s: Awaited<ReturnType<typeof admin>>, cantidad = 5) {
  const prod = (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.codigo_barras === vidrio.codigo_barras) ?? (await s.crearProducto(vidrio));
  await s.registrarMovimiento({ producto_id: prod.id, tipo: 'ENTRADA', cantidad, motivo: 'Compra' });
  return prod;
}

describe('demo: venta en espera', () => {
  it('guarda el carrito como mercancía pendiente, sin tocar el stock, y aparece en la lista', async () => {
    const s = await admin();
    const prod = await conStock(s);
    const e = await s.ponerEnEspera({ items: [{ producto_id: prod.id, cantidad: 2 }], promotor_nombre: ' Pedro   Salas ', nota: 'viene pronto' });
    expect(e).toMatchObject({ tipo: 'MERCANCIA', estado: 'PENDIENTE', promotor_nombre: 'Pedro Salas', monto_usd: 10, local_id: LOCAL_VIDRIOS_ID });
    expect(e.items).toEqual([expect.objectContaining({ producto_id: prod.id, cantidad: 2, precio_unitario: 5 })]);
    expect(e.descripcion).toContain('En espera: viene pronto');
    expect((await s.listarEspera()).map((x) => x.id)).toEqual([e.id]);
    const stock = (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.id === prod.id)!.stock_actual;
    expect(stock).toBe(5);
  });

  it('reserva el stock: no se puede dejar en espera más de lo que queda sin reservar', async () => {
    const s = await admin();
    const prod = await conStock(s, 3);
    await s.ponerEnEspera({ items: [{ producto_id: prod.id, cantidad: 2 }] });
    await expect(s.ponerEnEspera({ items: [{ producto_id: prod.id, cantidad: 2 }] })).rejects.toThrow(/solo quedan 1 sin reservar/);
    await expect(s.ponerEnEspera({ items: [] })).rejects.toThrow(/vacío/);
    await expect(s.ponerEnEspera({ items: [{ producto_id: 'no-existe', cantidad: 1 }] })).rejects.toThrow(/ya no existe/);
  });

  it('liberarla la saca de la lista y suelta la reserva; no se libera dos veces', async () => {
    const s = await admin();
    const prod = await conStock(s, 3);
    const e = await s.ponerEnEspera({ items: [{ producto_id: prod.id, cantidad: 3 }] });
    await s.liberarEspera(e.id);
    expect(await s.listarEspera()).toEqual([]);
    await expect(s.liberarEspera(e.id)).rejects.toThrow(/ya se cerró/);
    await s.ponerEnEspera({ items: [{ producto_id: prod.id, cantidad: 3 }] }); // la reserva quedó libre
  });

  it('cobrarla (esperaId) cierra la espera junto con la venta; una espera ya cerrada no se puede cobrar', async () => {
    const s = await admin();
    const prod = await conStock(s, 5);
    const e = await s.ponerEnEspera({ items: [{ producto_id: prod.id, cantidad: 2 }] });
    const venta = await s.registrarVenta([{ producto_id: prod.id, nombre: prod.nombre, codigo_barras: prod.codigo_barras, cantidad: 2, precio_unitario: 5 }], {
      cliente: null,
      pagos: [{ metodo: 'USD_EFECTIVO' as const, monto_usd: 10, monto_bs: null }],
      tasa_cambio: 40,
      esperaId: e.id,
    });
    expect(venta.folio).toBeGreaterThan(0);
    expect(await s.listarEspera()).toEqual([]);
    const cerrada = (await s.listarPendientes({ tipo: 'MERCANCIA' })).find((x) => x.id === e.id)!;
    expect(cerrada).toMatchObject({ estado: 'PAGADO', venta_id: venta.id, venta_folio: venta.folio, nota_cierre: `Cobrada en la venta #${venta.folio}` });
    const stock = (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.id === prod.id)!.stock_actual;
    expect(stock).toBe(3); // salió UNA vez, con la venta

    await expect(
      s.registrarVenta([{ producto_id: prod.id, nombre: prod.nombre, codigo_barras: prod.codigo_barras, cantidad: 1, precio_unitario: 5 }], {
        cliente: null,
        pagos: [{ metodo: 'USD_EFECTIVO' as const, monto_usd: 5, monto_bs: null }],
        tasa_cambio: 40,
        esperaId: e.id,
      })
    ).rejects.toThrow(/ya se cobró o se liberó/);
    expect((await s.listarProductos({ catalogoCompleto: true })).find((x) => x.id === prod.id)!.stock_actual).toBe(3); // no se movió stock
  });

  it('solo en el Local Vidrios y no para el técnico', async () => {
    const t = await tecnico();
    await expect(t.listarEspera()).rejects.toThrow(/no tiene permiso/);
    const a = await cargarComo('admin@edwardaccesorios.com', 'admin123', LOCAL_ACCESORIOS_ID);
    const prod = await conStock(a);
    await expect(a.ponerEnEspera({ items: [{ producto_id: prod.id, cantidad: 1 }] })).rejects.toThrow(/solo se usan en el Local Vidrios/);
  });

  it('un vendedor puede consultar las esperas de su local (en el demo el suyo es Accesorios: ninguna) y no dejar ventas ahí', async () => {
    const v = await vendedor();
    const prod = await conStock(v);
    expect(await v.listarEspera()).toEqual([]);
    await expect(v.ponerEnEspera({ items: [{ producto_id: prod.id, cantidad: 1 }] })).rejects.toThrow(/solo se usan en el Local Vidrios/);
  });
});
