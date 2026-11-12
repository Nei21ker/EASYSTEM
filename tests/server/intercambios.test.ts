// Cambio de mercancía con otro local (Local Vidrios, migración 0025): entrega y recepción en una sola operación atómica, en espera,
// completar, revertir, y que no cuente como venta ni compra.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { registrarMovimientos } from '../../src/server/servicios/movimientos';
import { anularIntercambio, completarIntercambio, crearIntercambio, listarIntercambios } from '../../src/server/servicios/intercambios';

const env = crearEntornoDePrueba();
const { vidrios, accesorios } = IDS_LOCALES;
const A = 'p-vidrio-a'; // con etiqueta, $5
const B = 'p-vidrio-b'; // con etiqueta, $5
const C = 'p-sencillo-c'; // por cantidad, $1
const D = 'p-sencillo-d'; // por cantidad, $1

let admin: Sesion, gerente: Sesion, encargado: Sesion, encargadoAcc: Sesion, vendedor: Sesion;
const sesionDe = (u: UsuarioDePrueba) => cargarSesion(env, peticionComo(u));

async function stock(productoId: string): Promise<number> {
  const f = await env.DB.prepare('SELECT stock_actual AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?').bind(productoId, vidrios).first<{ s: number }>();
  return f?.s ?? 0;
}
const disponibles = async (productoId: string): Promise<string[]> =>
  (await env.DB.prepare("SELECT codigo FROM unidades_producto WHERE producto_id = ? AND estado = 'DISPONIBLE' ORDER BY codigo").bind(productoId).all<{ codigo: string }>()).results.map((f) => f.codigo);

async function rechazo(promesa: Promise<unknown>, status: number, codigo?: string) {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (codigo) expect((err as ErrorApi).codigo).toBe(codigo);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const uAdmin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null, nombre: 'Ada Admin', clave: 'Clave-administrador-null-123' });
  const uGerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null, nombre: 'Gaby Gerente', clave: 'Clave-gerente-null-123' });
  const uEnc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Vidrios', clave: 'Clave-encargado-vidrios-123' });
  const uEncAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, nombre: 'Ema Accesorios', clave: 'Clave-encargado-accesorios-123' });
  const uVen = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios, nombre: 'Vera Vendedora', clave: 'Clave-vendedor-vidrios-123' });
  [admin, gerente, encargado, encargadoAcc, vendedor] = await Promise.all([uAdmin, uGerente, uEnc, uEncAcc, uVen].map(sesionDe));
  const insertar = (id: string, codigo: string, nombre: string, prefijo: string, precio: number, porCantidad: number) =>
    env.DB
      .prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo, prefijo_codigo, control_por_cantidad) VALUES (?, ?, ?, 'Vidrios Templados', 0, ?, 0, ?, ?)")
      .bind(id, codigo, nombre, precio, prefijo, porCantidad)
      .run();
  await insertar(A, '2000000000015', 'Vidrio blindado Samsung A15', 'VID', 5, 0);
  await insertar(B, '2000000000022', 'Vidrio blindado Infinix Note 40', 'VIN', 5, 0);
  await insertar(C, '2000000000039', 'Vidrio sencillo Moto G14', 'VSM', 1, 1);
  await insertar(D, '2000000000046', 'Vidrio sencillo Tecno Spark', 'VST', 1, 1);
  await registrarMovimientos(env, admin, [
    { productoId: A, tipo: 'ENTRADA', cantidad: 10, localId: vidrios },
    { productoId: B, tipo: 'ENTRADA', cantidad: 4, localId: vidrios },
    { productoId: C, tipo: 'ENTRADA', cantidad: 20, localId: vidrios },
    { productoId: D, tipo: 'ENTRADA', cantidad: 2, localId: vidrios },
  ]);
});

const nuevo = (extra: Record<string, unknown> = {}) => ({
  localId: vidrios,
  contraparte: 'Local Centro',
  salen: [{ producto_id: A, cantidad: 2 }],
  entran: [{ producto_id: B, cantidad: 2 }],
  ...extra,
});

describe('cambio de mercancía', () => {
  it('mueve lo que sale y lo que entra juntos, con folio, valores y códigos de pieza', async () => {
    const antesA = await disponibles(A);
    const c = await crearIntercambio(env, encargado, nuevo({ nota: 'cambio parejo' }));
    expect(c).toMatchObject({ folio: 1, estado: 'COMPLETADO', lado_pendiente: null, contraparte: 'Local Centro', valor_sale_usd: 10, valor_entra_usd: 10, nota: 'cambio parejo' });
    expect(await stock(A)).toBe(8);
    expect(await stock(B)).toBe(6);
    // salen las dos piezas más antiguas y quedan registradas; las recibidas nacen con código nuevo
    expect(c.salen[0].unidades).toEqual(antesA.slice(0, 2));
    expect(c.entran[0].unidades).toHaveLength(2);
    expect((await disponibles(B)).filter((x) => c.entran[0].unidades!.includes(x))).toHaveLength(2);
    const vendidas = await env.DB.prepare("SELECT estado FROM unidades_producto WHERE codigo IN (?, ?)").bind(...antesA.slice(0, 2)).all<{ estado: string }>();
    expect(vendidas.results.every((u) => u.estado === 'VENDIDA')).toBe(true);
    // NO cuenta como venta ni compra: solo hay movimientos TRASLADO_* con el motivo del cambio
    const movs = await env.DB
      .prepare("SELECT tipo, motivo FROM movimientos_inventario WHERE motivo LIKE 'Cambio%' ORDER BY tipo")
      .all<{ tipo: string; motivo: string }>();
    expect(movs.results).toEqual([
      { tipo: 'TRASLADO_ENTRADA', motivo: 'Cambio #0001 con Local Centro' },
      { tipo: 'TRASLADO_SALIDA', motivo: 'Cambio #0001 con Local Centro' },
    ]);
    const ventasOCompras = await env.DB.prepare("SELECT COUNT(*) AS n FROM movimientos_inventario WHERE motivo LIKE 'Cambio%' AND tipo IN ('ENTRADA','SALIDA')").first<{ n: number }>();
    expect(ventasOCompras!.n).toBe(0);
  });

  it('funciona con productos por cantidad y con piezas escaneadas', async () => {
    const [primera, segunda, tercera] = await disponibles(A);
    const c = await crearIntercambio(env, admin, nuevo({ salen: [{ producto_id: A, cantidad: 1, unidades: [tercera] }, { producto_id: C, cantidad: 5 }], entran: [{ producto_id: D, cantidad: 6 }] }));
    expect(await stock(A)).toBe(9);
    expect(await stock(C)).toBe(15);
    expect(await stock(D)).toBe(8);
    expect(c.salen[0].unidades).toEqual([tercera]);
    expect(c.salen[1].unidades ?? null).toBeNull();
    expect(c.valor_sale_usd).toBe(10);
    expect(c.valor_entra_usd).toBe(6);
    expect(await disponibles(A)).toContain(primera);
    expect(await disponibles(A)).toContain(segunda);
    expect(await disponibles(A)).not.toContain(tercera);
  });

  it('solo en el Local Vidrios, y solo administrador, gerente y encargado de ese local', async () => {
    await rechazo(crearIntercambio(env, admin, nuevo({ localId: accesorios })), 400, 'solo_vidrios');
    await rechazo(crearIntercambio(env, encargadoAcc, nuevo()), 403);
    await rechazo(crearIntercambio(env, vendedor, nuevo()), 403);
    expect((await crearIntercambio(env, gerente, nuevo())).estado).toBe('COMPLETADO');
  });

  it('valida los datos y no deja nada a medias si falta stock', async () => {
    await rechazo(crearIntercambio(env, encargado, nuevo({ contraparte: ' ' })), 400, 'datos_invalidos');
    await rechazo(crearIntercambio(env, encargado, nuevo({ salen: [] })), 400, 'datos_invalidos');
    await rechazo(crearIntercambio(env, encargado, nuevo({ entran: [] })), 400, 'datos_invalidos');
    await rechazo(crearIntercambio(env, encargado, nuevo({ salen: [{ producto_id: A, cantidad: 0 }] })), 400, 'datos_invalidos');
    await rechazo(crearIntercambio(env, encargado, nuevo({ salen: [{ producto_id: 'no-existe', cantidad: 1 }] })), 400, 'datos_invalidos');
    await rechazo(crearIntercambio(env, encargado, nuevo({ salen: [{ producto_id: C, cantidad: 1, unidades: ['VSM000001'] }] })), 400, 'datos_invalidos');
    // 50 vidrios no hay: no se mueve NADA (ni lo que entraba) y no queda registro
    await rechazo(crearIntercambio(env, encargado, nuevo({ salen: [{ producto_id: A, cantidad: 50 }] })), 409, 'stock_insuficiente');
    expect(await stock(A)).toBe(10);
    expect(await stock(B)).toBe(4);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM intercambios').first<{ n: number }>())!.n).toBe(0);
  });

  it('en espera (falta lo que traen): entrega ahora y recibe al completarlo, una sola vez', async () => {
    const c = await crearIntercambio(env, encargado, nuevo({ lado_pendiente: 'ENTRAN' }));
    expect(c).toMatchObject({ estado: 'EN_ESPERA', lado_pendiente: 'ENTRAN', completado_en: null });
    expect(await stock(A)).toBe(8);
    expect(await stock(B)).toBe(4); // lo que nos deben todavía no está
    const listo = await completarIntercambio(env, encargado, c.id);
    expect(listo).toMatchObject({ estado: 'COMPLETADO', lado_pendiente: null, completado_por_nombre: 'Eli Vidrios' });
    expect(listo.entran[0].unidades).toHaveLength(2);
    expect(await stock(B)).toBe(6);
    await rechazo(completarIntercambio(env, encargado, c.id), 409, 'intercambio_cerrado');
    expect(await stock(B)).toBe(6);
  });

  it('en espera (falta lo nuestro): recibe ahora y, si al completarlo no alcanza el stock, sigue en espera', async () => {
    const c = await crearIntercambio(env, encargado, nuevo({ lado_pendiente: 'SALEN', salen: [{ producto_id: D, cantidad: 5 }], entran: [{ producto_id: B, cantidad: 1 }] }));
    expect(c.estado).toBe('EN_ESPERA');
    expect(await stock(B)).toBe(5); // lo recibido ya está
    expect(await stock(D)).toBe(2); // lo nuestro todavía no sale
    await rechazo(completarIntercambio(env, encargado, c.id), 409, 'stock_insuficiente');
    expect((await listarIntercambios(env, encargado, { estado: 'EN_ESPERA' })).map((x) => x.id)).toEqual([c.id]);
    expect(await stock(D)).toBe(2);
    await registrarMovimientos(env, admin, [{ productoId: D, tipo: 'ENTRADA', cantidad: 3, localId: vidrios }]);
    expect((await completarIntercambio(env, encargado, c.id)).estado).toBe('COMPLETADO');
    expect(await stock(D)).toBe(0);
  });

  it('revertir: vuelven las mismas piezas, sale lo recibido, solo administrador y gerente, una sola vez', async () => {
    const antesA = await disponibles(A);
    const c = await crearIntercambio(env, encargado, nuevo({ salen: [{ producto_id: A, cantidad: 2 }, { producto_id: C, cantidad: 3 }] }));
    await rechazo(anularIntercambio(env, encargado, c.id), 403);
    const r = await anularIntercambio(env, gerente, c.id, 'se registró mal');
    expect(r).toMatchObject({ estado: 'ANULADO', anulado_por_nombre: 'Gaby Gerente', nota_cierre: 'se registró mal' });
    expect(await stock(A)).toBe(10);
    expect(await stock(C)).toBe(20);
    expect(await stock(B)).toBe(4);
    expect(await disponibles(A)).toEqual(antesA); // las MISMAS piezas
    await rechazo(anularIntercambio(env, admin, c.id), 409, 'intercambio_cerrado');
    expect(await stock(A)).toBe(10);
  });

  it('no se puede revertir si lo recibido ya se vendió: el cambio queda como estaba', async () => {
    const c = await crearIntercambio(env, encargado, nuevo());
    await registrarMovimientos(env, admin, [{ productoId: B, tipo: 'SALIDA', cantidad: 1, localId: vidrios, unidadCodigos: [c.entran[0].unidades![0]] }]);
    await rechazo(anularIntercambio(env, admin, c.id), 409, 'no_se_puede_revertir');
    expect((await listarIntercambios(env, admin))[0].estado).toBe('COMPLETADO');
    expect(await stock(A)).toBe(8);
  });

  it('cancelar uno en espera devuelve solo el lado que ya se movió', async () => {
    const c = await crearIntercambio(env, encargado, nuevo({ lado_pendiente: 'ENTRAN' }));
    expect(await stock(A)).toBe(8);
    await anularIntercambio(env, admin, c.id);
    expect(await stock(A)).toBe(10);
    expect(await stock(B)).toBe(4);
  });

  it('la lista respeta el local, el estado y el rango de fechas', async () => {
    const c1 = await crearIntercambio(env, encargado, nuevo());
    await crearIntercambio(env, encargado, nuevo({ lado_pendiente: 'ENTRAN' }));
    expect((await listarIntercambios(env, encargado)).map((x) => x.folio)).toEqual([2, 1]);
    expect((await listarIntercambios(env, encargado, { estado: 'EN_ESPERA' })).map((x) => x.folio)).toEqual([2]);
    expect(await listarIntercambios(env, encargadoAcc)).toEqual([]);
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(c1.fecha));
    expect((await listarIntercambios(env, admin, { desde: hoy, hasta: hoy })).length).toBe(2);
    expect(await listarIntercambios(env, admin, { desde: '2000-01-01', hasta: '2000-01-31' })).toEqual([]);
    await rechazo(listarIntercambios(env, vendedor), 403);
    await rechazo(listarIntercambios(env, admin, { desde: 'mañana' }), 400);
  });
});
