import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto } from '../../src/server/servicios/catalogo';
import { registrarMovimiento } from '../../src/server/servicios/movimientos';
import { eliminarVentas, guardarDevolucion, guardarVenta, listarDevoluciones, listarVentas } from '../../src/server/servicios/ventas';
import type { NuevaVenta, VentaItem } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let sA: Sesion, sG: Sesion, sE: Sesion, sV: Sesion, sC: Sesion;
let P: string, Q: string;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const usuarios = await Promise.all([
    crearUsuarioDePrueba(env, { rol: 'administrador', localId: null }),
    crearUsuarioDePrueba(env, { rol: 'gerente', localId: null }),
    crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios }),
    crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios }),
    crearUsuarioDePrueba(env, { rol: 'contador', localId: null }),
  ]);
  [sA, sG, sE, sV, sC] = await Promise.all(usuarios.map(sesionDe));
  P = (await crearProducto(env, sA, { codigo_barras: '2000000000015', nombre: 'Forro iPhone 11', categoria: 'Forros', precio_venta: 6 })).id;
  Q = (await crearProducto(env, sA, { codigo_barras: '2000000000022', nombre: 'Cable USB', categoria: 'Cables', precio_venta: 5 })).id;
});

async function rechazo(promesa: Promise<unknown>, status: number): Promise<void> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const una = <T>(sql: string, ...v: unknown[]) => env.DB.prepare(sql).bind(...v).first<T>();
const stock = async (productoId: string, localId: string) =>
  (await una<{ s: number }>('SELECT stock_actual AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?', productoId, localId))?.s ?? 0;
const totalProducto = async (productoId: string) => (await una<{ s: number }>('SELECT stock_actual AS s FROM productos WHERE id = ?', productoId))!.s;
const contar = async (tabla: string) => (await una<{ n: number }>(`SELECT count(*) AS n FROM ${tabla}`))!.n;
const vendidas = async () => (await una<{ n: number }>("SELECT count(*) AS n FROM unidades_producto WHERE estado = 'VENDIDA'"))!.n;
const salidas = async (productoId: string) =>
  (await una<{ n: number }>("SELECT count(*) AS n FROM movimientos_inventario WHERE tipo = 'SALIDA' AND producto_id = ?", productoId))!.n;

const entrada = async (productoId: string, localId: string, cantidad: number) =>
  (await registrarMovimiento(env, sA, { productoId, tipo: 'ENTRADA', cantidad, localId, motivo: 'Compra' })).unidadCodigos;

/** Vende de verdad: la salida de stock (con sus piezas) y el registro de la venta, como hace el punto de venta. */
async function vender(productoId: string, localId: string, cantidad: number, sesion: Sesion = sV): Promise<{ id: string; folio: number; codigos: string[] }> {
  const { unidadCodigos } = await registrarMovimiento(env, sesion, { productoId, tipo: 'SALIDA', cantidad, localId, motivo: 'Venta POS' });
  const precio = productoId === Q ? 5 : 6;
  const item: VentaItem = { producto_id: productoId, nombre: 'Producto', codigo_barras: '2000000000015', cantidad, precio_unitario: precio, unidades: unidadCodigos };
  const datos: NuevaVenta = {
    fecha: '2026-11-03T15:00:00.000Z', local_id: localId, cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567',
    metodo_pago: 'USD_EFECTIVO', pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: precio * cantidad, monto_bs: null }], vuelto: null, total: precio * cantidad, items: [item], tasa_cambio: 36.5, total_bs: null,
  };
  const v = await guardarVenta(env, sesion, datos);
  return { id: v.id, folio: v.folio, codigos: unidadCodigos };
}

/** Devuelve piezas de una venta: vuelven al stock (ENTRADA con sus códigos) y queda el registro de la devolución. */
async function devolver(venta: { id: string; folio: number }, productoId: string, codigos: string[], nuevos: VentaItem[] = []): Promise<void> {
  await registrarMovimiento(env, sA, { productoId, tipo: 'ENTRADA', cantidad: codigos.length, localId: accesorios, motivo: 'Devolución', unidadCodigos: codigos });
  await guardarDevolucion(env, sA, {
    fecha: '2026-11-03T16:00:00.000Z', local_id: accesorios, venta_id: venta.id, venta_folio: venta.folio, motivo: 'No le quedó',
    items_devueltos: [{ producto_id: productoId, nombre: 'Producto', codigo_barras: '2000000000015', cantidad: codigos.length, precio_unitario: 6, unidades: codigos }],
    items_nuevos: nuevos, total_devuelto: 6 * codigos.length, total_nuevo: 0, diferencia: -6 * codigos.length, tasa_cambio: 36.5, pagos: null, vuelto: null,
    reembolso: { metodo: 'USD_EFECTIVO', monto_usd: 6 * codigos.length, monto_bs: null },
  });
}

describe('eliminarVentas', () => {
  it('elimina solo las elegidas: sus piezas vuelven al stock (las MISMAS) y las demás ventas quedan intactas', async () => {
    await entrada(P, accesorios, 10);
    const v1 = await vender(P, accesorios, 3);
    const v2 = await vender(P, accesorios, 2);
    expect(await stock(P, accesorios)).toBe(5);

    const r = await eliminarVentas(env, sA, [v1.id]);

    expect(r).toMatchObject({ ventas: 1, folios: [v1.folio], devoluciones: 0, piezas: 3, ventasSinPiezas: 0, simulado: false });
    expect(await stock(P, accesorios)).toBe(8);
    expect(await totalProducto(P)).toBe(8);
    expect(await vendidas()).toBe(2);
    const estados = await env.DB.prepare('SELECT codigo, estado FROM unidades_producto WHERE codigo IN (?, ?, ?)').bind(...v1.codigos).all<{ estado: string }>();
    expect(estados.results.every((u) => u.estado === 'DISPONIBLE')).toBe(true);
    const quedan = await listarVentas(env, sA, {});
    expect(quedan.map((v) => v.id)).toEqual([v2.id]);
  });

  it('la venta sale también de los reportes: se borran sus salidas de stock y las de las otras ventas se conservan', async () => {
    await entrada(P, accesorios, 10);
    const v1 = await vender(P, accesorios, 3);
    await vender(P, accesorios, 2);
    expect(await salidas(P)).toBe(2);

    await eliminarVentas(env, sA, [v1.id]);

    expect(await salidas(P)).toBe(1);
    const rastro = await una<{ motivo: string; unidad_codigos: string }>("SELECT motivo, unidad_codigos FROM movimientos_inventario WHERE motivo LIKE 'Eliminación%'");
    expect(rastro?.motivo).toContain(`#${String(v1.folio).padStart(4, '0')}`);
    expect(JSON.parse(rastro!.unidad_codigos).sort()).toEqual([...v1.codigos].sort());
  });

  it('con devolución: lo ya devuelto no se cuenta dos veces y la devolución también se borra', async () => {
    await entrada(P, accesorios, 6);
    const v = await vender(P, accesorios, 4);
    await devolver(v, P, v.codigos.slice(0, 1));
    expect(await stock(P, accesorios)).toBe(3);

    const r = await eliminarVentas(env, sA, [v.id]);

    expect(r).toMatchObject({ ventas: 1, devoluciones: 1, piezas: 3 });
    expect(await stock(P, accesorios)).toBe(6);
    expect(await vendidas()).toBe(0);
    expect(await listarDevoluciones(env, sA, {})).toEqual([]);
  });

  it('lo entregado a cambio también vuelve al stock y su salida se borra', async () => {
    await entrada(P, accesorios, 5);
    await entrada(Q, accesorios, 5);
    const v = await vender(P, accesorios, 1);
    const salida = await registrarMovimiento(env, sA, { productoId: Q, tipo: 'SALIDA', cantidad: 1, localId: accesorios, motivo: 'Cambio' });
    await devolver(v, P, v.codigos, [{ producto_id: Q, nombre: 'Cable', codigo_barras: '2000000000022', cantidad: 1, precio_unitario: 5, unidades: salida.unidadCodigos }]);
    expect(await stock(Q, accesorios)).toBe(4);

    await eliminarVentas(env, sA, [v.id]);

    expect([await stock(P, accesorios), await stock(Q, accesorios)]).toEqual([5, 5]);
    expect(await vendidas()).toBe(0);
    expect(await salidas(Q)).toBe(0);
  });

  it('cada pieza vuelve al local donde estaba, aunque se elijan ventas de dos locales', async () => {
    await entrada(P, accesorios, 3);
    await entrada(P, vidrios, 3);
    const a = await vender(P, accesorios, 2);
    const b = await vender(P, vidrios, 1, sA);

    await eliminarVentas(env, sG, [a.id, b.id]);

    expect([await stock(P, accesorios), await stock(P, vidrios)]).toEqual([3, 3]);
  });

  it('una venta anterior a los códigos por pieza se borra sin reponer nada y lo avisa', async () => {
    await entrada(P, accesorios, 3);
    const datos: NuevaVenta = {
      fecha: '2026-11-03T15:00:00.000Z', local_id: accesorios, cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567',
      metodo_pago: 'USD_EFECTIVO', pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 6, monto_bs: null }], vuelto: null, total: 6, tasa_cambio: 36.5, total_bs: null,
      items: [{ producto_id: P, nombre: 'Forro', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 6 }],
    };
    const v = await guardarVenta(env, sV, datos);

    const r = await eliminarVentas(env, sA, [v.id]);

    expect(r).toMatchObject({ ventas: 1, piezas: 0, ventasSinPiezas: 1 });
    expect(await contar('ventas')).toBe(0);
    expect(await stock(P, accesorios)).toBe(3);
  });

  it('simular solo cuenta: no cambia nada', async () => {
    await entrada(P, accesorios, 5);
    const v = await vender(P, accesorios, 2);

    const r = await eliminarVentas(env, sA, [v.id], { simular: true });

    expect(r).toMatchObject({ ventas: 1, piezas: 2, simulado: true });
    expect(await stock(P, accesorios)).toBe(3);
    expect(await vendidas()).toBe(2);
    expect(await contar('ventas')).toBe(1);
    expect(await salidas(P)).toBe(1);
  });

  it('un id que no existe se ignora, y repetir lo ya hecho no repone dos veces', async () => {
    await entrada(P, accesorios, 4);
    const v = await vender(P, accesorios, 2);

    expect(await eliminarVentas(env, sA, ['fantasma'])).toMatchObject({ ventas: 0, piezas: 0 });
    expect(await stock(P, accesorios)).toBe(2);

    await eliminarVentas(env, sA, [v.id]);
    expect(await eliminarVentas(env, sA, [v.id])).toMatchObject({ ventas: 0, piezas: 0 });
    expect(await stock(P, accesorios)).toBe(4);
  });

  it('pide entre 1 y 100 ventas', async () => {
    await rechazo(eliminarVentas(env, sA, []), 400);
    await rechazo(eliminarVentas(env, sA, Array.from({ length: 101 }, (_, i) => `id-${i}`)), 400);
  });

  it('el administrador y el gerente pueden; el encargado, el vendedor y el contador no (403) y no se cambia nada', async () => {
    await entrada(P, accesorios, 6);
    const v1 = await vender(P, accesorios, 1);
    const v2 = await vender(P, accesorios, 1);
    for (const s of [sE, sV, sC]) {
      await rechazo(eliminarVentas(env, s, [v1.id]), 403);
      await rechazo(eliminarVentas(env, s, [v1.id], { simular: true }), 403);
    }
    expect(await contar('ventas')).toBe(2);
    expect((await eliminarVentas(env, sG, [v1.id])).ventas).toBe(1);
    expect((await eliminarVentas(env, sA, [v2.id])).ventas).toBe(1);
    expect(await stock(P, accesorios)).toBe(6);
  });

  it('un gerente no toca ventas de un local suspendido (403 antes de cambiar nada)', async () => {
    await entrada(P, accesorios, 4);
    const v = await vender(P, accesorios, 2);
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();

    await rechazo(eliminarVentas(env, sG, [v.id]), 403);
    expect(await contar('ventas')).toBe(1);
    expect(await vendidas()).toBe(2);
  });
});
