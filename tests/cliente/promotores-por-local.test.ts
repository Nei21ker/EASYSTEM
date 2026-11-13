// Promotores por local, modo demo (mismas reglas que tests/server/promotores-por-local.test.ts) y el filtro del selector.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACCESORIOS_ID, LOCAL_VIDRIOS_ID } from '../../src/lib/constantes-locales';
import { filtrarPromotores, partirCedula } from '../../src/utils/selectorPromotor';
import type { Promotor } from '../../src/types/database.types';

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

async function cargarEn(local: string) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  localStorage.setItem('easystem:local-activo', local);
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('demo: promotores por local', () => {
  it('los de ejemplo cuentan como del Local Vidrios; uno nuevo queda en el local donde se registra', async () => {
    const vid = await cargarEn(LOCAL_VIDRIOS_ID);
    const ejemplo = (await vid.listarPromotoresDelLocal()).map((p) => p.nombre);
    expect(ejemplo).toContain('Pedro');
    await vid.crearPromotor({ cedula: 'V-33333333', nombre: 'Rosa', apellido: 'Gil' });
    expect((await vid.listarPromotoresDelLocal()).map((p) => p.nombre)).toContain('Rosa');

    // En Accesorios (mismo navegador) no aparece ninguno de Vidrios
    const acc = await cargarEn(LOCAL_ACCESORIOS_ID);
    expect(await acc.listarPromotoresDelLocal()).toEqual([]);
    await acc.crearPromotor({ cedula: 'V-44444444', nombre: 'Tomás', apellido: 'Díaz' });
    expect((await acc.listarPromotoresDelLocal()).map((p) => p.nombre)).toEqual(['Tomás']);
  });
});

const lista: Promotor[] = [
  { id: '1', cedula: 'V-12345678', nombre: 'José', apellido: 'Pérez', telefono: '0414-1112233', banco: null, created_at: '', updated_at: '' },
  { id: '2', cedula: 'E-99887766', nombre: 'Ana', apellido: 'Rojas', telefono: null, banco: null, created_at: '', updated_at: '' },
];

describe('selector de promotores: búsqueda y cédula', () => {
  it('busca por nombre, apellido, cédula o teléfono, sin acentos ni mayúsculas', () => {
    expect(filtrarPromotores(lista, 'jose').map((p) => p.id)).toEqual(['1']);
    expect(filtrarPromotores(lista, 'perez jose').map((p) => p.id)).toEqual(['1']);
    expect(filtrarPromotores(lista, '9988').map((p) => p.id)).toEqual(['2']);
    expect(filtrarPromotores(lista, '1112233').map((p) => p.id)).toEqual(['1']);
    expect(filtrarPromotores(lista, '')).toHaveLength(2);
    expect(filtrarPromotores(lista, 'zzz')).toEqual([]);
  });

  it('separa la cédula en nacionalidad y número', () => {
    expect(partirCedula('V-12345678')).toEqual({ nac: 'V', numero: '12345678' });
    expect(partirCedula('e-99887766')).toEqual({ nac: 'E', numero: '99887766' });
    expect(partirCedula('raro')).toEqual({ nac: 'V', numero: '' });
  });
});
