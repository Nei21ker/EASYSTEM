import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registrarMovimientosLote, registrarMovimiento } from '../../src/lib/db/movimientos';
import { reemplazarCompatibilidadesLote, crearProductosLote, asegurarEnLocal } from '../../src/lib/db/productos';
import { listarUnidades } from '../../src/lib/db/unidades';
import { guardarPagoIndependiente, subirComprobante } from '../../src/lib/db/nomina';
import { subirFoto } from '../../src/lib/db/cuadres';
import { actualizarOrden } from '../../src/lib/db/ordenes';

interface Llamada { url: string; metodo: string; cuerpo: any }
let llamadas: Llamada[];

beforeEach(() => {
  llamadas = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const crudo = init?.body;
    llamadas.push({ url, metodo: init?.method ?? 'GET', cuerpo: typeof crudo === 'string' ? JSON.parse(crudo) : crudo });
    const respuesta = url.includes('/movimientos/lote') ? [] : url.includes('/productos/lote') ? [] : url.includes('/unidades') ? [] : url.includes('/archivos/privado/') ? { ruta: decodeURI(url.replace('/api/archivos/privado/', '')) } : { id: 'x', movimiento: { id: 'm' }, unidadCodigos: ['2100000000012'] };
    return new Response(JSON.stringify(respuesta), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const mov = (cantidad: number, n = 0) => ({ producto_id: `p${n}`, tipo: 'ENTRADA' as const, cantidad, local_id: 'L1', motivo: 'Ajuste' });

describe('registrarMovimientosLote respeta los topes del servidor (50 movimientos y 500 unidades por lote)', () => {
  it('120 movimientos de 1 unidad van en 3 lotes (50, 50, 20)', async () => {
    await registrarMovimientosLote(Array.from({ length: 120 }, (_, i) => mov(1, i)));
    expect(llamadas.map((l) => l.cuerpo.movimientos.length)).toEqual([50, 50, 20]);
    expect(llamadas.every((l) => l.url === '/api/movimientos/lote')).toBe(true);
  });

  it('un movimiento de 1200 unidades se parte en 500 + 500 + 200 sin perder ni inventar unidades', async () => {
    await registrarMovimientosLote([mov(1200)]);
    const cantidades = llamadas.flatMap((l) => l.cuerpo.movimientos.map((m: any) => m.cantidad));
    expect(cantidades).toEqual([500, 500, 200]);
    expect(llamadas).toHaveLength(3); // cada trozo de 500 llena su lote
  });

  it('el lote se corta cuando las unidades pasarían de 500, y la suma total se conserva', async () => {
    await registrarMovimientosLote([mov(300, 1), mov(300, 2), mov(100, 3)]);
    const lotes = llamadas.map((l) => l.cuerpo.movimientos.map((m: any) => m.cantidad));
    expect(lotes).toEqual([[300], [300, 100]]);
  });

  it('manda los campos en el formato del servidor (camelCase) y no envía nada si no hay movimientos', async () => {
    await registrarMovimientosLote([]);
    expect(llamadas).toHaveLength(0);
    await registrarMovimientosLote([mov(2)]);
    expect(llamadas[0].cuerpo.movimientos[0]).toEqual({ productoId: 'p0', tipo: 'ENTRADA', cantidad: 2, localId: 'L1', motivo: 'Ajuste' });
  });
});

describe('registrarMovimiento', () => {
  it('devuelve el movimiento con TODOS los códigos de unidad que movió', async () => {
    const m = await registrarMovimiento({ producto_id: 'p1', tipo: 'SALIDA', cantidad: 1, local_id: 'L1', motivo: 'Venta POS', unidad_codigos: ['2100000000012'] });
    expect(m).toMatchObject({ id: 'm', unidad_codigos: ['2100000000012'] });
    expect(llamadas[0].cuerpo).toMatchObject({ productoId: 'p1', localId: 'L1', unidadCodigos: ['2100000000012'] });
  });
});

describe('productos', () => {
  it('crearProductosLote envía de 100 en 100', async () => {
    await crearProductosLote(Array.from({ length: 250 }, (_, i) => ({ codigo_barras: String(i), nombre: `P${i}`, categoria: 'C' })));
    expect(llamadas.map((l) => l.cuerpo.filas.length)).toEqual([100, 100, 50]);
  });

  it('asegurarEnLocal envía de 200 en 200 al local indicado', async () => {
    await asegurarEnLocal('L1', Array.from({ length: 450 }, (_, i) => `p${i}`));
    expect(llamadas.map((l) => l.cuerpo.productoIds.length)).toEqual([200, 200, 50]);
    expect(llamadas[0].url).toBe('/api/locales/L1/inventario/alta');
  });

  it('las compatibilidades se reemplazan por tandas de 100 productos y 500 pares; solo la primera petición de cada tanda borra', async () => {
    const productoIds = Array.from({ length: 120 }, (_, i) => `p${i}`);
    const pares = productoIds.flatMap((p) => [{ producto_id: p, modelo_id: 'm1' }, { producto_id: p, modelo_id: 'm2' }, { producto_id: p, modelo_id: 'm3' }]);
    await reemplazarCompatibilidadesLote(pares, productoIds);
    // Tanda 1: 100 productos × 3 pares = 300 → una petición; tanda 2: 20 × 3 = 60 → una petición
    expect(llamadas.map((l) => [l.cuerpo.productoIds.length, l.cuerpo.pares.length])).toEqual([[100, 300], [20, 60]]);

    llamadas.length = 0;
    const muchos = Array.from({ length: 1100 }, (_, i) => ({ producto_id: 'p0', modelo_id: `m${i}` }));
    await reemplazarCompatibilidadesLote(muchos, ['p0']);
    expect(llamadas.map((l) => [l.cuerpo.productoIds.length, l.cuerpo.pares.length])).toEqual([[1, 500], [0, 500], [0, 100]]);
  });

  it('un producto sin compatibilidades igual se limpia (envía su id sin pares)', async () => {
    await reemplazarCompatibilidadesLote([], ['p0']);
    expect(llamadas.map((l) => [l.cuerpo.productoIds, l.cuerpo.pares])).toEqual([[['p0'], []]]);
  });
});

describe('unidades', () => {
  it('pide los códigos de 90 en 90 y manda el filtro como parámetros', async () => {
    const codigos = Array.from({ length: 200 }, (_, i) => `21${String(i).padStart(11, '0')}`);
    await listarUnidades({ codigos, estado: 'DISPONIBLE', localId: 'L1' });
    expect(llamadas).toHaveLength(3);
    const q = new URL(llamadas[0].url, 'http://x').searchParams;
    expect(q.get('codigos')!.split(',')).toHaveLength(90);
    expect(q.get('estado')).toBe('DISPONIBLE');
    expect(q.get('localId')).toBe('L1');
  });

  it('sin códigos hace una sola consulta; sinImprimir se manda como 1', async () => {
    await listarUnidades({ productoId: 'p1', sinImprimir: true });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe('/api/unidades?productoId=p1&sinImprimir=1');
  });
});

describe('archivos privados y nómina', () => {
  it('el comprobante de nómina se sube a comprobantes-nomina/<local>/… y devuelve esa ruta', async () => {
    const ruta = await subirComprobante('L1', 'E1', '2026-10-01', new Blob([new Uint8Array([1])], { type: 'image/jpeg' }));
    expect(ruta).toMatch(/^comprobantes-nomina\/L1\/E1-2026-10-01-\d+\.jpg$/);
    expect(llamadas[0].metodo).toBe('PUT');
  });

  it('la foto del cuadre usa la ruta cuadres-caja/<local>/<día>/<TIPO>-<hora>-<n>.jpg', async () => {
    const ruta = await subirFoto('L1', '2026-10-20', 'PAGO_MOVIL', new Blob([new Uint8Array([1])], { type: 'image/jpeg' }));
    expect(ruta).toMatch(/^cuadres-caja\/L1\/2026-10-20\/PAGO_MOVIL-\d+-\d+\.jpg$/);
  });

  it('guardarPagoIndependiente manda la ruta de la captura como comprobantePath y devuelve el id', async () => {
    const id = await guardarPagoIndependiente({
      empleadoId: 'E1', dia: '2026-10-20', lineas: [], bonos: 0, deducciones: 0, notas: null, comprobante: 'comprobantes-nomina/L1/x.jpg', quitarComprobante: false, pagar: false,
    });
    expect(id).toBe('x');
    expect(llamadas[0].cuerpo).toMatchObject({ empleadoId: 'E1', comprobantePath: 'comprobantes-nomina/L1/x.jpg', pagar: false });
    expect(llamadas[0].cuerpo).not.toHaveProperty('comprobante');
  });
});

describe('órdenes', () => {
  it('al actualizar solo se envían los campos editables (el total lo calcula el servidor)', async () => {
    await actualizarOrden('o1', { estado: 'listo', total_usd: 999, folio: 7, diagnostico: 'Pantalla' } as never);
    expect(llamadas[0].metodo).toBe('PATCH');
    expect(Object.keys(llamadas[0].cuerpo).filter((k) => llamadas[0].cuerpo[k] !== undefined).sort()).toEqual(['diagnostico', 'estado']);
  });
});
