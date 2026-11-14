// Modo demo (LocalStorage): rol «supervisor» = los permisos del encargado en TODOS los locales (sin local propio).
// Mismas reglas que el servidor (tests/server/supervisor.test.ts).
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

async function cargarComo(email: string, clave: string, localActivo?: string) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  if (localActivo) localStorage.setItem('easystem:local-activo', localActivo);
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(email, clave);
  const servicio = await import('../../src/lib/inventoryService');
  return { auth, servicio };
}
const supervisor = (local?: string) => cargarComo('supervisor@edwardaccesorios.com', 'supervisor123', local);

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true, location: { reload: () => {} } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const producto = { codigo_barras: '2000000000101', nombre: 'Forro de prueba supervisor', categoria: 'Forros', precio_compra: 5, precio_venta: 9, stock_minimo: 0 };

describe('demo: sesión del supervisor', () => {
  it('existe la cuenta demo, sin local propio, y entra con la vista «Todos»', async () => {
    const { auth, servicio } = await supervisor();
    const sesion = await auth.obtenerSesionActual();
    expect(sesion).toMatchObject({ rol: 'supervisor', local_id: null });
    expect(auth.esGerencia(sesion?.rol)).toBe(true);
    expect(auth.esSinLocal(sesion?.rol)).toBe(true);
    expect(auth.veTodosLosLocales(sesion?.rol)).toBe(true);
    expect(auth.esGlobal(sesion?.rol)).toBe(false);
    const contexto = await servicio.obtenerContextoLocal();
    expect(contexto?.alcance).toBe('todos');
  });

  it('elige el local activo como el administrador y entonces opera en ese local', async () => {
    const { servicio } = await supervisor(LOCAL_VIDRIOS_ID);
    const contexto = await servicio.obtenerContextoLocal();
    expect(contexto?.alcance).toBe(LOCAL_VIDRIOS_ID);
    const p = await servicio.crearProducto(producto);
    await servicio.registrarMovimiento({ producto_id: p.id, tipo: 'ENTRADA', cantidad: 4, motivo: 'Compra' });
    const visible = (await servicio.listarProductos()).find((x) => x.id === p.id)!;
    expect(visible.stock_actual).toBe(4);
  });

  it('en la vista «Todos» no puede escribir (como el gerente): pide elegir un local', async () => {
    const { servicio } = await supervisor();
    const p = await servicio.crearProducto(producto);
    await expect(servicio.registrarMovimiento({ producto_id: p.id, tipo: 'ENTRADA', cantidad: 1, motivo: 'Compra' })).rejects.toThrow();
  });
});

describe('demo: límites del encargado', () => {
  it('no puede revertir bajas, eliminar ventas ni ver la inversión', async () => {
    const { servicio } = await supervisor(LOCAL_ACCESORIOS_ID);
    await expect(servicio.revertirBaja(['INF000001'])).rejects.toThrow(/administrador o el gerente/);
    await expect(servicio.eliminarVentas(['x'], { simular: true })).rejects.toThrow(/administrador o el gerente/);
    await expect(servicio.listarInversiones({})).rejects.toThrow(/administrador y el gerente/);
  });

  it('autoriza un precio mayor en cualquier local con su contraseña, pero no un descuento', async () => {
    const { auth } = await supervisor();
    expect(auth.verificarSupervisorDemo(undefined, 'supervisor123', LOCAL_VIDRIOS_ID)).toMatchObject({ nombre: 'Supervisor' });
    expect(auth.verificarSupervisorDemo(undefined, 'supervisor123', LOCAL_ACCESORIOS_ID)).not.toBeNull();
    expect(auth.verificarSupervisorDemo(undefined, 'supervisor123', LOCAL_ACCESORIOS_ID, true)).toBeNull();
  });
});
