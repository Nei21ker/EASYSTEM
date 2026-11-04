import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { guardarDevolucion, guardarVenta, listarDevoluciones, listarVentas } from '../../src/server/servicios/ventas';
import type { NuevaDevolucion, NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargado: UsuarioDePrueba, encargadoAcc: UsuarioDePrueba, vendedor: UsuarioDePrueba, otroVendedor: UsuarioDePrueba, tecnico: UsuarioDePrueba, contador: UsuarioDePrueba;
let sA: Sesion, sG: Sesion, sE: Sesion, sEA: Sesion, sV: Sesion, sV2: Sesion, sT: Sesion, sC: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  encargadoAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Vera Vendedora' });
  otroVendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Otto Vendedor' });
  tecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: accesorios });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sA, sG, sE, sEA, sV, sV2, sT, sC] = await Promise.all([admin, gerente, encargado, encargadoAcc, vendedor, otroVendedor, tecnico, contador].map(sesionDe));
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

const venta = (localId: string = accesorios, extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: localId,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'Ana Pérez',
  cliente_telefono: '0414-1234567',
  metodo_pago: 'USD_EFECTIVO',
  pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 12, monto_bs: null }],
  vuelto: null,
  total: 12,
  items: [{ producto_id: 'p1', nombre: 'Forro', codigo_barras: '2000000000015', cantidad: 2, precio_unitario: 6, unidades: ['2100000000012', '2100000000029'] }],
  tasa_cambio: 36.5,
  total_bs: null,
  ...extra,
});

const devolucion = (ventaId: string, folio: number, localId: string = accesorios, extra: Partial<NuevaDevolucion> = {}): NuevaDevolucion => ({
  fecha: '2026-11-03T16:00:00.000Z',
  local_id: localId,
  venta_id: ventaId,
  venta_folio: folio,
  motivo: 'No le quedó',
  items_devueltos: [{ producto_id: 'p1', nombre: 'Forro', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 6, unidades: ['2100000000012'] }],
  items_nuevos: [],
  total_devuelto: 6,
  total_nuevo: 0,
  diferencia: -6,
  tasa_cambio: 36.5,
  pagos: null,
  vuelto: null,
  reembolso: { metodo: 'USD_EFECTIVO', monto_usd: 6, monto_bs: null },
  ...extra,
});

describe('guardarVenta', () => {
  it('guarda la venta con folio, vendedor de la sesión y los datos tal cual', async () => {
    const guardada = await guardarVenta(env, sV, venta());
    expect(guardada).toMatchObject({ folio: 1, local_id: accesorios, vendedor_id: vendedor.id, vendedor_nombre: 'Vera Vendedora', total: 12, metodo_pago: 'USD_EFECTIVO', tasa_cambio: 36.5 });
    expect(guardada.items[0].unidades).toEqual(['2100000000012', '2100000000029']);
    expect(guardada.pagos).toEqual([{ metodo: 'USD_EFECTIVO', monto_usd: 12, monto_bs: null }]);
    expect(guardada.vuelto).toBeNull();
  });

  it('el vendedor no puede ponerse otro vendedor: el id sale de su sesión', async () => {
    const guardada = await guardarVenta(env, sV, venta(accesorios, { vendedor_nombre: 'Otro Nombre' }) as NuevaVenta & { vendedor_id: string });
    expect(guardada.vendedor_id).toBe(vendedor.id);
  });

  it('los folios son correlativos y no se repiten ni con ventas simultáneas', async () => {
    const guardadas = await Promise.all(Array.from({ length: 6 }, (_, i) => guardarVenta(env, i % 2 ? sV : sV2, venta(accesorios, { total: 10 + i }))));
    expect(guardadas.map((g) => g.folio).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('guarda el vuelto y los pagos mixtos', async () => {
    const guardada = await guardarVenta(
      env, sV,
      venta(accesorios, {
        metodo_pago: 'MIXTO',
        pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 10, monto_bs: null }, { metodo: 'BS_PAGO_MOVIL', monto_usd: 5, monto_bs: 182.5 }],
        vuelto: { metodo: 'USD_EFECTIVO', monto_usd: 3, monto_bs: null },
        total: 12,
        total_bs: 182.5,
      })
    );
    expect(guardada.metodo_pago).toBe('MIXTO');
    expect(guardada.pagos).toHaveLength(2);
    expect(guardada.vuelto).toEqual({ metodo: 'USD_EFECTIVO', monto_usd: 3, monto_bs: null });
    expect(guardada.total_bs).toBe(182.5);
  });

  it('roles y locales: cada quien vende en su local; el administrador y el gerente en cualquiera; el contador no', async () => {
    await guardarVenta(env, sT, venta());
    await guardarVenta(env, sEA, venta());
    await guardarVenta(env, sA, venta(vidrios));
    await guardarVenta(env, sG, venta(vidrios));
    await rechazo(guardarVenta(env, sV, venta(vidrios)), 403);
    await rechazo(guardarVenta(env, sE, venta(accesorios)), 403);
    await rechazo(guardarVenta(env, sC, venta()), 403);
  });

  it('un local suspendido no registra ventas', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();
    await rechazo(guardarVenta(env, sV, venta()), 403);
  });

  it('valida cliente, total, método de pago e items', async () => {
    await rechazo(guardarVenta(env, sV, venta(accesorios, { cliente_nombre: 'A' })), 400, /Faltan datos del cliente/);
    await rechazo(guardarVenta(env, sV, venta(accesorios, { cliente_cedula: '' })), 400, /Faltan datos del cliente/);
    await rechazo(guardarVenta(env, sV, venta(accesorios, { total: -1 })), 400);
    await rechazo(guardarVenta(env, sV, venta(accesorios, { metodo_pago: 'CHEQUE' as never })), 400);
    await rechazo(guardarVenta(env, sV, venta(accesorios, { items: [] })), 400, 'El carrito está vacío.');
  });

  it('sube la versión de ventas en ese local', async () => {
    await env.DB.prepare('DELETE FROM cambios').run();
    await guardarVenta(env, sV, venta());
    expect(await env.DB.prepare('SELECT tabla, local_id, version FROM cambios').all()).toMatchObject({ results: [{ tabla: 'ventas', local_id: accesorios, version: 1 }] });
  });
});

describe('listarVentas: quién ve qué', () => {
  beforeEach(async () => {
    await guardarVenta(env, sV, venta(accesorios, { fecha: '2026-11-01T12:00:00.000Z', total: 1 }));
    await guardarVenta(env, sV2, venta(accesorios, { fecha: '2026-11-02T12:00:00.000Z', total: 2 }));
    await guardarVenta(env, sA, venta(vidrios, { fecha: '2026-11-03T12:00:00.000Z', total: 3 }));
  });

  it('el vendedor y el técnico solo ven las suyas', async () => {
    expect((await listarVentas(env, sV, {})).map((v) => v.total)).toEqual([1]);
    expect((await listarVentas(env, sV2, {})).map((v) => v.total)).toEqual([2]);
    expect(await listarVentas(env, sT, {})).toEqual([]);
  });

  it('el encargado ve todas las de su local y ninguna de otro', async () => {
    expect((await listarVentas(env, sEA, {})).map((v) => v.total)).toEqual([2, 1]);
    expect((await listarVentas(env, sE, {})).map((v) => v.total)).toEqual([3]);
  });

  it('el administrador y el gerente ven todas, de la más nueva a la más vieja', async () => {
    expect((await listarVentas(env, sA, {})).map((v) => v.total)).toEqual([3, 2, 1]);
    expect((await listarVentas(env, sG, {})).map((v) => v.total)).toEqual([3, 2, 1]);
  });

  it('filtra por rango de fechas, por local y por límite', async () => {
    expect((await listarVentas(env, sA, { desde: '2026-11-02T00:00:00.000Z', hasta: '2026-11-02T23:59:59.999Z' })).map((v) => v.total)).toEqual([2]);
    expect((await listarVentas(env, sA, { localId: vidrios })).map((v) => v.total)).toEqual([3]);
    expect((await listarVentas(env, sA, { limite: 2 })).map((v) => v.total)).toEqual([3, 2]);
  });

  it('el contador recibe 403 y un encargado no puede pedir otro local', async () => {
    await rechazo(listarVentas(env, sC, {}), 403);
    await rechazo(listarVentas(env, sE, { localId: accesorios }), 403);
  });
});

describe('devoluciones', () => {
  it('el encargado de ese local y el administrador las registran; el vendedor y el técnico no', async () => {
    const v = await guardarVenta(env, sV, venta());
    const d = await guardarDevolucion(env, sEA, devolucion(v.id, v.folio));
    expect(d).toMatchObject({ folio: 1, venta_id: v.id, venta_folio: v.folio, registrado_por: encargadoAcc.id, total_devuelto: 6, diferencia: -6, local_id: accesorios });
    expect(d.items_devueltos[0].unidades).toEqual(['2100000000012']);
    expect(d.reembolso).toEqual({ metodo: 'USD_EFECTIVO', monto_usd: 6, monto_bs: null });
    expect((await guardarDevolucion(env, sA, devolucion(v.id, v.folio))).folio).toBe(2);
    await rechazo(guardarDevolucion(env, sV, devolucion(v.id, v.folio)), 403);
    await rechazo(guardarDevolucion(env, sT, devolucion(v.id, v.folio)), 403);
  });

  it('no se devuelve en un local ajeno, ni una venta inexistente, ni con otro local que el de la venta', async () => {
    const v = await guardarVenta(env, sV, venta());
    await rechazo(guardarDevolucion(env, sE, devolucion(v.id, v.folio, accesorios)), 403);
    await rechazo(guardarDevolucion(env, sEA, devolucion('no-existe', 99)), 404);
    await rechazo(guardarDevolucion(env, sA, devolucion(v.id, v.folio, vidrios)), 400);
  });

  it('exige motivo y al menos un producto devuelto', async () => {
    const v = await guardarVenta(env, sV, venta());
    await rechazo(guardarDevolucion(env, sEA, devolucion(v.id, v.folio, accesorios, { motivo: 'x' })), 400);
    await rechazo(guardarDevolucion(env, sEA, devolucion(v.id, v.folio, accesorios, { items_devueltos: [] })), 400);
  });

  it('listarDevoluciones: el encargado ve las de su local, el vendedor solo las de SUS ventas, y se filtra por venta', async () => {
    const v1 = await guardarVenta(env, sV, venta());
    const v2 = await guardarVenta(env, sV2, venta());
    await guardarDevolucion(env, sEA, devolucion(v1.id, v1.folio));
    await guardarDevolucion(env, sEA, devolucion(v2.id, v2.folio));
    expect(await listarDevoluciones(env, sEA, {})).toHaveLength(2);
    expect((await listarDevoluciones(env, sV, {})).map((d) => d.venta_id)).toEqual([v1.id]);
    expect((await listarDevoluciones(env, sG, { ventaId: v2.id })).map((d) => d.venta_id)).toEqual([v2.id]);
    expect(await listarDevoluciones(env, sE, {})).toEqual([]);
    await rechazo(listarDevoluciones(env, sC, {}), 403);
  });
});
