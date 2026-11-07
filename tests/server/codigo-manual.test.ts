// Elegir a mano el código de una unidad (la etiqueta no se lee): solo con la contraseña de un supervisor, y la venta lo deja marcado.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { autorizarCodigoManual, autorizarPrecio } from '../../src/server/servicios/autorizaciones';
import { guardarVenta, listarVentas } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let admin: UsuarioDePrueba, encargadoAcc: UsuarioDePrueba, encargadoVid: UsuarioDePrueba, vendedor: UsuarioDePrueba, otroVendedor: UsuarioDePrueba, contador: UsuarioDePrueba;
let sV: Sesion, sV2: Sesion, sC: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));
const P = 'p-uno';
const Q = 'p-dos';

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null, nombre: 'Ada Admin', clave: 'Clave-administrador-null-123' });
  encargadoAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, nombre: 'Ema Encargada', clave: 'Clave-encargado-accesorios-123' });
  encargadoVid = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Vidrios', clave: 'Clave-encargado-vidrios-123' });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Vera Vendedora', clave: 'Clave-vendedor-accesorios-123' });
  otroVendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Otto Vendedor', clave: 'Clave-vendedor-accesorios-123' });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null, clave: 'Clave-contador-null-123' });
  [sV, sV2, sC] = await Promise.all([vendedor, otroVendedor, contador].map(sesionDe));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES ('p-uno', '2000000000015', 'Control A', 'Controles', 8, 12, 0)"),
    env.DB.prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES ('p-dos', '2000000000022', 'Control B', 'Controles', 8, 12, 0)"),
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

const pedido = (s: UsuarioDePrueba, extra: Record<string, unknown> = {}) => ({ email: s.email, clave: s.clave, local_id: accesorios, producto_id: P, ...extra });

const venta = (extra: Partial<NuevaVenta['items'][0]> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: accesorios,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'Ana Pérez',
  cliente_telefono: '0414-1234567',
  metodo_pago: 'USD_EFECTIVO',
  pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 12, monto_bs: null }],
  vuelto: null,
  total: 12,
  items: [{ producto_id: P, nombre: 'Control A', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 12, unidades: ['CTL000001'], ...extra }],
  tasa_cambio: 36.5,
  total_bs: null,
});

describe('autorizarCodigoManual', () => {
  it('un encargado del local, un gerente o un administrador autorizan con su contraseña', async () => {
    for (const s of [encargadoAcc, admin]) {
      const r = await autorizarCodigoManual(env, sV, pedido(s));
      expect(r.token).toMatch(/\./);
      expect(r.autorizado_por).toBe(s === admin ? 'Ada Admin' : 'Ema Encargada');
    }
  });

  it('con solo la contraseña (sin correo) reconoce a quien puede autorizar en este local', async () => {
    expect((await autorizarCodigoManual(env, sV, pedido(encargadoAcc, { email: undefined }))).autorizado_por).toBe('Ema Encargada');
    expect((await autorizarCodigoManual(env, sV, pedido(admin, { email: undefined }))).autorizado_por).toBe('Ada Admin');
    await rechazo(autorizarCodigoManual(env, sV, pedido(encargadoVid, { email: undefined })), 403, /contraseña incorrecta/i);
    await rechazo(autorizarCodigoManual(env, sV, pedido(otroVendedor, { email: undefined })), 403, /contraseña incorrecta/i);
  });

  it('clave equivocada, correo desconocido, vendedor o encargado de otro local: el mismo 403', async () => {
    const a = await rechazo(autorizarCodigoManual(env, sV, pedido(encargadoAcc, { clave: 'incorrecta-123' })), 403, /contraseña incorrecta/i);
    const b = await rechazo(autorizarCodigoManual(env, sV, pedido(encargadoAcc, { email: 'nadie@prueba.com' })), 403, /contraseña incorrecta/i);
    const c = await rechazo(autorizarCodigoManual(env, sV, pedido(otroVendedor)), 403, /contraseña incorrecta/i);
    const d = await rechazo(autorizarCodigoManual(env, sV, pedido(encargadoVid)), 403, /contraseña incorrecta/i);
    expect(new Set([a.message, b.message, c.message, d.message]).size).toBe(1);
  });

  it('5 fallos seguidos bloquean (429) y comparten el tope con la autorización de precio', async () => {
    for (let i = 0; i < 5; i++) await rechazo(autorizarCodigoManual(env, sV, pedido(encargadoAcc, { clave: `mala-clave-${i}-x` })), 403);
    await rechazo(autorizarCodigoManual(env, sV, pedido(encargadoAcc)), 429, /intentos/i);
    await rechazo(autorizarPrecio(env, sV, { email: encargadoAcc.email, clave: encargadoAcc.clave, local_id: accesorios, promotor_id: 'x', lineas: [{ producto_id: P, precio: 20 }] }), 400); // promotor inválido: ni siquiera llega a la clave
    expect((await autorizarCodigoManual(env, sV2, pedido(encargadoAcc))).token).toBeTruthy();
  });

  it('el contador no puede, ni en un local ajeno, ni con un producto que no existe', async () => {
    await rechazo(autorizarCodigoManual(env, sC, pedido(admin)), 403);
    await rechazo(autorizarCodigoManual(env, sV, pedido(admin, { local_id: vidrios })), 403);
    await rechazo(autorizarCodigoManual(env, sV, pedido(admin, { producto_id: 'fantasma' })), 400, /producto/i);
  });
});

describe('guardarVenta con códigos elegidos a mano', () => {
  it('con la autorización guarda los códigos marcados y quién los autorizó (sin guardar el token)', async () => {
    const { token } = await autorizarCodigoManual(env, sV, pedido(encargadoAcc));
    const v = await guardarVenta(env, sV, venta({ codigos_manuales: ['CTL000001'], autorizacion_codigo: token }));
    expect(v.items[0].seleccion_manual).toEqual({ codigos: ['CTL000001'], autorizado_por: encargadoAcc.id, autorizado_nombre: 'Ema Encargada' });
    expect(v.items[0].autorizacion_codigo).toBeUndefined();
    expect(v.items[0].codigos_manuales).toBeUndefined();
    const [leida] = await listarVentas(env, sV, {});
    expect(leida.items[0].seleccion_manual?.autorizado_nombre).toBe('Ema Encargada');
  });

  it('una venta normal no lleva marca ni exige nada', async () => {
    const v = await guardarVenta(env, sV, venta());
    expect(v.items[0].seleccion_manual).toBeUndefined();
  });

  it('sin autorización, con una alterada o con basura se rechaza (400)', async () => {
    await rechazo(guardarVenta(env, sV, venta({ codigos_manuales: ['CTL000001'] })), 400, /autoriz/i);
    await rechazo(guardarVenta(env, sV, venta({ codigos_manuales: ['CTL000001'], autorizacion_codigo: 'basura' })), 400, /autoriz/i);
    const { token } = await autorizarCodigoManual(env, sV, pedido(encargadoAcc));
    const [cuerpo, firma] = token.split('.');
    const carga = JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/')));
    carga.pr = Q;
    const falso = `${btoa(JSON.stringify(carga)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${firma}`;
    await rechazo(guardarVenta(env, sV, venta({ codigos_manuales: ['CTL000001'], autorizacion_codigo: falso })), 400, /autoriz/i);
    expect(await listarVentas(env, sV, {})).toHaveLength(0);
  });

  it('la autorización vale solo para ESE producto y ESE vendedor', async () => {
    const { token } = await autorizarCodigoManual(env, sV, pedido(encargadoAcc, { producto_id: Q }));
    await rechazo(guardarVenta(env, sV, venta({ codigos_manuales: ['CTL000001'], autorizacion_codigo: token })), 400, /otra venta|producto/i);
    const { token: delP } = await autorizarCodigoManual(env, sV, pedido(encargadoAcc));
    await rechazo(guardarVenta(env, sV2, venta({ codigos_manuales: ['CTL000001'], autorizacion_codigo: delP })), 400, /otra venta|vendedor/i);
  });

  it('una autorización vencida o la de PRECIO de promotor no sirven', async () => {
    const { firmarAutorizacion } = await import('../../src/server/servicios/autorizaciones');
    const vencido = await firmarAutorizacion(env, { v: 1, k: 'codigo', u: sV.userId, a: encargadoAcc.id, an: 'Ema', l: accesorios, pr: P, exp: Date.now() - 1000 } as never);
    await rechazo(guardarVenta(env, sV, venta({ codigos_manuales: ['CTL000001'], autorizacion_codigo: vencido })), 400, /venci/i);
    const precio = await firmarAutorizacion(env, { v: 1, u: sV.userId, a: encargadoAcc.id, an: 'Ema', l: accesorios, p: 'x', pn: 'x', ln: [[P, 12]], exp: Date.now() + 60_000 });
    await rechazo(guardarVenta(env, sV, venta({ codigos_manuales: ['CTL000001'], autorizacion_codigo: precio })), 400, /autoriz/i);
  });

  it('un código que no es de las unidades de la línea se rechaza', async () => {
    const { token } = await autorizarCodigoManual(env, sV, pedido(encargadoAcc));
    await rechazo(guardarVenta(env, sV, venta({ codigos_manuales: ['CTL000099'], autorizacion_codigo: token })), 400, /código/i);
  });

  it('si el supervisor se desactiva antes de cobrar, ya no vale', async () => {
    const { token } = await autorizarCodigoManual(env, sV, pedido(encargadoAcc));
    await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(encargadoAcc.id).run();
    await rechazo(guardarVenta(env, sV, venta({ codigos_manuales: ['CTL000001'], autorizacion_codigo: token })), 400, /ya no puede/i);
  });
});
