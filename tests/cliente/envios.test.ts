// Resumen de envíos entre locales (por ruta y mes), aviso de traslado atrasado y alta de locales en el modo demo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIAS_TRANSITO_ATRASADO, diasDesde, mesDe, resumirEnvios } from '../../src/utils/envios';
import { normalizarLocalNuevo, nombreConSede } from '../../src/utils/local';
import type { Traslado } from '../../src/types/database.types';

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

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const traslado = (extra: Partial<Traslado> = {}): Traslado => ({
  id: 't', folio: 1, origen_local_id: 'o', destino_local_id: 'd', origen_nombre: 'Local Accesorios', destino_nombre: 'Barquicenter Accesorios',
  estado: 'RECIBIDO', creado_en: '2026-11-15T15:00:00.000Z', enviado_por: 'x', recibido_en: null, recibido_por: null, cerrado_en: null, notas: null,
  unidades: [
    { codigo: 'FOR000001', producto_id: 'a', producto_nombre: 'A', recibida_en: '2026-11-16T15:00:00.000Z', devuelta_en: null },
    { codigo: 'FOR000002', producto_id: 'a', producto_nombre: 'A', recibida_en: null, devuelta_en: null },
    { codigo: 'FOR000003', producto_id: 'b', producto_nombre: 'B', recibida_en: null, devuelta_en: '2026-11-17T15:00:00.000Z' },
  ],
  ...extra,
});

describe('resumirEnvios', () => {
  const precios = new Map([['a', 6], ['b', 10]]);

  it('suma por ruta; lo que volvió al origen no cuenta y lo que sigue en camino se separa', () => {
    const r = resumirEnvios([traslado(), traslado({ id: 't2', folio: 2 })], precios, '2026-11');
    expect(r).toMatchObject({ traslados: 2, piezas: 4, en_camino: 2, valor_usd: 24 });
    expect(r.rutas).toHaveLength(1);
    expect(r.rutas[0]).toMatchObject({ origen: 'Local Accesorios', destino: 'Barquicenter Accesorios', traslados: 2, piezas: 4, recibidas: 2, en_camino: 2, valor_usd: 24 });
  });

  it('ignora los anulados y los de otros meses, y separa rutas distintas', () => {
    const r = resumirEnvios(
      [traslado({ estado: 'ANULADO' }), traslado({ id: 'x', creado_en: '2026-10-15T15:00:00.000Z' }), traslado({ id: 'y', destino_local_id: 'e', destino_nombre: 'Barquicenter Vidrios' })],
      precios,
      '2026-11'
    );
    expect(r.traslados).toBe(1);
    expect(r.rutas.map((x) => x.destino)).toEqual(['Barquicenter Vidrios']);
    expect(resumirEnvios([], precios, '2026-11')).toMatchObject({ traslados: 0, piezas: 0, valor_usd: 0, rutas: [] });
  });

  it('un producto sin precio vale 0 y el mes se saca de la fecha', () => {
    expect(resumirEnvios([traslado()], new Map(), '2026-11').valor_usd).toBe(0);
    expect(mesDe('2026-11-15T15:00:00.000Z')).toBe('2026-11');
  });

  it('cuenta los días en tránsito', () => {
    const ahora = new Date('2026-11-20T15:00:00.000Z');
    expect(diasDesde('2026-11-20T10:00:00.000Z', ahora)).toBe(0);
    expect(diasDesde('2026-11-17T15:00:00.000Z', ahora)).toBe(3);
    expect(DIAS_TRANSITO_ATRASADO).toBe(2);
  });
});

describe('reglas del alta de un local', () => {
  it('limpia espacios y deja la sede vacía como null', () => {
    expect(normalizarLocalNuevo({ nombre: '  Barquicenter   Vidrios ', tipo: 'vidrios', sede: ' Barquicenter ' })).toEqual({ nombre: 'Barquicenter Vidrios', tipo: 'vidrios', sede: 'Barquicenter', direccion: null, telefono: null });
    expect(normalizarLocalNuevo({ nombre: 'Local X', tipo: 'controles', sede: '  ' })).toMatchObject({ sede: null });
    expect(normalizarLocalNuevo({ nombre: 'ab', tipo: 'vidrios' })).toMatch(/entre 3 y 60/);
    expect(normalizarLocalNuevo({ nombre: 'Local X', tipo: 'nada' as never })).toMatch(/tipo/);
    expect(nombreConSede({ nombre: 'Local X', sede: 'Cosmos' })).toBe('Local X · Cosmos');
  });
});

async function cargarComoAdmin() {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion('admin@edwardaccesorios.com', 'admin123');
  return { auth, s: await import('../../src/lib/inventoryService') };
}

describe('demo: agregar un local', () => {
  it('el local nuevo aparece en la lista, en los destinos con su sede y en el panel de suscripciones', async () => {
    const { auth, s } = await cargarComoAdmin();
    const l = await s.crearLocal({ nombre: 'Barquicenter Accesorios', tipo: 'accesorios', sede: 'Barquicenter' });
    expect(l).toMatchObject({ nombre: 'Barquicenter Accesorios', sede: 'Barquicenter', activo: true });
    expect((await s.listarLocales()).some((x) => x.id === l.id)).toBe(true);
    expect((await s.listarDestinosTraslado()).find((d) => d.id === l.id)).toMatchObject({ sede: 'Barquicenter' });
    expect((await auth.listarSuscripciones()).find((x) => x.id === l.id)).toMatchObject({ nombre: 'Barquicenter Accesorios', sede: 'Barquicenter', vigente: true });
    await expect(s.crearLocal({ nombre: 'barquicenter accesorios', tipo: 'accesorios' })).rejects.toThrow(/Ya existe/);
    await expect(s.crearLocal({ nombre: 'x', tipo: 'accesorios' })).rejects.toThrow(/entre 3 y 60/);
  });

  it('un encargado no puede agregar locales', async () => {
    vi.resetModules();
    vi.stubEnv('PUBLIC_USAR_API', 'false');
    const auth = await import('../../src/lib/auth');
    await auth.iniciarSesion('encargado@edwardaccesorios.com', 'encargado123');
    const s = await import('../../src/lib/inventoryService');
    await expect(s.crearLocal({ nombre: 'Barquicenter Vidrios', tipo: 'vidrios' })).rejects.toThrow(/Solo el administrador/);
  });
});
