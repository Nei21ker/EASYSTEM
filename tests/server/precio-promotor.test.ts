// Venta con precio de promotor: el cliente paga $15 a la tienda, el precio de lista es $12 y los $3 son la comisión del promotor.
// Solo un supervisor (encargado del local, gerente o administrador) autoriza el cambio, con su contraseña; el servidor rechaza
// cualquier línea cuyo precio no sea el del catálogo si no trae esa autorización.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { autorizarPrecio, listarPromotores } from '../../src/server/servicios/autorizaciones';
import { guardarVenta, listarVentas } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargadoAcc: UsuarioDePrueba, encargadoVid: UsuarioDePrueba, vendedor: UsuarioDePrueba, otroVendedor: UsuarioDePrueba, contador: UsuarioDePrueba;
let sV: Sesion, sV2: Sesion, sA: Sesion, sC: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

const PRODUCTO = 'p-control';
const PROMOTOR = 'promotor-1';

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null, nombre: 'Ada Admin' });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null, nombre: 'Gaby Gerente' });
  encargadoAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, nombre: 'Ema Encargada' });
  encargadoVid = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Vidrios' });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Vera Vendedora' });
  otroVendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Otto Vendedor' });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sV, sV2, sA, sC] = await Promise.all([vendedor, otroVendedor, admin, contador].map(sesionDe));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES (?, '2000000000015', 'Control A/C Samsung', 'Controles', 8, 12, 0)").bind(PRODUCTO),
    env.DB.prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES ('p-otro', '2000000000022', 'Control Roku', 'Controles', 9, 10, 0)"),
    env.DB.prepare("INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base, tipo, frecuencia_pago, estado, fecha_ingreso) VALUES (?, ?, 'Pedro', 'Promotor', 'V-111', 'Promotor', 0, 'INDEPENDIENTE', 'DIARIO', 'ACTIVO', '2026-01-01')").bind(PROMOTOR, accesorios),
    env.DB.prepare("INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base, tipo, frecuencia_pago, estado, fecha_ingreso) VALUES ('promotor-inactivo', ?, 'Inés', 'Inactiva', 'V-222', 'Promotor', 0, 'INDEPENDIENTE', 'DIARIO', 'INACTIVO', '2026-01-01')").bind(accesorios),
    env.DB.prepare("INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base, tipo, frecuencia_pago, estado, fecha_ingreso) VALUES ('empleado-fijo', ?, 'Fabio', 'Fijo', 'V-333', 'Cajero', 300, 'FIJO', 'QUINCENAL', 'ACTIVO', '2026-01-01')").bind(accesorios),
    env.DB.prepare("INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base, tipo, frecuencia_pago, estado, fecha_ingreso) VALUES ('promotor-vidrios', ?, 'Vera', 'Vidrios', 'V-444', 'Promotor', 0, 'INDEPENDIENTE', 'DIARIO', 'ACTIVO', '2026-01-01')").bind(vidrios),
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

const pedido = (supervisor: UsuarioDePrueba, extra: Record<string, unknown> = {}) => ({
  email: supervisor.email,
  clave: supervisor.clave,
  local_id: accesorios,
  promotor_id: PROMOTOR,
  lineas: [{ producto_id: PRODUCTO, precio: 15 }],
  ...extra,
});

const venta = (extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: accesorios,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'Ana Pérez',
  cliente_telefono: '0414-1234567',
  metodo_pago: 'USD_EFECTIVO',
  pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 15, monto_bs: null }],
  vuelto: null,
  total: 15,
  items: [{ producto_id: PRODUCTO, nombre: 'Control A/C Samsung', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 15 }],
  tasa_cambio: 36.5,
  total_bs: null,
  ...extra,
});

describe('autorizarPrecio: quién puede autorizar', () => {
  it('un encargado del local, un gerente y un administrador autorizan con su contraseña', async () => {
    for (const supervisor of [encargadoAcc, gerente, admin]) {
      const r = await autorizarPrecio(env, sV, pedido(supervisor));
      expect(r.token).toMatch(/\./);
      expect(r.autorizado_por).toBe(supervisor === encargadoAcc ? 'Ema Encargada' : supervisor === gerente ? 'Gaby Gerente' : 'Ada Admin');
      expect(r.promotor).toBe('Pedro Promotor');
    }
  });

  it('el propio supervisor puede vender con su sesión, pero también teclea su contraseña', async () => {
    const sEncargado = await sesionDe(encargadoAcc);
    expect((await autorizarPrecio(env, sEncargado, pedido(encargadoAcc))).token).toBeTruthy();
    await rechazo(autorizarPrecio(env, sEncargado, pedido(encargadoAcc, { clave: 'otra-clave-123' })), 403);
  });

  it('una contraseña equivocada, un correo desconocido o un vendedor como "supervisor" dan el mismo 403', async () => {
    const a = await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { clave: 'incorrecta-123' })), 403, /no válid/i);
    const b = await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { email: 'nadie@prueba.com' })), 403, /no válid/i);
    const c = await rechazo(autorizarPrecio(env, sV, pedido(otroVendedor)), 403, /no válid/i);
    expect(a.message).toBe(b.message);
    expect(b.message).toBe(c.message);
  });

  it('el encargado de OTRO local no puede autorizar en este', async () => {
    await rechazo(autorizarPrecio(env, sV, pedido(encargadoVid)), 403, /no válid/i);
  });

  it('un supervisor inactivo no autoriza', async () => {
    await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(encargadoAcc.id).run();
    await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc)), 403, /no válid/i);
  });

  it('tras 5 contraseñas equivocadas seguidas se bloquea (429), aunque después se acierte', async () => {
    for (let i = 0; i < 5; i++) await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { clave: `mala-clave-${i}-x` })), 403);
    await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc)), 429, /intentos/i);
    // otro vendedor no queda bloqueado por los errores de este
    expect((await autorizarPrecio(env, sV2, pedido(encargadoAcc))).token).toBeTruthy();
  });

  it('un acierto borra los fallos anteriores', async () => {
    for (let i = 0; i < 4; i++) await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { clave: `mala-clave-${i}-x` })), 403);
    await autorizarPrecio(env, sV, pedido(encargadoAcc));
    for (let i = 0; i < 4; i++) await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { clave: `mala-clave-${i}-y` })), 403);
    expect((await autorizarPrecio(env, sV, pedido(encargadoAcc))).token).toBeTruthy();
  });

  it('el contador no puede usarlo y nadie autoriza en un local al que no accede', async () => {
    await rechazo(autorizarPrecio(env, sC, pedido(admin)), 403);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { local_id: vidrios, promotor_id: 'promotor-vidrios' })), 403);
  });
});

describe('autorizarPrecio: qué se autoriza', () => {
  it('el promotor debe ser un trabajador independiente ACTIVO de ese local', async () => {
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { promotor_id: 'promotor-inactivo' })), 400, /promotor/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { promotor_id: 'empleado-fijo' })), 400, /promotor/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { promotor_id: 'promotor-vidrios' })), 400, /promotor/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { promotor_id: 'no-existe' })), 400, /promotor/i);
  });

  it('no se autoriza un precio menor al de lista, ni cero, ni un producto que no existe', async () => {
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { lineas: [{ producto_id: PRODUCTO, precio: 11.99 }] })), 400, /lista/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { lineas: [{ producto_id: PRODUCTO, precio: 0 }] })), 400);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { lineas: [{ producto_id: 'fantasma', precio: 20 }] })), 400, /producto/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { lineas: [] })), 400);
  });

  it('listarPromotores devuelve solo los independientes activos del local', async () => {
    const lista = await listarPromotores(env, sV, accesorios);
    expect(lista).toEqual([{ id: PROMOTOR, nombre: 'Pedro Promotor' }]);
    await rechazo(listarPromotores(env, sV, vidrios), 403);
    await rechazo(listarPromotores(env, sC, accesorios), 403);
  });
});

describe('guardarVenta con precio de promotor', () => {
  it('guarda $15 cobrados, comisión $3, el promotor, quién autorizó y el precio de lista de la línea', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(encargadoAcc));
    const v = await guardarVenta(env, sV, venta({ promotor_id: PROMOTOR, autorizacion_precio: token }));
    expect(v.total).toBe(15);
    expect(v.comision).toBe(3);
    expect(v.promotor_id).toBe(PROMOTOR);
    expect(v.promotor_nombre).toBe('Pedro Promotor');
    expect(v.precio_autorizado_nombre).toBe('Ema Encargada');
    expect(v.precio_autorizado_por).toBe(encargadoAcc.id);
    expect(v.items[0].precio_unitario).toBe(15);
    expect(v.items[0].precio_lista).toBe(12);
    // y se lee igual en el historial (el vendedor ve la suya)
    const [leida] = await listarVentas(env, sV, {});
    expect(leida.comision).toBe(3);
    expect(leida.promotor_nombre).toBe('Pedro Promotor');
  });

  it('la comisión suma cantidad × (cobrado − lista) de cada línea modificada', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(admin, { lineas: [{ producto_id: PRODUCTO, precio: 15 }, { producto_id: 'p-otro', precio: 14.5 }] }));
    const v = await guardarVenta(
      env,
      sV,
      venta({
        promotor_id: PROMOTOR,
        autorizacion_precio: token,
        total: 15 * 2 + 14.5 + 10,
        pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 54.5, monto_bs: null }],
        items: [
          { producto_id: PRODUCTO, nombre: 'Control A/C Samsung', codigo_barras: '2000000000015', cantidad: 2, precio_unitario: 15 },
          { producto_id: 'p-otro', nombre: 'Control Roku', codigo_barras: '2000000000022', cantidad: 1, precio_unitario: 14.5 },
          { producto_id: PRODUCTO, nombre: 'Control A/C Samsung', codigo_barras: '2000000000015', cantidad: 0, precio_unitario: 12 },
        ],
      })
    );
    expect(v.comision).toBe(2 * 3 + 4.5);
  });

  it('un precio distinto al del catálogo SIN autorización se rechaza (400) y no se guarda nada', async () => {
    await rechazo(guardarVenta(env, sV, venta()), 400, /autoriz/i);
    expect(await listarVentas(env, sA, {})).toHaveLength(0);
  });

  it('el precio de catálogo no necesita autorización ni promotor (venta normal)', async () => {
    const v = await guardarVenta(env, sV, venta({ total: 12, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 12, monto_bs: null }], items: [{ producto_id: PRODUCTO, nombre: 'x', codigo_barras: 'y', cantidad: 1, precio_unitario: 12 }] }));
    expect(v.comision).toBe(0);
    expect(v.promotor_id ?? null).toBeNull();
  });

  it('la autorización vale solo para ESE precio, ese promotor, ese local y quien la pidió', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(encargadoAcc));
    // otro precio (más caro o más barato) que el autorizado
    await rechazo(guardarVenta(env, sV, venta({ promotor_id: PROMOTOR, autorizacion_precio: token, total: 20, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 20, monto_bs: null }], items: [{ producto_id: PRODUCTO, nombre: 'x', codigo_barras: 'y', cantidad: 1, precio_unitario: 20 }] })), 400, /autoriz/i);
    // otro promotor
    await env.DB.prepare("INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base, tipo, frecuencia_pago, estado, fecha_ingreso) VALUES ('promotor-2', ?, 'Paula', 'Promo', 'V-555', 'Promotor', 0, 'INDEPENDIENTE', 'DIARIO', 'ACTIVO', '2026-01-01')").bind(accesorios).run();
    await rechazo(guardarVenta(env, sV, venta({ promotor_id: 'promotor-2', autorizacion_precio: token })), 400, /autoriz/i);
    // sin indicar promotor
    await rechazo(guardarVenta(env, sV, venta({ autorizacion_precio: token })), 400, /promotor/i);
    // la usa otro vendedor
    await rechazo(guardarVenta(env, sV2, venta({ promotor_id: PROMOTOR, autorizacion_precio: token })), 400, /autoriz/i);
    // en otro local
    const sEV = await sesionDe(encargadoVid);
    await rechazo(guardarVenta(env, sEV, venta({ local_id: vidrios, promotor_id: PROMOTOR, autorizacion_precio: token })), 400, /autoriz|promotor/i);
  });

  it('una autorización alterada o vencida no sirve', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(encargadoAcc));
    const [cuerpo, firma] = token.split('.');
    const alterado = JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/')));
    alterado.ln = [[PRODUCTO, 99]];
    const falso = `${btoa(JSON.stringify(alterado)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${firma}`;
    await rechazo(guardarVenta(env, sV, venta({ promotor_id: PROMOTOR, autorizacion_precio: falso, total: 99, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 99, monto_bs: null }], items: [{ producto_id: PRODUCTO, nombre: 'x', codigo_barras: 'y', cantidad: 1, precio_unitario: 99 }] })), 400, /autoriz/i);
    await rechazo(guardarVenta(env, sV, venta({ promotor_id: PROMOTOR, autorizacion_precio: 'basura' })), 400, /autoriz/i);

    // vencida: un token firmado con exp en el pasado
    const { firmarAutorizacion } = await import('../../src/server/servicios/autorizaciones');
    const vencido = await firmarAutorizacion(env, { v: 1, u: sV.userId, a: encargadoAcc.id, an: 'Ema', l: accesorios, p: PROMOTOR, pn: 'Pedro Promotor', ln: [[PRODUCTO, 15]], exp: Date.now() - 1000 });
    await rechazo(guardarVenta(env, sV, venta({ promotor_id: PROMOTOR, autorizacion_precio: vencido })), 400, /venci|autoriz/i);
  });

  it('el precio no puede quedar por debajo del de lista aunque venga "autorizado"', async () => {
    const { firmarAutorizacion } = await import('../../src/server/servicios/autorizaciones');
    const t = await firmarAutorizacion(env, { v: 1, u: sV.userId, a: encargadoAcc.id, an: 'Ema', l: accesorios, p: PROMOTOR, pn: 'Pedro Promotor', ln: [[PRODUCTO, 9]], exp: Date.now() + 60_000 });
    await rechazo(guardarVenta(env, sV, venta({ promotor_id: PROMOTOR, autorizacion_precio: t, total: 9, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 9, monto_bs: null }], items: [{ producto_id: PRODUCTO, nombre: 'x', codigo_barras: 'y', cantidad: 1, precio_unitario: 9 }] })), 400, /lista/i);
  });
});
