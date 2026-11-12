// Cambio de mercancía con otro local (Local Vidrios): reglas puras (resumen del mes, advertencia de valor) y modo demo (LocalStorage),
// con las mismas reglas que el servidor (tests/server/intercambios.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACCESORIOS_ID, LOCAL_VIDRIOS_ID } from '../../src/lib/constantes-locales';
import { advertenciaDeValor, claveContraparte, limitesDelMes, normalizarContraparte, normalizarLineasIntercambio, resumirCambios, valorDeItems } from '../../src/utils/intercambio';
import type { Intercambio } from '../../src/types/database.types';

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
const encargado = () => cargarComo('encargado@edwardaccesorios.com', 'encargado123');

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const cambio = (extra: Partial<Intercambio> = {}): Intercambio => ({
  id: 'x', folio: 1, local_id: LOCAL_VIDRIOS_ID, contraparte: 'Local Centro', nota: null, estado: 'COMPLETADO', lado_pendiente: null,
  salen: [{ producto_id: 'a', nombre: 'A', codigo: null, cantidad: 5, precio_unitario: 5 }],
  entran: [{ producto_id: 'b', nombre: 'B', codigo: null, cantidad: 5, precio_unitario: 4 }],
  valor_sale_usd: 25, valor_entra_usd: 20, creado_por_nombre: 'x', fecha: '2026-11-05T15:00:00.000Z',
  completado_en: null, completado_por_nombre: null, anulado_en: null, anulado_por_nombre: null, nota_cierre: null,
  ...extra,
});

describe('reglas puras del cambio de mercancía', () => {
  it('la advertencia salta solo cuando lo que entra vale más de 15 % menos', () => {
    expect(advertenciaDeValor(25, 25)).toBeNull();
    expect(advertenciaDeValor(25, 22)).toBeNull(); // 12 % menos: normal
    expect(advertenciaDeValor(25, 30)).toBeNull(); // entra más de lo que sale
    expect(advertenciaDeValor(0, 0)).toBeNull();
    expect(advertenciaDeValor(25, 20)).toEqual({ falta_usd: 5, proporcion: 0.8 });
    expect(advertenciaDeValor(10, 0)?.falta_usd).toBe(10);
  });

  it('junta productos repetidos y valida cantidades y piezas', () => {
    expect(normalizarLineasIntercambio([{ producto_id: 'a', cantidad: 2, unidades: ['X1'] }, { producto_id: 'a', cantidad: 3 }, { producto_id: 'b', cantidad: 1 }], 'entregas')).toEqual([
      { producto_id: 'a', cantidad: 5, unidades: ['X1'] },
      { producto_id: 'b', cantidad: 1 },
    ]);
    expect(() => normalizarLineasIntercambio([{ producto_id: 'a', cantidad: 0 }], 'entregas')).toThrow(/entero mayor a 0/);
    expect(() => normalizarLineasIntercambio([{ producto_id: 'a', cantidad: 1, unidades: ['X1', 'X2'] }], 'entregas')).toThrow(/más piezas/);
    expect(() => normalizarLineasIntercambio([{ producto_id: 'a', cantidad: 2, unidades: ['X1', 'X1'] }], 'entregas')).toThrow(/repetidas/);
    expect(valorDeItems([{ cantidad: 3, precio_unitario: 1.22 }, { cantidad: 2, precio_unitario: 5 }])).toBe(13.66);
  });

  it('limpia el nombre de la contraparte y lo agrupa sin mayúsculas ni acentos', () => {
    expect(normalizarContraparte('  Local   Centro ')).toBe('Local Centro');
    expect(normalizarContraparte('a')).toBeNull();
    expect(claveContraparte('Local Níquel')).toBe(claveContraparte(' local   niquel'));
    expect(limitesDelMes('2026-02-10')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
  });

  it('el resumen del mes suma por contraparte, no cuenta los anulados y en espera solo cuenta el lado ya movido', () => {
    const r = resumirCambios([
      cambio(),
      cambio({ folio: 2, contraparte: 'local centro' }),
      cambio({ folio: 3, contraparte: 'Otro Local', valor_sale_usd: 10, valor_entra_usd: 10, salen: [{ producto_id: 'a', nombre: 'A', codigo: null, cantidad: 2, precio_unitario: 5 }], entran: [{ producto_id: 'b', nombre: 'B', codigo: null, cantidad: 2, precio_unitario: 5 }], estado: 'EN_ESPERA', lado_pendiente: 'ENTRAN' }),
      cambio({ folio: 4, estado: 'ANULADO' }),
    ]);
    expect(r).toMatchObject({ cambios: 3, en_espera: 1, piezas_salen: 12, piezas_entran: 10, valor_sale_usd: 60, valor_entra_usd: 40, neto_usd: -20 });
    expect(r.porContraparte).toHaveLength(2);
    expect(r.porContraparte[0]).toMatchObject({ nombre: 'Local Centro', cambios: 2, piezas_salen: 10, piezas_entran: 10, neto_usd: -10 });
    expect(r.porContraparte[1]).toMatchObject({ nombre: 'Otro Local', cambios: 1, piezas_salen: 2, piezas_entran: 0, neto_usd: -10 });
  });
});

const vidrio = (n: number, precio = 5, extra: Record<string, unknown> = {}) => ({ codigo_barras: `20000000000${n}`, nombre: `Vidrio blindado Modelo ${n}`, categoria: 'Vidrios Templados', precio_venta: precio, control_por_cantidad: 0, ...extra });

describe('demo: cambio de mercancía', () => {
  async function preparar(s: Awaited<ReturnType<typeof admin>>) {
    const a = await s.crearProducto(vidrio(15));
    const b = await s.crearProducto(vidrio(16));
    await s.registrarMovimiento({ producto_id: a.id, tipo: 'ENTRADA', cantidad: 10, motivo: 'Compra' });
    await s.registrarMovimiento({ producto_id: b.id, tipo: 'ENTRADA', cantidad: 4, motivo: 'Compra' });
    const stock = async (id: string) => (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.id === id)!.stock_actual;
    return { a, b, stock };
  }

  it('mueve los dos lados juntos, con folio, y no cuenta como venta ni compra', async () => {
    const s = await encargado();
    const { a, b, stock } = await preparar(s);
    const c = await s.crearIntercambio({ contraparte: 'Local Centro', salen: [{ producto_id: a.id, cantidad: 2 }], entran: [{ producto_id: b.id, cantidad: 2 }] });
    expect(c).toMatchObject({ folio: 1, estado: 'COMPLETADO', valor_sale_usd: 10, valor_entra_usd: 10 });
    expect(c.salen[0].unidades).toHaveLength(2);
    expect(c.entran[0].unidades).toHaveLength(2);
    expect(await stock(a.id)).toBe(8);
    expect(await stock(b.id)).toBe(6);
    const movs = (await s.listarMovimientos()).filter((m) => m.motivo?.startsWith('Cambio'));
    expect(movs.map((m) => m.tipo).sort()).toEqual(['TRASLADO_ENTRADA', 'TRASLADO_SALIDA']);
    expect(movs[0].motivo).toBe('Cambio #0001 con Local Centro');
  });

  it('valida: solo Local Vidrios, datos completos y stock; sin dejar nada a medias', async () => {
    const s = await admin();
    const { a, b, stock } = await preparar(s);
    await expect(s.crearIntercambio({ localId: LOCAL_ACCESORIOS_ID, contraparte: 'Local Centro', salen: [{ producto_id: a.id, cantidad: 1 }], entran: [{ producto_id: b.id, cantidad: 1 }] })).rejects.toThrow(/solo se hacen en el Local Vidrios/);
    await expect(s.crearIntercambio({ contraparte: '', salen: [{ producto_id: a.id, cantidad: 1 }], entran: [{ producto_id: b.id, cantidad: 1 }] })).rejects.toThrow(/con quién/);
    await expect(s.crearIntercambio({ contraparte: 'Local Centro', salen: [], entran: [{ producto_id: b.id, cantidad: 1 }] })).rejects.toThrow(/al menos un producto en cada lado/);
    await expect(s.crearIntercambio({ contraparte: 'Local Centro', salen: [{ producto_id: a.id, cantidad: 99 }], entran: [{ producto_id: b.id, cantidad: 1 }] })).rejects.toThrow(/Stock insuficiente/);
    expect(await stock(a.id)).toBe(10);
    expect(await stock(b.id)).toBe(4);
    expect(await s.listarIntercambios()).toEqual([]);
  });

  it('en espera: entrega ahora y recibe al completarlo; revertir devuelve las mismas piezas', async () => {
    const s = await admin();
    const { a, b, stock } = await preparar(s);
    const c = await s.crearIntercambio({ contraparte: 'Local Centro', lado_pendiente: 'ENTRAN', salen: [{ producto_id: a.id, cantidad: 3 }], entran: [{ producto_id: b.id, cantidad: 3 }] });
    expect(c.estado).toBe('EN_ESPERA');
    expect(await stock(a.id)).toBe(7);
    expect(await stock(b.id)).toBe(4);
    const piezas = c.salen[0].unidades!;
    const listo = await s.completarIntercambio(c.id);
    expect(listo).toMatchObject({ estado: 'COMPLETADO', lado_pendiente: null });
    expect(await stock(b.id)).toBe(7);
    await expect(s.completarIntercambio(c.id)).rejects.toThrow(/no está en espera/);

    const r = await s.anularIntercambio(c.id, 'error de registro');
    expect(r).toMatchObject({ estado: 'ANULADO', nota_cierre: 'error de registro' });
    expect(await stock(a.id)).toBe(10);
    expect(await stock(b.id)).toBe(4);
    const devueltas = (await s.listarUnidades({ productoId: a.id, estado: 'DISPONIBLE' })).map((u) => u.codigo);
    for (const p of piezas) expect(devueltas).toContain(p);
    await expect(s.anularIntercambio(c.id)).rejects.toThrow(/ya está anulado/);
  });

  it('el encargado no puede revertir; si falta stock al completar, sigue en espera', async () => {
    const adm = await admin();
    const { a, b } = await preparar(adm);
    const c = await adm.crearIntercambio({ contraparte: 'Local Centro', lado_pendiente: 'SALEN', salen: [{ producto_id: a.id, cantidad: 12 }], entran: [{ producto_id: b.id, cantidad: 1 }] });
    expect(c.estado).toBe('EN_ESPERA');
    await expect(adm.completarIntercambio(c.id)).rejects.toThrow(/Stock insuficiente/);
    expect((await adm.listarIntercambios({ estado: 'EN_ESPERA' })).map((x) => x.id)).toEqual([c.id]);
    const enc = await encargado();
    await expect(enc.anularIntercambio(c.id)).rejects.toThrow(/solo el administrador o el gerente/i);
  });
});
