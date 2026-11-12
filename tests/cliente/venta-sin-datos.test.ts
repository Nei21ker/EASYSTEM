// Cobro rápido (Local Vidrios), modo demo: la venta sin datos del cliente solo se acepta en Vidrios y queda marcada como «sin datos».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACCESORIOS_ID, LOCAL_VIDRIOS_ID } from '../../src/lib/constantes-locales';
import { CLIENTE_SIN_DATOS, clienteVacio, esClienteSinDatos, textoCliente } from '../../src/utils/clienteSinDatos';
import { ETIQUETA_COBRO_RAPIDO } from '../../src/utils/formularioPagos';
import { METODOS_PAGO } from '../../src/utils/pagos';

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

async function vender(s: Awaited<ReturnType<typeof cargarEn>>, cliente: Parameters<typeof s.registrarVenta>[1]['cliente']) {
  const prod = (await s.listarProductos({ catalogoCompleto: true })).find((x) => x.codigo_barras === vidrio.codigo_barras) ?? (await s.crearProducto(vidrio));
  await s.registrarMovimiento({ producto_id: prod.id, tipo: 'ENTRADA', cantidad: 5, motivo: 'Compra' });
  return s.registrarVenta(
    [{ producto_id: prod.id, nombre: prod.nombre, codigo_barras: prod.codigo_barras, cantidad: 1, precio_unitario: 5 }],
    { cliente, pagos: [{ metodo: 'USD_EFECTIVO' as const, monto_usd: 5, monto_bs: null }], tasa_cambio: 40 }
  );
}

describe('ayudas del cliente «sin datos»', () => {
  it('reconoce la venta sin datos y cuándo no se escribió nada', () => {
    expect(esClienteSinDatos({ cliente_cedula: CLIENTE_SIN_DATOS.cedula })).toBe(true);
    expect(esClienteSinDatos({ cliente_cedula: 'V-12345678' })).toBe(false);
    expect(clienteVacio({ cedula: ' ', nombre: '', telefono: '' })).toBe(true);
    expect(clienteVacio({ cedula: '', nombre: 'Ana', telefono: '' })).toBe(false);
    expect(textoCliente({ cliente_nombre: CLIENTE_SIN_DATOS.nombre, cliente_cedula: CLIENTE_SIN_DATOS.cedula })).toBe('Sin datos del cliente');
    expect(textoCliente({ cliente_nombre: 'Ana Pérez', cliente_cedula: 'V-1' })).toBe('Ana Pérez');
  });

  it('cada tipo de cobro tiene su botón de un toque', () => {
    for (const m of METODOS_PAGO) expect(ETIQUETA_COBRO_RAPIDO[m.valor]).toBeTruthy();
  });
});

describe('demo: venta sin datos del cliente', () => {
  it('en el Local Vidrios se registra sin cliente', async () => {
    const s = await cargarEn(LOCAL_VIDRIOS_ID);
    const venta = await vender(s, null);
    expect(esClienteSinDatos(venta)).toBe(true);
    expect(venta.cliente_nombre).toBe(CLIENTE_SIN_DATOS.nombre);
  });

  it('en Vidrios, con datos escritos a medias se rechaza; completos se guardan', async () => {
    const s = await cargarEn(LOCAL_VIDRIOS_ID);
    await expect(vender(s, { cedula: 'V-12345678', nombre: '', apellido: '', telefono: '' })).rejects.toThrow(/datos del cliente/i);
    const venta = await vender(s, { cedula: 'V-12345678', nombre: 'Ana Pérez', apellido: 'Pérez', telefono: '04141234567' });
    expect(esClienteSinDatos(venta)).toBe(false);
  });

  it('en los demás locales el cliente sigue siendo obligatorio', async () => {
    const s = await cargarEn(LOCAL_ACCESORIOS_ID);
    await expect(vender(s, null)).rejects.toThrow(/datos del cliente/i);
  });
});
