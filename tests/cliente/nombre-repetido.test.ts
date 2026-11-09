// Modo demo (LocalStorage): mismo rechazo que el servidor para un producto con un nombre que ya existe.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const servicio = await import('../../src/lib/inventoryService');
  // El administrador en la vista "Todos" no tiene local: se fija uno para crear productos
  return servicio;
}

const base = { codigo_barras: '2000000000015', nombre: 'Vidrio curvo Infinix Note 40 pro', categoria: 'Vidrios curvos', precio_venta: 7 };

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  // El servicio solo usa LocalStorage si hay un navegador: se simula uno mínimo
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('demo: nombre de producto repetido', () => {
  it('crear uno con el mismo nombre (aunque cambien mayúsculas, acentos o espacios) se rechaza y dice cuál es', async () => {
    const { crearProducto, listarProductos } = await cargarServicio();
    const primero = await crearProducto(base);
    await expect(crearProducto({ ...base, codigo_barras: '2000000000022' })).rejects.toThrow(/Ya existe un producto con ese nombre.*«\+ Stock»/);
    await expect(crearProducto({ ...base, codigo_barras: '2000000000039', nombre: '  VIDRIO  curvo infinix NOTE 40 pro ' })).rejects.toThrow(
      new RegExp(`\(${primero.referencia}\)`)
    );
    expect((await listarProductos({ catalogoCompleto: true })).filter((p) => p.nombre === base.nombre)).toHaveLength(1);
  });

  it('un nombre distinto sí se crea, y renombrar al de otro se rechaza (guardar con el propio no)', async () => {
    const { crearProducto, actualizarProducto } = await cargarServicio();
    const a = await crearProducto(base);
    const b = await crearProducto({ ...base, codigo_barras: '2000000000022', nombre: 'Otro vidrio' });
    await expect(actualizarProducto(b.id, { nombre: 'vidrio curvo infinix note 40 PRO' })).rejects.toThrow(/Ya existe un producto con ese nombre/);
    await expect(actualizarProducto(a.id, { nombre: 'VIDRIO CURVO INFINIX NOTE 40 PRO', precio_venta: 8 })).resolves.toBeDefined();
  });
});
