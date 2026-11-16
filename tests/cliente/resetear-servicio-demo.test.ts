// Modo demo (LocalStorage): «Resetear servicio técnico» es de UN local, solo del administrador, y devuelve los repuestos al inventario.
// Mismas reglas que el servidor (tests/server/resetear-servicio.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACCESORIOS_ID, LOCAL_SERVICIO_TECNICO_ID } from '../../src/lib/constantes-locales';

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

async function cargarComo(email: string, clave: string, localActivo: string = LOCAL_SERVICIO_TECNICO_ID) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  localStorage.setItem('easystem:local-activo', localActivo);
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(email, clave);
  return import('../../src/lib/inventoryService');
}

const equipo = { cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567', equipo_marca: 'Apple', equipo_modelo: 'iPhone 11', falla_reportada: 'Pantalla rota' };

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('demo: resetear el servicio técnico', () => {
  it('borra las órdenes del local y los repuestos vuelven al stock (simular solo cuenta)', async () => {
    const s = await cargarComo('admin@edwardaccesorios.com', 'admin123');
    const producto = (await s.listarProductos()).find((p) => p.stock_actual >= 2);
    expect(producto).toBeTruthy();
    const antes = producto!.stock_actual;
    const orden = await s.crearOrdenServicio(equipo);
    await s.agregarRepuestoOrden(orden.id, producto!, 2);
    expect((await s.listarProductos()).find((p) => p.id === producto!.id)!.stock_actual).toBe(antes - 2);

    const simulado = await s.resetearServicioTecnico({ localId: LOCAL_SERVICIO_TECNICO_ID, simular: true });
    expect(simulado).toEqual({ ordenes: 1, cobradas: 0, piezas: 2, simulado: true });
    expect((await s.listarOrdenesServicio()).length).toBe(1);

    const r = await s.resetearServicioTecnico({ localId: LOCAL_SERVICIO_TECNICO_ID });
    expect(r).toMatchObject({ ordenes: 1, piezas: 2, simulado: false });
    expect((await s.listarOrdenesServicio()).length).toBe(0);
    expect((await s.listarProductos()).find((p) => p.id === producto!.id)!.stock_actual).toBe(antes);
  });

  it('exige elegir un local (no «Todos»), que tenga servicio técnico, y rechaza a quien no es administrador', async () => {
    const s = await cargarComo('admin@edwardaccesorios.com', 'admin123', 'todos');
    await expect(s.resetearServicioTecnico()).rejects.toThrow(/local/i);
    await expect(s.resetearServicioTecnico({ localId: LOCAL_ACCESORIOS_ID })).rejects.toThrow(/no tiene servicio técnico/);
    const e = await cargarComo('encargado@edwardaccesorios.com', 'encargado123');
    await expect(e.resetearServicioTecnico({ localId: LOCAL_SERVICIO_TECNICO_ID })).rejects.toThrow(/administrador/);
  });
});
