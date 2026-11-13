// Modo demo (LocalStorage): carga inicial del Local Servicio Técnico (cantidad corregida SIN movimientos mientras el producto no tenga
// foto y precio). Mismas reglas que el servidor (tests/server/carga-inicial-servicio-tecnico.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACCESORIOS_ID, LOCAL_SERVICIO_TECNICO_ID } from '../../src/lib/constantes-locales';
import { errorCantidadCarga, MAX_CANTIDAD_CARGA, productoEnCarga } from '../../src/utils/cargaInicial';

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

async function cargarComo(email: string, clave: string, localActivo = LOCAL_SERVICIO_TECNICO_ID) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  localStorage.setItem('easystem:local-activo', localActivo);
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(email, clave);
  return import('../../src/lib/inventoryService');
}
const admin = () => cargarComo('admin@edwardaccesorios.com', 'admin123');

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const producto = { codigo_barras: '2000000000101', nombre: 'Cable USB micro prueba', categoria: 'Cables y adaptadores', precio_venta: 0, stock_minimo: 0 };

describe('reglas puras de la carga inicial', () => {
  it('un producto está «en carga» si no tiene foto o no tiene precio', () => {
    expect(productoEnCarga({ imagen_url: null, precio_venta: 0 })).toBe(true);
    expect(productoEnCarga({ imagen_url: '/foto.jpg', precio_venta: 0 })).toBe(true);
    expect(productoEnCarga({ imagen_url: null, precio_venta: 5 })).toBe(true);
    expect(productoEnCarga({ imagen_url: '/foto.jpg', precio_venta: 5 })).toBe(false);
  });

  it('la cantidad es un entero de 0 a ' + MAX_CANTIDAD_CARGA, () => {
    expect(errorCantidadCarga(0)).toBeNull();
    expect(errorCantidadCarga(MAX_CANTIDAD_CARGA)).toBeNull();
    expect(errorCantidadCarga(-1)).toMatch(/entero/);
    expect(errorCantidadCarga(1.5)).toMatch(/entero/);
    expect(errorCantidadCarga(MAX_CANTIDAD_CARGA + 1)).toMatch(/no puede pasar/);
    expect(errorCantidadCarga('3')).toMatch(/entero/);
  });
});

describe('demo: establecerCantidadEnCarga', () => {
  it('sube y baja la cantidad con piezas y SIN movimientos', async () => {
    const s = await admin();
    const p = await s.crearProducto(producto);
    const movimientosAntes = (await s.listarMovimientos()).length;

    await s.establecerCantidadEnCarga(p.id, LOCAL_SERVICIO_TECNICO_ID, 5);
    let actual = (await s.listarProductos()).find((x) => x.id === p.id)!;
    expect(actual.stock_actual).toBe(5);
    expect((await s.listarUnidades({ productoId: p.id, estado: 'DISPONIBLE' })).length).toBe(5);

    await s.establecerCantidadEnCarga(p.id, LOCAL_SERVICIO_TECNICO_ID, 2);
    actual = (await s.listarProductos()).find((x) => x.id === p.id)!;
    expect(actual.stock_actual).toBe(2);
    expect((await s.listarUnidades({ productoId: p.id, estado: 'DISPONIBLE' })).length).toBe(2);
    expect((await s.listarMovimientos()).length).toBe(movimientosAntes);
  });

  it('con foto y precio ya no se puede: 409 en el servidor y el mismo mensaje en la demo', async () => {
    const s = await admin();
    const p = await s.crearProducto(producto);
    await s.establecerCantidadEnCarga(p.id, LOCAL_SERVICIO_TECNICO_ID, 3);
    await s.actualizarProducto(p.id, { precio_venta: 4, imagen_url: 'data:image/png;base64,AAAA' });
    await expect(s.establecerCantidadEnCarga(p.id, LOCAL_SERVICIO_TECNICO_ID, 9)).rejects.toThrow(/ya tiene foto y precio/);
    expect((await s.listarProductos()).find((x) => x.id === p.id)!.stock_actual).toBe(3);
  });

  it('solo en el Local Servicio Técnico y con una cantidad válida', async () => {
    const s = await admin();
    const p = await s.crearProducto(producto);
    await expect(s.establecerCantidadEnCarga(p.id, LOCAL_ACCESORIOS_ID, 1)).rejects.toThrow(/solo en el Local Servicio Técnico/);
    await expect(s.establecerCantidadEnCarga(p.id, LOCAL_SERVICIO_TECNICO_ID, -2)).rejects.toThrow(/entero/);
    await expect(s.establecerCantidadEnCarga('no-existe', LOCAL_SERVICIO_TECNICO_ID, 1)).rejects.toThrow(/no encontrado/i);
  });

  it('el vendedor no puede', async () => {
    const s = await cargarComo('vendedor@edwardaccesorios.com', 'vendedor123');
    await expect(s.establecerCantidadEnCarga('cualquiera', LOCAL_SERVICIO_TECNICO_ID, 1)).rejects.toThrow(/permiso/);
  });
});
