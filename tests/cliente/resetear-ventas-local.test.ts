// Modo demo (LocalStorage): "Resetear ventas" es de UN solo local. Mismas reglas que el servidor (tests/server/resetear-ventas.test.ts).
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

async function cargarComo(email: string, clave: string, localActivo: string) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  localStorage.setItem('easystem:local-activo', localActivo);
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(email, clave);
  return import('../../src/lib/inventoryService');
}

const cliente = { cedula: 'V-11111111', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567' };
const pagoUsd = (monto: number) => [{ metodo: 'USD_EFECTIVO' as const, monto_usd: monto, monto_bs: null }];

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Un producto con stock y una venta en el local activo de la sesión. */
async function venderAqui(s: Awaited<ReturnType<typeof cargarComo>>, codigo: string, nombre: string) {
  const producto = await s.crearProducto({ codigo_barras: codigo, nombre, categoria: 'Forros', precio_venta: 6, control_por_cantidad: 0 });
  await s.registrarMovimiento({ producto_id: producto.id, tipo: 'ENTRADA', cantidad: 5, motivo: 'Compra' });
  await s.registrarVenta(
    [{ producto_id: producto.id, nombre, codigo_barras: codigo, cantidad: 2, precio_unitario: 6 }],
    { cliente, pagos: pagoUsd(12), tasa_cambio: 40 }
  );
  return producto;
}

describe('demo: resetearVentas de un solo local', () => {
  it('borra solo las ventas del local pedido y deja las de los demás', async () => {
    const accesorios = await cargarComo('admin@edwardaccesorios.com', 'admin123', LOCAL_ACCESORIOS_ID);
    await venderAqui(accesorios, '2000000000015', 'Forro A');
    const vidrios = await cargarComo('admin@edwardaccesorios.com', 'admin123', LOCAL_VIDRIOS_ID);
    await venderAqui(vidrios, '2000000000022', 'Forro B');
    const ventasEnDb = () => (JSON.parse(localStorage.getItem('easystem:db:v1') ?? '{}') as { ventas?: { local_id: string }[] }).ventas ?? [];
    expect(ventasEnDb().map((v) => v.local_id).sort()).toEqual([LOCAL_ACCESORIOS_ID, LOCAL_VIDRIOS_ID].sort());

    expect(await vidrios.resetearVentas({ localId: LOCAL_VIDRIOS_ID, simular: true })).toMatchObject({ ventas: 1, piezas: 2, simulado: true });
    const r = await vidrios.resetearVentas({ localId: LOCAL_VIDRIOS_ID });

    expect(r).toMatchObject({ ventas: 1, piezas: 2, simulado: false });
    // Las ventas del otro local siguen ahí
    expect(ventasEnDb().map((v) => v.local_id)).toEqual([LOCAL_ACCESORIOS_ID]);
  });

  it('sin indicar el local usa el activo; en «Todos los locales» pide elegir uno y no borra nada', async () => {
    const s = await cargarComo('admin@edwardaccesorios.com', 'admin123', LOCAL_ACCESORIOS_ID);
    await venderAqui(s, '2000000000015', 'Forro A');
    const todos = await cargarComo('admin@edwardaccesorios.com', 'admin123', 'todos');
    await expect(todos.resetearVentas()).rejects.toThrow(/Elige un local/);
    const db = JSON.parse(localStorage.getItem('easystem:db:v1') ?? '{}') as { ventas?: unknown[] };
    expect(db.ventas).toHaveLength(1);

    const aqui = await cargarComo('admin@edwardaccesorios.com', 'admin123', LOCAL_ACCESORIOS_ID);
    expect(await aqui.resetearVentas()).toMatchObject({ ventas: 1 });
  });
});
