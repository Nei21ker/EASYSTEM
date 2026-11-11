// Modo demo (LocalStorage): una sola lista de promotores. El directorio es también la lista de «Promotores · pago diario» de la Nómina;
// la fila de nómina del promotor se crea sola al armarle la primera lista. Mismas reglas que tests/server/nomina.test.ts.
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

async function comoAdmin() {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion('admin@edwardaccesorios.com', 'admin123');
  return import('../../src/lib/inventoryService');
}

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('demo: el directorio de promotores es la lista de pago diario', () => {
  it('los promotores de ejemplo salen del directorio y ya no hay trabajadores independientes aparte', async () => {
    const s = await comoAdmin();
    const promotores = await s.listarPromotores();
    expect(promotores.map((p) => p.cedula)).toEqual(expect.arrayContaining(['V-26111222', 'V-27333444']));
    expect((await s.listarEmpleados()).filter((e) => e.tipo === 'INDEPENDIENTE')).toEqual([]);
  });

  it('crea la fila de nómina del promotor una sola vez y con los datos del directorio', async () => {
    const s = await comoAdmin();
    const p = (await s.listarPromotores()).find((x) => x.cedula === 'V-26111222')!;
    const a = await s.asegurarEmpleadoPromotor(p.id, LOCAL_VIDRIOS_ID);
    expect(a).toMatchObject({ promotor_id: p.id, tipo: 'INDEPENDIENTE', frecuencia_pago: 'DIARIO', salario_base: 0, nombre: 'Pedro', apellido: 'Salas', local_id: LOCAL_VIDRIOS_ID });
    expect((await s.asegurarEmpleadoPromotor(p.id, LOCAL_VIDRIOS_ID)).id).toBe(a.id);
    expect((await s.listarEmpleados()).filter((e) => e.promotor_id === p.id)).toHaveLength(1);
  });

  it('corregir al promotor corrige también su fila de nómina, y la cédula de un empleado no se puede usar', async () => {
    const s = await comoAdmin();
    const p = (await s.listarPromotores()).find((x) => x.cedula === 'V-26111222')!;
    const fila = await s.asegurarEmpleadoPromotor(p.id, LOCAL_VIDRIOS_ID);
    await s.actualizarPromotor(p.id, { cedula: 'V-26111222', nombre: 'Pedro José', apellido: 'Salas Rojas', telefono: null, banco: 'Banesco' });
    expect((await s.listarEmpleados()).find((e) => e.id === fila.id)).toMatchObject({ nombre: 'Pedro José', apellido: 'Salas Rojas' });
    // V-18234567 es de una empleada fija de ejemplo
    await expect(s.actualizarPromotor(p.id, { cedula: 'V-18234567', nombre: 'Pedro', apellido: 'Salas', telefono: null, banco: null })).rejects.toThrow(/empleado de nómina/);
  });

  it('un promotor que no existe, o cuya cédula ya es de un empleado, no tiene fila de nómina', async () => {
    const s = await comoAdmin();
    await expect(s.asegurarEmpleadoPromotor('no-existe', LOCAL_VIDRIOS_ID)).rejects.toThrow(/no existe/);
    const choque = await s.crearPromotor({ cedula: 'V-18234567', nombre: 'Otra', apellido: 'Persona', telefono: null, banco: null });
    await expect(s.asegurarEmpleadoPromotor(choque.id, LOCAL_VIDRIOS_ID)).rejects.toThrow(/ya está registrada como empleado/);
  });
});
