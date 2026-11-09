// Modo demo (LocalStorage): directorio de promotores, pendientes (mercancía y comisión) y su relación con las ventas con precio de promotor.
// Mismas reglas que el servidor (tests/server/pendientes-promotores.test.ts).
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

/** Carga el servicio con la sesión de ese usuario y el Local Vidrios como local activo. */
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

const promotor = { cedula: 'V-12345678', nombre: 'Luis', apellido: 'Rojas', telefono: '04141112233', banco: 'Banesco' };
const vidrio = { codigo_barras: '2000000000015', nombre: 'Vidrio blindado Infinix Note 40', categoria: 'Vidrios Templados', precio_venta: 5, control_por_cantidad: 0 };

beforeEach(() => {
  const almacen = almacenSimulado();
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('window', { localStorage: almacen, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('demo: directorio de promotores', () => {
  it('se agrega con banco, la cédula es única y se encuentra por cédula', async () => {
    const s = await encargado();
    const p = await s.crearPromotor(promotor);
    expect(p.banco).toBe('Banesco');
    await expect(s.crearPromotor(promotor)).rejects.toThrow(/Ya hay un promotor/);
    expect((await s.buscarPromotorPorCedula('V-12345678'))?.id).toBe(p.id);
    expect(await s.buscarPromotorPorCedula('V-99999999')).toBeNull();
  });
});

describe('demo: mercancía pendiente', () => {
  it('queda anotada con los datos del promotor y se marca pagada una sola vez', async () => {
    const s = await encargado();
    const p = await s.crearPromotor(promotor);
    await expect(s.crearPendienteMercancia({ promotorId: p.id, descripcion: 'x', monto_usd: 10 })).rejects.toThrow(/Describe qué mercancía/);
    await expect(s.crearPendienteMercancia({ promotorId: p.id, descripcion: '10 vidrios', monto_usd: 0 })).rejects.toThrow(/mayor a 0/);
    const m = await s.crearPendienteMercancia({ promotorId: p.id, descripcion: '10 vidrios blindados', monto_usd: 35 });
    expect(m).toMatchObject({ tipo: 'MERCANCIA', estado: 'PENDIENTE', promotor_banco: 'Banesco', local_id: LOCAL_VIDRIOS_ID });

    const lista = await s.listarPromotores();
    expect(lista.find((x) => x.id === p.id)).toMatchObject({ mercancia_pendiente: 35, comision_pendiente: 0, n_pendientes: 1 });

    const pagado = await s.cerrarPendiente(m.id, 'pagar', 'transferencia 0123');
    expect(pagado.estado).toBe('PAGADO');
    await expect(s.cerrarPendiente(m.id, 'pagar')).rejects.toThrow(/ya está pagado/);
  });
});

describe('demo: comisión por venta con precio de promotor', () => {
  async function ventaConPromotor(s: Awaited<ReturnType<typeof admin>>, datosPromotor: Record<string, string> | null) {
    const prod = (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.codigo_barras === vidrio.codigo_barras) ?? (await s.crearProducto(vidrio));
    await s.registrarMovimiento({ producto_id: prod.id, tipo: 'ENTRADA', cantidad: 5, motivo: 'Compra' });
    const autorizacion = await s.autorizarPrecioVenta({ clave: 'admin123', promotor: datosPromotor as never, lineas: [{ producto_id: prod.id, precio: 8 }] });
    return s.registrarVenta(
      [{ producto_id: prod.id, nombre: prod.nombre, codigo_barras: prod.codigo_barras, cantidad: 2, precio_unitario: 8, precio_lista: 5 }],
      {
        cliente: { cedula: 'V-11111111', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567' },
        pagos: [{ metodo: 'USD_EFECTIVO' as const, monto_usd: 16, monto_bs: null }],
        tasa_cambio: 40,
        precioPromotor: { promotor: datosPromotor as never, autorizacion },
      },
    );
  }

  it('la venta anota la comisión pendiente (cantidad × diferencia) y registra al promotor con su banco', async () => {
    const s = await admin();
    const venta = await ventaConPromotor(s, promotor);
    expect(venta.comision).toBe(6);
    expect(venta.promotor_banco).toBe('Banesco');

    const pendientes = await s.listarPendientes({ tipo: 'COMISION' });
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]).toMatchObject({ estado: 'PENDIENTE', monto_usd: 6, promotor_cedula: 'V-12345678', promotor_banco: 'Banesco' });
    expect((await s.buscarPromotorPorCedula('V-12345678'))?.banco).toBe('Banesco');
  });

  it('sin cédula de promotor también se anota la comisión, sin promotor registrado', async () => {
    const s = await admin();
    await ventaConPromotor(s, null);
    const [c] = await s.listarPendientes({ tipo: 'COMISION' });
    expect(c.monto_usd).toBe(6);
    expect(c.promotor_id).toBeFalsy();
    const p = await s.crearPromotor(promotor);
    const asignado = await s.asignarPromotorAPendiente(c.id, p.id);
    expect(asignado.promotor_cedula).toBe('V-12345678');
  });

  it('eliminar la venta quita su comisión pendiente, pero no la que ya se pagó', async () => {
    const s = await admin();
    const v1 = await ventaConPromotor(s, promotor);
    await s.eliminarVentas([v1.id]);
    expect(await s.listarPendientes({ tipo: 'COMISION' })).toHaveLength(0);

    const v2 = await ventaConPromotor(s, promotor);
    const [c] = await s.listarPendientes({ tipo: 'COMISION' });
    await s.cerrarPendiente(c.id, 'pagar');
    await s.eliminarVentas([v2.id]);
    expect((await s.listarPendientes({ tipo: 'COMISION' })).map((x) => x.estado)).toEqual(['PAGADO']);
  });

  it('instalación: la del local suma al total sin comisión; la del promotor suma al total y a lo que se le debe', async () => {
    const s = await admin();
    const prod = await s.crearProducto(vidrio);
    await s.registrarMovimiento({ producto_id: prod.id, tipo: 'ENTRADA', cantidad: 10, motivo: 'Compra' });
    const linea = (extra: Record<string, unknown>) => ({ producto_id: prod.id, nombre: prod.nombre, codigo_barras: prod.codigo_barras, cantidad: 2, precio_unitario: 5, ...extra });
    const datos = (total: number, extra: Record<string, unknown> = {}) => ({
      cliente: { cedula: 'V-11111111', nombre: 'Ana', apellido: 'Pérez', telefono: '04141234567' },
      pagos: [{ metodo: 'USD_EFECTIVO' as const, monto_usd: total, monto_bs: null }],
      tasa_cambio: 40,
      ...extra,
    });

    // La instala el local: 2 × ($5 + $3) = $16, sin pendiente
    const v1 = await s.registrarVenta([linea({ instalacion_por: 'LOCAL', instalacion_usd: 3 })], datos(16));
    expect(v1.total).toBe(16);
    expect(await s.listarPendientes({ tipo: 'COMISION' })).toHaveLength(0);
    await expect(s.registrarVenta([linea({ instalacion_por: 'LOCAL', instalacion_usd: 3 })], datos(10))).rejects.toThrow(/deben coincidir/);

    // La instala el promotor: el cliente paga $16 y se le deben $6 (2 × $3)
    const v2 = await s.registrarVenta([linea({ instalacion_por: 'PROMOTOR', instalacion_usd: 3 })], datos(16, { promotorInstalacion: promotor }));
    expect(v2.total).toBe(16);
    expect(v2.comision).toBe(6);
    const [c] = await s.listarPendientes({ tipo: 'COMISION' });
    expect(c).toMatchObject({ monto_usd: 6, promotor_cedula: 'V-12345678', promotor_banco: 'Banesco' });
    expect(c.descripcion).toMatch(/Instalación hecha por el promotor/);
  });

  it('el encargado no puede pagar ni anular una comisión', async () => {
    const a = await admin();
    await ventaConPromotor(a, promotor);
    const [c] = await a.listarPendientes({ tipo: 'COMISION' });
    const e = await cargarComo('encargado@edwardaccesorios.com', 'encargado123');
    await expect(e.cerrarPendiente(c.id, 'pagar')).rejects.toThrow(/Las comisiones las paga/);
    await expect(e.cerrarPendiente(c.id, 'anular')).rejects.toThrow(/Las comisiones las paga/);
  });
});
