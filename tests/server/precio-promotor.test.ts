// Venta con precio de promotor: el cliente paga $15 a la tienda, el precio de lista es $12 y los $3 son la comisión del promotor.
// Solo un supervisor (encargado del local, gerente o administrador) autoriza el cambio, con su contraseña; el servidor rechaza
// cualquier línea cuyo precio no sea el del catálogo si no trae esa autorización.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { autorizarPrecio, promotorValido } from '../../src/server/servicios/autorizaciones';
import { guardarVenta, listarVentas } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargadoAcc: UsuarioDePrueba, encargadoVid: UsuarioDePrueba, vendedor: UsuarioDePrueba, otroVendedor: UsuarioDePrueba, contador: UsuarioDePrueba;
let sV: Sesion, sV2: Sesion, sA: Sesion, sC: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

const PRODUCTO = 'p-control';
const PROMOTOR = { cedula: 'V-11111111', nombre: 'Pedro', apellido: 'Promotor', telefono: '0414-1234567' };

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null, nombre: 'Ada Admin', clave: 'Clave-administrador-null-123' });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null, nombre: 'Gaby Gerente', clave: 'Clave-gerente-null-123' });
  encargadoAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, nombre: 'Ema Encargada', clave: 'Clave-encargado-accesorios-123' });
  encargadoVid = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Vidrios', clave: 'Clave-encargado-vidrios-123' });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Vera Vendedora', clave: 'Clave-vendedor-accesorios-123' });
  otroVendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Otto Vendedor', clave: 'Clave-vendedor-accesorios-123' });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null, clave: 'Clave-contador-null-123' });
  [sV, sV2, sA, sC] = await Promise.all([vendedor, otroVendedor, admin, contador].map(sesionDe));
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

const pedido = (supervisor: UsuarioDePrueba, extra: Record<string, unknown> = {}) => ({
  email: supervisor.email,
  clave: supervisor.clave,
  local_id: accesorios,
  promotor: PROMOTOR,
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
    const a = await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { clave: 'incorrecta-123' })), 403, /contraseña incorrecta/i);
    const b = await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { email: 'nadie@prueba.com' })), 403, /contraseña incorrecta/i);
    const c = await rechazo(autorizarPrecio(env, sV, pedido(otroVendedor)), 403, /contraseña incorrecta/i);
    expect(a.message).toBe(b.message);
    expect(b.message).toBe(c.message);
  });

  it('el encargado de OTRO local no puede autorizar en este', async () => {
    await rechazo(autorizarPrecio(env, sV, pedido(encargadoVid)), 403, /contraseña incorrecta/i);
  });

  it('un supervisor inactivo no autoriza', async () => {
    await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(encargadoAcc.id).run();
    await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc)), 403, /contraseña incorrecta/i);
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
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { local_id: vidrios })), 403);
  });
});

describe('autorizarPrecio: solo con la contraseña (sin correo)', () => {
  const sinCorreo = (s: UsuarioDePrueba, extra: Record<string, unknown> = {}) => pedido(s, { email: undefined, ...extra });

  it('reconoce por su contraseña al encargado del local, al gerente y al administrador', async () => {
    for (const [supervisor, nombre] of [[encargadoAcc, 'Ema Encargada'], [gerente, 'Gaby Gerente'], [admin, 'Ada Admin']] as const) {
      const r = await autorizarPrecio(env, sV, sinCorreo(supervisor));
      expect(r.autorizado_por).toBe(nombre);
    }
  });

  it('la contraseña de un vendedor, del encargado de otro local, de un inactivo o inventada da el mismo 403', async () => {
    await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(gerente.id).run();
    const mensajes = new Set<string>();
    for (const s of [otroVendedor, encargadoVid, gerente]) mensajes.add((await rechazo(autorizarPrecio(env, sV2, sinCorreo(s)), 403, /contraseña incorrecta/i)).message);
    mensajes.add((await rechazo(autorizarPrecio(env, sV2, sinCorreo(admin, { clave: 'inventada-123' })), 403)).message);
    expect(mensajes.size).toBe(1);
  });

  it('adivinar contraseñas a ciegas también se bloquea a los 5 fallos (429)', async () => {
    for (let i = 0; i < 5; i++) await rechazo(autorizarPrecio(env, sV, sinCorreo(admin, { clave: `mala-clave-${i}-x` })), 403);
    await rechazo(autorizarPrecio(env, sV, sinCorreo(admin)), 429, /intentos/i);
  });
});

describe('autorizarPrecio: qué se autoriza', () => {
  it('los datos del promotor son opcionales: con todo, con una parte o sin nada', async () => {
    expect((await autorizarPrecio(env, sV, pedido(admin))).promotor).toBe('Pedro Promotor');
    expect((await autorizarPrecio(env, sV, pedido(admin, { promotor: { nombre: 'Luis' } }))).promotor).toBe('Luis');
    expect((await autorizarPrecio(env, sV, pedido(admin, { promotor: { telefono: '04141234567' } }))).promotor).toBe('');
    expect((await autorizarPrecio(env, sV, pedido(admin, { promotor: null }))).token).toBeTruthy();
    expect((await autorizarPrecio(env, sV, pedido(admin, { promotor: undefined }))).token).toBeTruthy();
  });

  it('lo que se anota del promotor debe estar bien escrito: cédula, nombre y teléfono', async () => {
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { promotor: { cedula: '12ab' } })), 400, /cédula/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { promotor: { cedula: 'V-123' } })), 400, /cédula/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { promotor: { nombre: 'R2D2' } })), 400, /nombre/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { promotor: { apellido: '1' } })), 400, /apellido/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { promotor: { telefono: '123' } })), 400, /teléfono/i);
  });

  it('la cédula se normaliza a V-/E- y el nombre y apellido se juntan', () => {
    const p = promotorValido({ cedula: '12345678', nombre: ' Ana  María ', apellido: 'Pérez', telefono: '0414-1234567' });
    expect(p.cedula).toBe('V-12345678');
    expect(p.nombre).toBe('Ana María Pérez');
    expect(promotorValido({ cedula: 'e-87654321' }).cedula).toBe('E-87654321');
    expect(promotorValido(null)).toMatchObject({ cedula: null, nombre: null, telefono: null });
  });

  it('no se autoriza un precio en cero, ni un producto que no existe', async () => {
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { lineas: [{ producto_id: PRODUCTO, precio: 0 }] })), 400);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { lineas: [{ producto_id: 'fantasma', precio: 20 }] })), 400, /producto/i);
    await rechazo(autorizarPrecio(env, sV, pedido(admin, { lineas: [] })), 400);
  });

  it('la comisión suma cantidad × (cobrado − lista) de cada línea modificada', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(admin, { lineas: [{ producto_id: PRODUCTO, precio: 15 }, { producto_id: 'p-otro', precio: 14.5 }] }));
    const v = await guardarVenta(
      env,
      sV,
      venta({
        promotor: PROMOTOR,
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

  it('sin datos del promotor también se vende: la comisión queda y el promotor en blanco', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(encargadoAcc, { promotor: null }));
    const v = await guardarVenta(env, sV, venta({ promotor: null, autorizacion_precio: token }));
    expect(v.comision).toBe(3);
    expect(v.promotor_nombre).toBeNull();
    expect(v.promotor_cedula).toBeNull();
  });

  it('el precio de catálogo no necesita autorización ni promotor (venta normal)', async () => {
    const v = await guardarVenta(env, sV, venta({ total: 12, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 12, monto_bs: null }], items: [{ producto_id: PRODUCTO, nombre: 'x', codigo_barras: 'y', cantidad: 1, precio_unitario: 12 }] }));
    expect(v.comision).toBe(0);
    expect(v.promotor_id ?? null).toBeNull();
  });

  it('la autorización vale solo para ESE precio, ese promotor, ese local y quien la pidió', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(encargadoAcc));
    // otro precio (más caro o más barato) que el autorizado
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: token, total: 20, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 20, monto_bs: null }], items: [{ producto_id: PRODUCTO, nombre: 'x', codigo_barras: 'y', cantidad: 1, precio_unitario: 20 }] })), 400, /autoriz/i);
    // otro promotor
    await rechazo(guardarVenta(env, sV, venta({ promotor: { ...PROMOTOR, nombre: 'Paula' }, autorizacion_precio: token })), 400, /autoriz/i);
    // sin los datos del promotor con los que se autorizó
    await rechazo(guardarVenta(env, sV, venta({ autorizacion_precio: token })), 400, /autoriz/i);
    // la usa otro vendedor
    await rechazo(guardarVenta(env, sV2, venta({ promotor: PROMOTOR, autorizacion_precio: token })), 400, /autoriz/i);
    // en otro local
    const sEV = await sesionDe(encargadoVid);
    await rechazo(guardarVenta(env, sEV, venta({ local_id: vidrios, promotor: PROMOTOR, autorizacion_precio: token })), 400, /autoriz|promotor/i);
  });

  it('una autorización alterada o vencida no sirve', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(encargadoAcc));
    const [cuerpo, firma] = token.split('.');
    const alterado = JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/')));
    alterado.ln = [[PRODUCTO, 99]];
    const falso = `${btoa(JSON.stringify(alterado)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${firma}`;
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: falso, total: 99, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 99, monto_bs: null }], items: [{ producto_id: PRODUCTO, nombre: 'x', codigo_barras: 'y', cantidad: 1, precio_unitario: 99 }] })), 400, /autoriz/i);
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: 'basura' })), 400, /autoriz/i);

    // vencida: un token firmado con exp en el pasado
    const { firmarAutorizacion } = await import('../../src/server/servicios/autorizaciones');
    const vencido = await firmarAutorizacion(env, { v: 1, u: sV.userId, a: encargadoAcc.id, an: 'Ema', l: accesorios, p: promotorValido(PROMOTOR).clave, pn: 'Pedro Promotor', ln: [[PRODUCTO, 15]], exp: Date.now() - 1000 });
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: vencido })), 400, /venci|autoriz/i);
  });

  it('un precio menor al del catálogo no lo puede dejar autorizado el encargado, ni siquiera con un token firmado a su nombre', async () => {
    const { firmarAutorizacion } = await import('../../src/server/servicios/autorizaciones');
    const t = await firmarAutorizacion(env, { v: 1, u: sV.userId, a: encargadoAcc.id, an: 'Ema', l: accesorios, p: promotorValido(PROMOTOR).clave, pn: 'Pedro Promotor', ln: [[PRODUCTO, 9]], exp: Date.now() + 60_000 });
    await rechazo(guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: t, total: 9, pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 9, monto_bs: null }], items: [{ producto_id: PRODUCTO, nombre: 'x', codigo_barras: 'y', cantidad: 1, precio_unitario: 9 }] })), 400, /ya no puede/i);
    expect(await listarVentas(env, sA, {})).toHaveLength(0);
  });
});

describe('descuento: precio menor al del catálogo', () => {
  const lineasDescuento = [{ producto_id: PRODUCTO, precio: 9 }];
  const ventaConDescuento = (token: string, extra: Partial<NuevaVenta> = {}): NuevaVenta =>
    venta({
      promotor: null,
      autorizacion_precio: token,
      total: 9,
      pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 9, monto_bs: null }],
      items: [{ producto_id: PRODUCTO, nombre: 'Control A/C Samsung', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 9 }],
      ...extra,
    });

  it('un gerente o un administrador autorizan un precio menor con su contraseña', async () => {
    for (const supervisor of [gerente, admin]) {
      const r = await autorizarPrecio(env, sV, pedido(supervisor, { promotor: null, lineas: lineasDescuento }));
      expect(r.token).toMatch(/\./);
    }
  });

  it('el encargado del local NO autoriza un precio menor: mismo 403, y cuenta como intento fallido', async () => {
    const e = await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { promotor: null, lineas: lineasDescuento })), 403, /gerente o un administrador/i);
    expect(e.status).toBe(403);
    // el mismo encargado sí autoriza un precio mayor
    expect((await autorizarPrecio(env, sV, pedido(encargadoAcc))).token).toBeTruthy();
  });

  it('5 intentos seguidos con la contraseña del encargado en un descuento bloquean a quien vende (429)', async () => {
    for (let i = 0; i < 5; i++) await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { promotor: null, lineas: lineasDescuento })), 403);
    await rechazo(autorizarPrecio(env, sV, pedido(gerente, { promotor: null, lineas: lineasDescuento })), 429, /intentos/i);
  });

  it('si UNA línea baja y otra sube, manda la regla más estricta: solo gerente o administrador', async () => {
    const lineas = [{ producto_id: PRODUCTO, precio: 15 }, { producto_id: 'p-otro', precio: 8 }];
    await rechazo(autorizarPrecio(env, sV, pedido(encargadoAcc, { lineas })), 403, /gerente o un administrador/i);
    expect((await autorizarPrecio(env, sV, pedido(gerente, { lineas }))).token).toBeTruthy();
  });

  it('la venta con descuento se guarda al precio cobrado, con el precio de lista de esa línea, sin comisión y con quién autorizó', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(gerente, { promotor: null, lineas: lineasDescuento }));
    const v = await guardarVenta(env, sV, ventaConDescuento(token));
    expect(v.total).toBe(9);
    expect(v.comision).toBe(0);
    expect(v.precio_autorizado_nombre).toBe('Gaby Gerente');
    expect(v.promotor_nombre).toBeNull();
    expect(v.items[0]).toMatchObject({ precio_unitario: 9, precio_lista: 12 });
  });

  it('sin autorización un precio menor al del catálogo se rechaza (400)', async () => {
    await rechazo(guardarVenta(env, sV, ventaConDescuento('')), 400, /autoriz/i);
    expect(await listarVentas(env, sA, {})).toHaveLength(0);
  });

  it('un token de descuento a nombre de un gerente que ya no puede autorizar no sirve', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(gerente, { promotor: null, lineas: lineasDescuento }));
    await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(gerente.id).run();
    await rechazo(guardarVenta(env, sV, ventaConDescuento(token)), 400, /ya no puede/i);
  });

  it('en una venta mixta la comisión es solo de la línea más cara; el descuento de la otra no la reduce', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(admin, { lineas: [{ producto_id: PRODUCTO, precio: 15 }, { producto_id: 'p-otro', precio: 8 }] }));
    const v = await guardarVenta(
      env,
      sV,
      venta({
        promotor: PROMOTOR,
        autorizacion_precio: token,
        total: 23,
        pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 23, monto_bs: null }],
        items: [
          { producto_id: PRODUCTO, nombre: 'Control A/C Samsung', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 15 },
          { producto_id: 'p-otro', nombre: 'Control Roku', codigo_barras: '2000000000022', cantidad: 1, precio_unitario: 8 },
        ],
      })
    );
    expect(v.comision).toBe(3);
    expect(v.precio_autorizado_nombre).toBe('Ada Admin');
  });
});

describe('precio del local (modo "local"): la tienda cambia el precio, sin promotor ni comisión', () => {
  const ventaLocal = (token: string, precio: number, extra: Partial<NuevaVenta> = {}): NuevaVenta =>
    venta({
      promotor: null,
      autorizacion_precio: token,
      total: precio,
      pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: precio, monto_bs: null }],
      items: [{ producto_id: PRODUCTO, nombre: 'Control A/C Samsung', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: precio }],
      ...extra,
    });
  const pedidoLocal = (supervisor: UsuarioDePrueba, precio: number, extra: Record<string, unknown> = {}) =>
    pedido(supervisor, { modo: 'local', promotor: null, lineas: [{ producto_id: PRODUCTO, precio }], ...extra });

  it('más caro: lo autoriza el encargado del local, un gerente o un administrador; la respuesta dice el modo', async () => {
    for (const supervisor of [encargadoAcc, gerente, admin]) {
      const r = await autorizarPrecio(env, sV, pedidoLocal(supervisor, 15));
      expect(r.modo).toBe('local');
      expect(r.promotor).toBe('');
    }
    // sin indicar modo (clientes anteriores) sigue siendo precio de promotor
    expect((await autorizarPrecio(env, sV, pedido(encargadoAcc))).modo).toBe('promotor');
  });

  it('con descuento: solo gerente o administrador; el encargado recibe el mismo 403 y cuenta como intento fallido', async () => {
    for (const supervisor of [gerente, admin]) expect((await autorizarPrecio(env, sV, pedidoLocal(supervisor, 9))).modo).toBe('local');
    await rechazo(autorizarPrecio(env, sV, pedidoLocal(encargadoAcc, 9)), 403, /gerente o un administrador/i);
  });

  it('un precio más caro del local se guarda sin comisión, sin promotor y marcado como precio del local, con quién autorizó', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoLocal(encargadoAcc, 15));
    const v = await guardarVenta(env, sV, ventaLocal(token, 15));
    expect(v.total).toBe(15);
    expect(v.comision).toBe(0);
    expect(v.promotor_nombre).toBeNull();
    expect(v.promotor_cedula).toBeNull();
    expect(v.precio_autorizado_nombre).toBe('Ema Encargada');
    expect(v.items[0]).toMatchObject({ precio_unitario: 15, precio_lista: 12, precio_tipo: 'local' });
  });

  it('aunque el cliente mande datos de promotor, en el modo local se ignoran y no hay comisión', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoLocal(gerente, 15, { promotor: PROMOTOR }));
    const v = await guardarVenta(env, sV, ventaLocal(token, 15, { promotor: PROMOTOR }));
    expect(v.comision).toBe(0);
    expect(v.promotor_nombre).toBeNull();
    expect(v.promotor_telefono).toBeNull();
  });

  it('con descuento del local se guarda marcado como local y sin comisión', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoLocal(gerente, 9));
    const v = await guardarVenta(env, sV, ventaLocal(token, 9));
    expect(v.comision).toBe(0);
    expect(v.items[0]).toMatchObject({ precio_unitario: 9, precio_lista: 12, precio_tipo: 'local' });
  });

  it('el cliente no puede marcar por su cuenta una línea como "local" para evitar la comisión: sale marcada solo lo que dice la autorización', async () => {
    const { token } = await autorizarPrecio(env, sV, pedido(encargadoAcc)); // precio de promotor
    const v = await guardarVenta(env, sV, venta({ promotor: PROMOTOR, autorizacion_precio: token, items: [{ producto_id: PRODUCTO, nombre: 'Control A/C Samsung', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 15, precio_tipo: 'local' }] }));
    expect(v.comision).toBe(3);
    expect(v.items[0].precio_tipo).toBeUndefined();
  });

  it('una autorización de precio del local no sirve para otro precio ni para otro vendedor', async () => {
    const { token } = await autorizarPrecio(env, sV, pedidoLocal(gerente, 15));
    await rechazo(guardarVenta(env, sV, ventaLocal(token, 14)), 400, /autoriz/i);
    await rechazo(guardarVenta(env, sV2, ventaLocal(token, 15)), 400, /autoriz/i);
    expect(await listarVentas(env, sA, {})).toHaveLength(0);
  });
});
