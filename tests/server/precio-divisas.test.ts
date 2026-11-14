// Precio en divisas: el cliente paga TODO en dólares en efectivo (o Binance) y por eso el precio baja (p. ej. un control de $12 sale en $10);
// de esa rebaja, una parte fija por unidad (p. ej. $1) es del promotor. Sin contraseña (lo anota quien vende), solo con pagos en divisas,
// solo precios MENORES al catálogo, y la comisión sale de la autorización firmada, nunca de lo que mande el cliente.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { autorizarPrecio, firmarAutorizacion, promotorValido } from '../../src/server/servicios/autorizaciones';
import { guardarVenta, listarVentas } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let vendedor: UsuarioDePrueba, otroVendedor: UsuarioDePrueba, admin: UsuarioDePrueba, vendedorVid: UsuarioDePrueba;
let sV: Sesion, sV2: Sesion, sA: Sesion, sVid: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

const PRODUCTO = 'p-control';
const PROMOTOR = { cedula: 'V-11111111', nombre: 'Pedro', apellido: 'Promotor', telefono: '0414-1234567' };

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null, nombre: 'Ada Admin', clave: 'Clave-administrador-null-123' });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Vera Vendedora', clave: 'Clave-vendedor-accesorios-123' });
  otroVendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Otto Vendedor', clave: 'Clave-vendedor-accesorios-123' });
  vendedorVid = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios, nombre: 'Vico Vidrios', clave: 'Clave-vendedor-vidrios-123' });
  [sV, sV2, sA, sVid] = await Promise.all([vendedor, otroVendedor, admin, vendedorVid].map(sesionDe));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES (?, '2000000000015', 'Control A/C Samsung', 'Controles', 8, 12, 0)").bind(PRODUCTO),
    env.DB.prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES ('p-otro', '2000000000022', 'Control Roku', 'Controles', 9, 10, 0)"),
  ]);
});

async function rechazo(promesa: Promise<unknown>, status: number, texto?: string | RegExp): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (texto) expect((err as ErrorApi).message).toMatch(texto);
    return err as ErrorApi;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const pedidoDivisas = (extra: Record<string, unknown> = {}) => ({
  local_id: accesorios,
  modo: 'divisas' as const,
  promotor: PROMOTOR,
  lineas: [{ producto_id: PRODUCTO, precio: 10, comision: 1 }],
  ...extra,
});

const venta = (extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: accesorios,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'Ana Pérez',
  cliente_telefono: '0414-1234567',
  metodo_pago: 'USD_EFECTIVO',
  pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 20, monto_bs: null }],
  vuelto: null,
  total: 20,
  items: [{ producto_id: PRODUCTO, nombre: 'Control A/C Samsung', codigo_barras: '2000000000015', cantidad: 2, precio_unitario: 10 }],
  tasa_cambio: 36.5,
  total_bs: null,
  ...extra,
});

describe('autorizarPrecio en modo divisas', () => {
  it('quien vende lo anota solo, sin contraseña: sale una autorización de modo divisas a su nombre', async () => {
    const r = await autorizarPrecio(env, sV, pedidoDivisas());
    expect(r).toMatchObject({ modo: 'divisas', autorizado_por: '', promotor: 'Pedro Promotor' });
    expect(r.token).toMatch(/\./);
  });

  it('el precio debe ser MENOR al del catálogo (igual o mayor, 400)', async () => {
    await rechazo(autorizarPrecio(env, sV, pedidoDivisas({ lineas: [{ producto_id: PRODUCTO, precio: 12, comision: 1 }] })), 400, /menor al del catálogo/i);
    await rechazo(autorizarPrecio(env, sV, pedidoDivisas({ lineas: [{ producto_id: PRODUCTO, precio: 15, comision: 1 }] })), 400, /menor al del catálogo/i);
  });

  it('la comisión por unidad es obligatoria, positiva y no puede pasar del precio cobrado', async () => {
    await rechazo(autorizarPrecio(env, sV, pedidoDivisas({ lineas: [{ producto_id: PRODUCTO, precio: 10 }] })), 400, /cuánto se le da al promotor/i);
    await rechazo(autorizarPrecio(env, sV, pedidoDivisas({ lineas: [{ producto_id: PRODUCTO, precio: 10, comision: 0 }] })), 400, /cuánto se le da al promotor/i);
    await rechazo(autorizarPrecio(env, sV, pedidoDivisas({ lineas: [{ producto_id: PRODUCTO, precio: 10, comision: -1 }] })), 400, /cuánto se le da al promotor/i);
    await rechazo(autorizarPrecio(env, sV, pedidoDivisas({ lineas: [{ producto_id: PRODUCTO, precio: 10, comision: 11 }] })), 400, /no puede ser mayor/i);
  });

  it('en otros modos la comisión que se envíe no cuenta: el precio de promotor sigue calculándola de la diferencia', async () => {
    const { token } = await autorizarPrecio(env, sV, { local_id: accesorios, promotor: PROMOTOR, lineas: [{ producto_id: PRODUCTO, precio: 15, comision: 99 }] });
    const v = await guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: token, total: 15, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 15, monto_bs: null }], items: [{ producto_id: PRODUCTO, nombre: 'x', codigo_barras: 'y', cantidad: 1, precio_unitario: 15 }] }));
    expect(v.comision).toBe(3);
    expect(v.items[0].precio_tipo).toBeUndefined();
  });

  it('no sirve en un local al que quien vende no tiene acceso', async () => {
    await rechazo(autorizarPrecio(env, sV, pedidoDivisas({ local_id: vidrios })), 403);
  });
});

describe('venta con precio en divisas', () => {
  it('se guarda con el precio rebajado, la comisión (cantidad × comisión por unidad), el promotor, SIN supervisor, y la comisión queda en Pendientes', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoDivisas());
    const v = await guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: token }));
    expect(v).toMatchObject({ total: 20, comision: 2, promotor_nombre: 'Pedro Promotor', promotor_cedula: 'V-11111111', precio_autorizado_por: null, precio_autorizado_nombre: null });
    expect(v.items[0]).toMatchObject({ precio_unitario: 10, precio_lista: 12, precio_tipo: 'divisas', comision_unidad: 1 });
    const pendiente = await env.DB.prepare('SELECT tipo, monto_usd, descripcion FROM pendientes WHERE venta_id = ?').bind(v.id).first<{ tipo: string; monto_usd: number; descripcion: string }>();
    expect(pendiente).toMatchObject({ tipo: 'COMISION', monto_usd: 2 });
    expect(pendiente!.descripcion).toMatch(/en divisas con descuento/);
    expect(pendiente!.descripcion).toMatch(/\$1 al promotor por unidad/);
  });

  it('la comisión sale de la autorización firmada, no de lo que mande el cliente en la línea', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoDivisas());
    const item = { ...venta().items[0], comision_unidad: 99, precio_tipo: 'local' as const };
    const v = await guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: token, items: [item] }));
    expect(v.comision).toBe(2);
    expect(v.items[0]).toMatchObject({ precio_tipo: 'divisas', comision_unidad: 1 });
  });

  it('acepta pagar con Binance y con varias formas de pago, siempre que ninguna sea en bolívares', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoDivisas());
    const v = await guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: token, metodo_pago: 'MIXTO', pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 12, monto_bs: null }, { metodo: 'BINANCE_USDT', monto_usd: 8, monto_bs: null }] }));
    expect(v.comision).toBe(2);
  });

  it('un pago en bolívares (aunque sea una parte) lo rechaza con 400 y no guarda nada', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoDivisas());
    for (const pagos of [
      [{ metodo: 'BS_PUNTO_VENTA' as const, monto_usd: 20, monto_bs: 730 }],
      [{ metodo: 'USD_EFECTIVO' as const, monto_usd: 10, monto_bs: null }, { metodo: 'BS_PAGO_MOVIL' as const, monto_usd: 10, monto_bs: 365 }],
    ]) {
      const e = await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: token, metodo_pago: 'MIXTO', pagos, referencia_pago_movil: '1234' })), 400, /solo vale si se paga todo en dólares/i);
      expect(e.codigo).toBe('pago_no_divisas');
    }
    expect(await listarVentas(env, sA, {})).toHaveLength(0);
  });

  it('sin autorización, el precio rebajado se sigue rechazando; con la de otro vendedor, también', async () => {
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR })), 400, /no está autorizado/i);
    const { token } = await autorizarPrecio(env, sV, pedidoDivisas());
    await rechazo(guardarVenta(env, sV2, venta({ promotor: PROMOTOR, autorizacion_precio: token })), 400, /autoriz/i);
  });

  it('no sirve para otro precio ni otro promotor', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoDivisas());
    const otro = { ...venta().items[0], precio_unitario: 9 };
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: token, total: 18, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 18, monto_bs: null }], items: [otro] })), 400, /no coincide|autoriz/i);
    await rechazo(guardarVenta(env, sV, venta({ promotor: { ...PROMOTOR, cedula: 'V-22222222' }, autorizacion_precio: token })), 400, /otra venta|promotor/i);
  });

  it('un token de divisas forjado para un precio MAYOR al del catálogo nunca vale', async () => {
    const forjado = await firmarAutorizacion(env, { v: 1, u: sV.userId, a: sV.userId, an: 'Vera', s: 1, m: 'divisas', l: accesorios, p: promotorValido(PROMOTOR).clave, pn: 'Pedro Promotor', ln: [[PRODUCTO, 15, 1]], exp: Date.now() + 60_000 });
    const caro = { ...venta().items[0], precio_unitario: 15 };
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: forjado, total: 30, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 30, monto_bs: null }], items: [caro] })), 400, /solo puede ser menor/i);
    expect(await listarVentas(env, sA, {})).toHaveLength(0);
  });

  it('un token de divisas SIN comisión en alguna línea (forjado) tampoco vale', async () => {
    const forjado = await firmarAutorizacion(env, { v: 1, u: sV.userId, a: sV.userId, an: 'Vera', s: 1, m: 'divisas', l: accesorios, p: promotorValido(PROMOTOR).clave, pn: 'Pedro Promotor', ln: [[PRODUCTO, 10]], exp: Date.now() + 60_000 });
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: forjado })), 400, /no es válida/i);
  });

  it('un token SIN contraseña de otro modo con un precio menor sigue rechazándose (el descuento normal sí pide contraseña)', async () => {
    const forjado = await firmarAutorizacion(env, { v: 1, u: sV.userId, a: sV.userId, an: 'Vera', s: 1, l: accesorios, p: promotorValido(PROMOTOR).clave, pn: 'Pedro Promotor', ln: [[PRODUCTO, 10]], exp: Date.now() + 60_000 });
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: forjado })), 400, /necesita la contraseña/i);
  });

  it('funciona igual en cualquier local (Local Vidrios)', async () => {
    const { token } = await autorizarPrecio(env, sVid, pedidoDivisas({ local_id: vidrios }));
    const v = await guardarVenta(env, sVid, venta({ local_id: vidrios, promotor: PROMOTOR, autorizacion_precio: token, items: [{ ...venta().items[0] }] }));
    expect(v.comision).toBe(2);
    expect(v.local_id).toBe(vidrios);
  });

  it('una línea sin cambiar de precio en la misma venta se cobra normal y no suma comisión', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoDivisas());
    const v = await guardarVenta(env, sV, venta({
      promotor: PROMOTOR,
      autorizacion_precio: token,
      total: 30,
      pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 30, monto_bs: null }],
      items: [venta().items[0], { producto_id: 'p-otro', nombre: 'Control Roku', codigo_barras: '2000000000022', cantidad: 1, precio_unitario: 10 }],
    }));
    expect(v.comision).toBe(2);
    expect(v.items[1].precio_tipo).toBeUndefined();
    expect(v.items[1].comision_unidad).toBeUndefined();
  });
});
