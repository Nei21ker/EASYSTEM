// Modo demo (LocalStorage): productos "por cantidad" (vidrios sencillos de menos de $3), piezas defectuosas en una venta y bajas por
// cantidad. Mismas reglas que el servidor (tests/server/control-por-cantidad.test.ts).
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

/** Carga el servicio con una sesión de ese usuario y el Local Vidrios como local activo (el del encargado demo). */
async function cargarComo(email: string, clave: string) {
  vi.resetModules();
  vi.stubEnv('PUBLIC_USAR_API', 'false');
  localStorage.setItem('easystem:local-activo', LOCAL_VIDRIOS_ID);
  const auth = await import('../../src/lib/auth');
  await auth.iniciarSesion(email, clave);
  return import('../../src/lib/inventoryService');
}

const admin = () => cargarComo('admin@edwardaccesorios.com', 'admin123');
const encargado = () => cargarComo('encargado@edwardaccesorios.com', 'encargado123');

const vidrio = { codigo_barras: '2000000000015', nombre: 'Vidrio sencillo Infinix Note 40', categoria: 'Vidrios Templados', precio_venta: 1, control_por_cantidad: 1 };
const datosVenta = (total: number) => ({
  cliente: { cedula: 'V-12345678', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567' },
  pagos: [{ metodo: 'USD_EFECTIVO' as const, monto_usd: total, monto_bs: null }],
  tasa_cambio: 40,
});
const itemVenta = (p: { id: string; nombre: string; codigo_barras: string }, cantidad: number, extra: Record<string, unknown> = {}) => ({
  producto_id: p.id,
  nombre: p.nombre,
  codigo_barras: p.codigo_barras,
  cantidad,
  precio_unitario: 1,
  ...extra,
});

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('demo: producto por cantidad', () => {
  it('solo se crea por cantidad si cuesta menos de $3', async () => {
    const s = await admin();
    await expect(s.crearProducto({ ...vidrio, precio_venta: 3 })).rejects.toThrow(/menos de \$3/);
    const p = await s.crearProducto(vidrio);
    expect(p.control_por_cantidad).toBe(1);
  });

  it('el ingreso y la venta no crean ni marcan piezas con código; la venta guarda el id del movimiento', async () => {
    const s = await admin();
    const p = await s.crearProducto(vidrio);
    const mov = await s.registrarMovimiento({ producto_id: p.id, tipo: 'ENTRADA', cantidad: 20, motivo: 'Compra' });
    expect(mov.unidad_codigos).toEqual([]);
    await expect(s.registrarMovimiento({ producto_id: p.id, tipo: 'ENTRADA', cantidad: 1, unidad_codigos: ['VID000001'] })).rejects.toThrow(/por cantidad/);
    expect(await s.listarUnidades({ productoId: p.id })).toHaveLength(0);

    const venta = await s.registrarVenta([itemVenta(p, 2)], datosVenta(2));
    expect(venta.items[0].unidades).toBeUndefined();
    expect(venta.items[0].movimiento_id).toBeTruthy();
    const despues = (await s.listarProductos()).find((x) => x.id === p.id)!;
    expect(despues.stock_actual).toBe(18);
  });

  it('con piezas defectuosas: se cobra solo lo que sirvió y la baja sale del stock junto con la venta', async () => {
    const s = await admin();
    const p = await s.crearProducto(vidrio);
    await s.registrarMovimiento({ producto_id: p.id, tipo: 'ENTRADA', cantidad: 10 });
    const venta = await s.registrarVenta([itemVenta(p, 1, { danados: 2, danados_motivo: 'DEFECTO_FABRICA', danados_nota: 'caja rota' })], datosVenta(1));
    expect(venta.total).toBe(1);
    expect(venta.items[0].danados).toBe(2);
    expect(venta.items[0].danados_nota).toBeUndefined(); // la nota no se guarda en la venta
    expect(venta.items[0].movimiento_baja_id).toBeTruthy();
    expect((await s.listarProductos()).find((x) => x.id === p.id)!.stock_actual).toBe(7);
    const mermas = await s.listarMermas();
    expect(mermas).toHaveLength(1);
    expect(mermas[0]).toMatchObject({ cantidad: 2, origen: 'VENTA', motivo: 'DEFECTO_FABRICA', nota: 'caja rota' });
  });

  it('con 3 o más defectuosas hace falta la clave de un gerente o administrador (no la de un encargado ni una mala)', async () => {
    const s = await encargado();
    const p = await s.crearProducto(vidrio);
    await s.registrarMovimiento({ producto_id: p.id, tipo: 'ENTRADA', cantidad: 20 });
    const items = [itemVenta(p, 1, { danados: 3 })];
    await expect(s.registrarVenta(items, datosVenta(1))).rejects.toThrow(/necesita la clave/);
    await expect(s.autorizarDanados({ clave: 'encargado123', cantidad: 3 })).rejects.toThrow(/gerente o un administrador/);
    await expect(s.autorizarDanados({ clave: 'mala', cantidad: 3 })).rejects.toThrow(/Contraseña incorrecta/);
    const aut = await s.autorizarDanados({ clave: 'gerente123', cantidad: 3 });
    // La autorización cubre 3: con 4 en la venta ya no vale
    await expect(s.registrarVenta([itemVenta(p, 1, { danados: 4 })], { ...datosVenta(1), autorizacionDanados: aut })).rejects.toThrow(/no es válida/);
    const venta = await s.registrarVenta(items, { ...datosVenta(1), autorizacionDanados: aut });
    expect(venta.items[0].danados).toBe(3);
    expect((await s.listarMermas())[0].autorizado_nombre).toBe(aut.autorizado_por);
    expect((await s.listarProductos()).find((x) => x.id === p.id)!.stock_actual).toBe(16);
  });

  it('un vendedor no puede marcar piezas defectuosas', async () => {
    const s = await cargarComo('vendedor@edwardaccesorios.com', 'vendedor123');
    await expect(s.registrarVenta([{ producto_id: 'x', nombre: 'x', codigo_barras: '1', cantidad: 1, precio_unitario: 1, danados: 1 }], datosVenta(1))).rejects.toThrow(/Solo el encargado, el gerente o el administrador/);
  });

  it('bajas por cantidad (Descargo): salen del stock, quedan registradas y no pasan del stock', async () => {
    const s = await encargado();
    const p = await s.crearProducto(vidrio);
    await s.registrarMovimiento({ producto_id: p.id, tipo: 'ENTRADA', cantidad: 5 });
    await s.darDeBajaPorCantidad({ productoId: p.id, localId: LOCAL_VIDRIOS_ID, cantidad: 2, motivo: 'OTRO', nota: 'se cayó la caja' });
    await expect(s.darDeBajaPorCantidad({ productoId: p.id, localId: LOCAL_VIDRIOS_ID, cantidad: 9 })).rejects.toThrow(/Stock insuficiente/);
    expect((await s.listarProductos()).find((x) => x.id === p.id)!.stock_actual).toBe(3);
    expect(await s.listarMermas()).toEqual([expect.objectContaining({ cantidad: 2, origen: 'DESCARGO', nota: 'se cayó la caja' })]);
  });

  it('cambiar entre por cantidad y con etiqueta solo con el stock en 0', async () => {
    const s = await admin();
    const p = await s.crearProducto(vidrio);
    await s.registrarMovimiento({ producto_id: p.id, tipo: 'ENTRADA', cantidad: 4 });
    await expect(s.actualizarProducto(p.id, { control_por_cantidad: 0 })).rejects.toThrow(/stock en 0/);
    await s.registrarMovimiento({ producto_id: p.id, tipo: 'SALIDA', cantidad: 4 });
    expect((await s.actualizarProducto(p.id, { control_por_cantidad: 0 })).control_por_cantidad).toBe(0);
  });

  it('eliminar una venta devuelve al stock lo cobrado y lo botado, y borra sus movimientos y mermas', async () => {
    const s = await admin();
    const p = await s.crearProducto(vidrio);
    await s.registrarMovimiento({ producto_id: p.id, tipo: 'ENTRADA', cantidad: 10 });
    const venta = await s.registrarVenta([itemVenta(p, 2, { danados: 1 })], datosVenta(2));
    expect((await s.listarProductos()).find((x) => x.id === p.id)!.stock_actual).toBe(7);
    const simulado = await s.eliminarVentas([venta.id], { simular: true });
    expect(simulado.piezas).toBe(3);
    await s.eliminarVentas([venta.id]);
    expect((await s.listarProductos()).find((x) => x.id === p.id)!.stock_actual).toBe(10);
    expect(await s.listarMermas()).toHaveLength(0);
    expect((await s.listarMovimientos()).filter((m) => m.producto_id === p.id && (m.tipo === 'SALIDA' || m.tipo === 'BAJA'))).toHaveLength(0);
  });
});
