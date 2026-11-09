// Instalación de vidrios en el Local Vidrios: se cobra por unidad junto con el producto. «La instala el local» es ingreso de la tienda;
// «la instala el promotor» es dinero que la tienda le entrega al promotor y se suma a lo que se le debe (comisión + instalación).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { autorizarPrecio } from '../../src/server/servicios/autorizaciones';
import { listarPendientes } from '../../src/server/servicios/pendientes';
import { guardarVenta } from '../../src/server/servicios/ventas';
import type { NuevaVenta, VentaItem } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { vidrios } = IDS_LOCALES;

let uEncargado: UsuarioDePrueba, uVendedor: UsuarioDePrueba;
let encargado: Sesion, vendedor: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

const PRODUCTO = 'p-vidrio';
const PROMOTOR = { cedula: 'V-11111111', nombre: 'Pedro', apellido: 'Promotor', telefono: '0414-1234567', banco: 'Banesco' };

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  uEncargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Vidrios', clave: 'Clave-encargado-vidrios-123' });
  uVendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios, nombre: 'Vera Vendedora', clave: 'Clave-vendedor-vidrios-123' });
  [encargado, vendedor] = await Promise.all([uEncargado, uVendedor].map(sesionDe));
  await env.DB
    .prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES (?, '2000000000015', 'Vidrio blindado A15', 'Vidrios Templados', 2, 7, 0)")
    .bind(PRODUCTO)
    .run();
});

async function rechazo(promesa: Promise<unknown>, status: number, texto?: string | RegExp): Promise<void> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (texto) expect((err as ErrorApi).message).toMatch(texto);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const linea = (extra: Partial<VentaItem> = {}): VentaItem => ({ producto_id: PRODUCTO, nombre: 'Vidrio blindado A15', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 7, ...extra });
const venta = (total: number, items: VentaItem[], extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: vidrios,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'Ana Pérez',
  cliente_telefono: '0414-1234567',
  metodo_pago: 'USD_EFECTIVO',
  pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: total, monto_bs: null }],
  vuelto: null,
  total,
  items,
  tasa_cambio: 36.5,
  total_bs: null,
  ...extra,
});

describe('instalación hecha por el local', () => {
  it('queda en la línea, no genera comisión ni pendiente', async () => {
    const v = await guardarVenta(env, vendedor, venta(10, [linea({ instalacion_por: 'LOCAL', instalacion_usd: 3 })]));
    expect(v.items[0]).toMatchObject({ instalacion_por: 'LOCAL', instalacion_usd: 3 });
    expect(v.comision).toBe(0);
    expect(await listarPendientes(env, encargado)).toHaveLength(0);
  });
});

describe('instalación hecha por el promotor', () => {
  it('sin precio de promotor: anota $3 por pagar al promotor y lo deja en el directorio con su banco', async () => {
    const v = await guardarVenta(env, vendedor, venta(10, [linea({ instalacion_por: 'PROMOTOR', instalacion_usd: 3 })], { promotor: PROMOTOR }));
    expect(v.comision).toBe(3);
    expect(v.promotor_cedula).toBe('V-11111111');
    const [p] = await listarPendientes(env, encargado);
    expect(p).toMatchObject({ tipo: 'COMISION', estado: 'PENDIENTE', monto_usd: 3, promotor_cedula: 'V-11111111', promotor_banco: 'Banesco', venta_id: v.id });
    expect(p.descripcion).toMatch(/Instalación hecha por el promotor/);
    expect(p.descripcion).not.toMatch(/precio de promotor/);
  });

  it('con precio de promotor: el pendiente suma la comisión del precio ($3) y la instalación ($3) = $6, con las dos explicaciones', async () => {
    const aut = await autorizarPrecio(env, vendedor, { email: uEncargado.email, clave: uEncargado.clave, local_id: vidrios, promotor: PROMOTOR, lineas: [{ producto_id: PRODUCTO, precio: 10 }] });
    const v = await guardarVenta(env, vendedor, venta(13, [linea({ precio_unitario: 10, instalacion_por: 'PROMOTOR', instalacion_usd: 3 })], { promotor: PROMOTOR, autorizacion_precio: aut.token }));
    expect(v.comision).toBe(6);
    const pendientes = await listarPendientes(env, encargado);
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].monto_usd).toBe(6);
    expect(pendientes[0].descripcion).toMatch(/precio de promotor/);
    expect(pendientes[0].descripcion).toMatch(/Instalación hecha por el promotor/);
  });

  it('cuenta por unidad: 2 vidrios con instalación de $4 son $8 para el promotor', async () => {
    const v = await guardarVenta(env, vendedor, venta(22, [linea({ cantidad: 2, instalacion_por: 'PROMOTOR', instalacion_usd: 4 })], { promotor: PROMOTOR }));
    expect(v.comision).toBe(8);
  });

  it('con precio del local (sin promotor) la instalación del promotor usa los datos anotados', async () => {
    const aut = await autorizarPrecio(env, vendedor, { email: uEncargado.email, clave: uEncargado.clave, local_id: vidrios, modo: 'local', lineas: [{ producto_id: PRODUCTO, precio: 8 }] });
    const v = await guardarVenta(env, vendedor, venta(11, [linea({ precio_unitario: 8, instalacion_por: 'PROMOTOR', instalacion_usd: 3 })], { promotor: PROMOTOR, autorizacion_precio: aut.token }));
    expect(v.comision).toBe(3);
    expect((await listarPendientes(env, encargado))[0]).toMatchObject({ monto_usd: 3, promotor_cedula: 'V-11111111' });
  });

  it('sin datos del promotor igual se anota (sin promotor registrado) para asignarlo después', async () => {
    await guardarVenta(env, vendedor, venta(10, [linea({ instalacion_por: 'PROMOTOR', instalacion_usd: 3 })]));
    const [p] = await listarPendientes(env, encargado);
    expect(p).toMatchObject({ monto_usd: 3, promotor_id: null });
  });

  it('una cédula mal escrita se rechaza', async () => {
    await rechazo(guardarVenta(env, vendedor, venta(10, [linea({ instalacion_por: 'PROMOTOR', instalacion_usd: 3 })], { promotor: { ...PROMOTOR, cedula: 'abc' } })), 400, /cédula/i);
  });
});

describe('datos de la instalación', () => {
  it('un precio inválido o un tipo desconocido no se guardan en la venta', async () => {
    const v = await guardarVenta(env, vendedor, venta(7, [linea({ instalacion_por: 'LOCAL', instalacion_usd: 0 })]));
    expect(v.items[0].instalacion_por).toBeUndefined();
    expect(v.items[0].instalacion_usd).toBeUndefined();
  });
});
