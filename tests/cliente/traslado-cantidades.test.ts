// Traslado de productos por cantidad (vidrios sencillos, sin código por pieza): modo demo (LocalStorage), vale impreso y resumen de envíos.
// Mismas reglas que el servidor (tests/server/traslado-cantidades.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACCESORIOS_ID, LOCAL_VIDRIOS_ID } from '../../src/lib/constantes-locales';
import { resumirEnvios } from '../../src/utils/envios';
import { htmlHojaDespacho } from '../../src/utils/hojasImpresas';
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

async function cargarComo(email: string, clave: string, local: string) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  localStorage.setItem('easystem:local-activo', local);
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(email, clave);
  return import('../../src/lib/inventoryService');
}
const admin = (local = LOCAL_VIDRIOS_ID) => cargarComo('admin@edwardaccesorios.com', 'admin123', local);

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const sencillo = (n: number) => ({ codigo_barras: `20000000100${n}`, nombre: `Vidrio sencillo Modelo ${n}`, categoria: 'Vidrios Templados', precio_venta: 1, control_por_cantidad: 1 });
const blindado = (n: number) => ({ codigo_barras: `20000000200${n}`, nombre: `Vidrio blindado Modelo ${n}`, categoria: 'Vidrios Templados', precio_venta: 5, control_por_cantidad: 0 });

async function preparar(s: Awaited<ReturnType<typeof admin>>) {
  const c = await s.crearProducto(sencillo(1));
  const d = await s.crearProducto(sencillo(2));
  const a = await s.crearProducto(blindado(1));
  await s.registrarMovimiento({ producto_id: c.id, tipo: 'ENTRADA', cantidad: 20, motivo: 'Compra' });
  await s.registrarMovimiento({ producto_id: d.id, tipo: 'ENTRADA', cantidad: 6, motivo: 'Compra' });
  await s.registrarMovimiento({ producto_id: a.id, tipo: 'ENTRADA', cantidad: 3, motivo: 'Compra' });
  const stock = async (id: string, localId: string) => (await s.listarProductos({ localId, catalogoCompleto: true })).find((x) => x.id === id)!.stock_actual;
  return { c, d, a, stock };
}

describe('demo: traslado por cantidad', () => {
  it('despachar saca del origen y deja la mercancía en tránsito; recibir total la suma al destino', async () => {
    const s = await admin();
    const { c, stock } = await preparar(s);
    const t = await s.despacharTraslado({ origenLocalId: LOCAL_VIDRIOS_ID, destinoLocalId: LOCAL_ACCESORIOS_ID, codigos: [], cantidades: [{ producto_id: c.id, cantidad: 8 }] });
    expect(t).toMatchObject({ estado: 'EN_TRANSITO', unidades: [] });
    expect(t.cantidades).toEqual([{ producto_id: c.id, producto_nombre: c.nombre, cantidad: 8, recibida: 0, devuelta: 0 }]);
    expect(await stock(c.id, LOCAL_VIDRIOS_ID)).toBe(12);
    expect(await stock(c.id, LOCAL_ACCESORIOS_ID)).toBe(0);

    const r = await s.recibirTraslado(t.id, [], [{ producto_id: c.id, cantidad: 8 }]);
    expect(r.estado).toBe('RECIBIDO');
    expect(r.cantidades![0]).toMatchObject({ recibida: 8, devuelta: 0 });
    expect(await stock(c.id, LOCAL_ACCESORIOS_ID)).toBe(8);
    expect(await stock(c.id, LOCAL_VIDRIOS_ID)).toBe(12);
  });

  it('recibir una parte lo deja en tránsito; no deja recibir más de lo que queda; cerrar devuelve lo que no llegó', async () => {
    const s = await admin();
    const { c, d, stock } = await preparar(s);
    const t = await s.despacharTraslado({
      origenLocalId: LOCAL_VIDRIOS_ID,
      destinoLocalId: LOCAL_ACCESORIOS_ID,
      codigos: [],
      cantidades: [{ producto_id: c.id, cantidad: 8 }, { producto_id: d.id, cantidad: 3 }],
    });
    const parcial = await s.recibirTraslado(t.id, [], [{ producto_id: c.id, cantidad: 5 }]);
    expect(parcial.estado).toBe('EN_TRANSITO');
    await expect(s.recibirTraslado(t.id, [], [{ producto_id: c.id, cantidad: 4 }])).rejects.toThrow(/solo quedan 3/);
    expect(await stock(c.id, LOCAL_ACCESORIOS_ID)).toBe(5);

    const cerrado = await s.cerrarTraslado(t.id);
    expect(cerrado.estado).toBe('RECIBIDO');
    expect(cerrado.cantidades!.find((x) => x.producto_id === c.id)).toMatchObject({ recibida: 5, devuelta: 3 });
    expect(cerrado.cantidades!.find((x) => x.producto_id === d.id)).toMatchObject({ recibida: 0, devuelta: 3 });
    expect(await stock(c.id, LOCAL_VIDRIOS_ID)).toBe(15);
    expect(await stock(d.id, LOCAL_VIDRIOS_ID)).toBe(6);
  });

  it('sin recibir nada, cerrarlo lo anula y todo vuelve al origen', async () => {
    const s = await admin();
    const { c, stock } = await preparar(s);
    const t = await s.despacharTraslado({ origenLocalId: LOCAL_VIDRIOS_ID, destinoLocalId: LOCAL_ACCESORIOS_ID, codigos: [], cantidades: [{ producto_id: c.id, cantidad: 2 }] });
    expect((await s.cerrarTraslado(t.id)).estado).toBe('ANULADO');
    expect(await stock(c.id, LOCAL_VIDRIOS_ID)).toBe(20);
  });

  it('valida: stock, producto con etiqueta, cantidades inválidas y repetidos; sin dejar nada a medias', async () => {
    const s = await admin();
    const { c, a, stock } = await preparar(s);
    const base = { origenLocalId: LOCAL_VIDRIOS_ID, destinoLocalId: LOCAL_ACCESORIOS_ID, codigos: [] as string[] };
    await expect(s.despacharTraslado({ ...base, cantidades: [{ producto_id: c.id, cantidad: 21 }] })).rejects.toThrow(/No alcanza el stock/);
    await expect(s.despacharTraslado({ ...base, cantidades: [{ producto_id: a.id, cantidad: 1 }] })).rejects.toThrow(/etiqueta por pieza/);
    await expect(s.despacharTraslado({ ...base, cantidades: [{ producto_id: c.id, cantidad: 0 }] })).rejects.toThrow(/entero de 1 a 5000/);
    await expect(s.despacharTraslado({ ...base, cantidades: [{ producto_id: c.id, cantidad: 1 }, { producto_id: c.id, cantidad: 2 }] })).rejects.toThrow(/repetidos/);
    await expect(s.despacharTraslado({ ...base, cantidades: [] })).rejects.toThrow();
    expect(await stock(c.id, LOCAL_VIDRIOS_ID)).toBe(20);
    expect(await s.listarTraslados()).toEqual([]);
  });

  it('se puede mezclar con piezas que sí llevan código', async () => {
    const s = await admin();
    const { c, a } = await preparar(s);
    const piezas = (await s.listarUnidades({ productoId: a.id, estado: 'DISPONIBLE' })).map((u) => u.codigo).slice(0, 2);
    const t = await s.despacharTraslado({ origenLocalId: LOCAL_VIDRIOS_ID, destinoLocalId: LOCAL_ACCESORIOS_ID, codigos: piezas, cantidades: [{ producto_id: c.id, cantidad: 4 }] });
    expect(t.unidades).toHaveLength(2);
    const r1 = await s.recibirTraslado(t.id, piezas, []);
    expect(r1.estado).toBe('EN_TRANSITO');
    const r2 = await s.recibirTraslado(t.id, [], [{ producto_id: c.id, cantidad: 4 }]);
    expect(r2.estado).toBe('RECIBIDO');
  });
});

const traslado = (extra: Partial<Traslado> = {}): Traslado => ({
  id: 't', folio: 3, origen_local_id: 'o', destino_local_id: 'd', origen_nombre: 'Local Vidrios', destino_nombre: 'Barquicenter Vidrios',
  estado: 'EN_TRANSITO', creado_en: '2026-11-15T15:00:00.000Z', enviado_por: 'Ana', recibido_en: null, recibido_por: null, cerrado_en: null, notas: null,
  unidades: [],
  cantidades: [{ producto_id: 'c', producto_nombre: 'Vidrio sencillo Moto G14', cantidad: 8, recibida: 0, devuelta: 0 }],
  ...extra,
});

describe('vale de despacho con productos por cantidad', () => {
  it('muestra la tabla por cantidad (con espacio para anotar lo que llegó) y no la de piezas si no hay', () => {
    const html = htmlHojaDespacho(traslado());
    expect(html).toContain('Productos por cantidad');
    expect(html).toContain('Vidrio sencillo Moto G14');
    expect(html).toContain('______');
    expect(html).not.toContain('Detalle por pieza');
  });

  it('con piezas y cantidades muestra las dos secciones, y lo ya recibido aparece escrito', () => {
    const html = htmlHojaDespacho(
      traslado({
        unidades: [{ codigo: 'VID000001', producto_id: 'a', producto_nombre: 'Vidrio blindado', recibida_en: null, devuelta_en: null }],
        cantidades: [{ producto_id: 'c', producto_nombre: 'Vidrio sencillo Moto G14', cantidad: 8, recibida: 5, devuelta: 3 }],
      })
    );
    expect(html).toContain('Detalle por pieza');
    expect(html).toContain('Productos por cantidad');
    expect(html).toContain('5 (volvieron 3)');
  });
});

describe('resumen de envíos con productos por cantidad', () => {
  const precios = new Map([['c', 1], ['d', 2]]);

  it('cuenta lo despachado menos lo que volvió, y separa lo recibido de lo que sigue en camino', () => {
    const t = traslado({
      cantidades: [
        { producto_id: 'c', producto_nombre: 'C', cantidad: 8, recibida: 5, devuelta: 1 },
        { producto_id: 'd', producto_nombre: 'D', cantidad: 3, recibida: 0, devuelta: 3 },
      ],
    });
    const r = resumirEnvios([t], precios, '2026-11');
    expect(r).toMatchObject({ traslados: 1, piezas: 7, en_camino: 2, valor_usd: 7 });
    expect(r.rutas[0]).toMatchObject({ piezas: 7, recibidas: 5, en_camino: 2 });
  });
});
