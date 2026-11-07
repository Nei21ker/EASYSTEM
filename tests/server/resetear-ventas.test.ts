import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto } from '../../src/server/servicios/catalogo';
import { registrarMovimiento } from '../../src/server/servicios/movimientos';
import { guardarDevolucion, guardarVenta, listarDevoluciones, listarVentas, resetearVentas } from '../../src/server/servicios/ventas';
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

const una = <T>(sql: string, ...v: unknown[]) => env.DB.prepare(sql).bind(...v).first<T>();
const stock = async (productoId: string, localId: string) =>
  (await una<{ s: number }>('SELECT stock_actual AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?', productoId, localId))?.s ?? 0;
const totalProducto = async (productoId: string) => (await una<{ s: number }>('SELECT stock_actual AS s FROM productos WHERE id = ?', productoId))!.s;
const contar = async (tabla: string) => (await una<{ n: number }>(`SELECT count(*) AS n FROM ${tabla}`))!.n;
const vendidas = async () => (await una<{ n: number }>("SELECT count(*) AS n FROM unidades_producto WHERE estado = 'VENDIDA'"))!.n;

const entrada = async (productoId: string, localId: string, cantidad: number) =>
  (await registrarMovimiento(env, sA, { productoId, tipo: 'ENTRADA', cantidad, localId, motivo: 'Compra' })).unidadCodigos;

/** Vende de verdad: la salida de stock (con sus piezas) y el registro de la venta, como hace el punto de venta. */
async function vender(productoId: string, localId: string, cantidad: number, sesion: Sesion = sV): Promise<{ id: string; folio: number; codigos: string[] }> {
  const { unidadCodigos } = await registrarMovimiento(env, sesion, { productoId, tipo: 'SALIDA', cantidad, localId, motivo: 'Venta POS' });
  // Se cobra el precio de catálogo del producto (el servidor rechaza cualquier otro precio sin autorización de un supervisor)
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

describe('resetearVentas', () => {
  it('borra las ventas y las piezas vendidas vuelven al stock (el de antes de vender)', async () => {
    await entrada(P, accesorios, 10);
    await entrada(Q, accesorios, 4);
    await vender(P, accesorios, 3);
    await vender(P, accesorios, 2);
    await vender(Q, accesorios, 1);
    expect([await stock(P, accesorios), await stock(Q, accesorios)]).toEqual([5, 3]);

    const r = await resetearVentas(env, sA);

    expect(r).toMatchObject({ ventas: 3, devoluciones: 0, piezas: 6, simulado: false });
    expect([await stock(P, accesorios), await stock(Q, accesorios)]).toEqual([10, 4]);
    expect([await totalProducto(P), await totalProducto(Q)]).toEqual([10, 4]);
    expect(await vendidas()).toBe(0);
    expect(await contar('ventas')).toBe(0);
    expect(await listarVentas(env, sA, {})).toEqual([]);
  });

  it('también borra las devoluciones, y lo ya devuelto no se cuenta dos veces', async () => {
    await entrada(P, accesorios, 6);
    const v = await vender(P, accesorios, 4);
    await devolver(v, P, v.codigos.slice(0, 1));
    expect(await stock(P, accesorios)).toBe(3);

    const r = await resetearVentas(env, sA);

    expect(r).toMatchObject({ ventas: 1, devoluciones: 1, piezas: 3 });
    expect(await stock(P, accesorios)).toBe(6);
    expect(await vendidas()).toBe(0);
    expect(await contar('devoluciones')).toBe(0);
    expect(await listarDevoluciones(env, sA, {})).toEqual([]);
  });

  it('un cambio (producto entregado a cambio) también vuelve al stock', async () => {
    await entrada(P, accesorios, 5);
    await entrada(Q, accesorios, 5);
    const v = await vender(P, accesorios, 1);
    const salida = await registrarMovimiento(env, sA, { productoId: Q, tipo: 'SALIDA', cantidad: 1, localId: accesorios, motivo: 'Cambio' });
    await devolver(v, P, v.codigos, [{ producto_id: Q, nombre: 'Cable', codigo_barras: '2000000000022', cantidad: 1, precio_unitario: 5, unidades: salida.unidadCodigos }]);
    expect([await stock(P, accesorios), await stock(Q, accesorios)]).toEqual([5, 4]);

    await resetearVentas(env, sA);

    expect([await stock(P, accesorios), await stock(Q, accesorios)]).toEqual([5, 5]);
    expect(await vendidas()).toBe(0);
  });

  it('cada pieza vuelve al local donde estaba', async () => {
    await entrada(P, accesorios, 3);
    await entrada(P, vidrios, 3);
    await vender(P, accesorios, 2);
    await vender(P, vidrios, 1, sA);

    await resetearVentas(env, sA);

    expect([await stock(P, accesorios), await stock(P, vidrios)]).toEqual([3, 3]);
  });

  it('con miles de piezas lo hace por tramos y todas vuelven', async () => {
    await entrada(P, accesorios, 260);
    await entrada(P, accesorios, 260);
    await vender(P, accesorios, 260);
    await vender(P, accesorios, 260);
    expect(await stock(P, accesorios)).toBe(0);

    const r = await resetearVentas(env, sA);

    expect(r.piezas).toBe(520);
    expect(await stock(P, accesorios)).toBe(520);
    expect(await vendidas()).toBe(0);
  });

  it('deja un movimiento de entrada que explica el reseteo', async () => {
    await entrada(P, accesorios, 3);
    await vender(P, accesorios, 2);
    await resetearVentas(env, sA);
    const m = await una<{ motivo: string; tipo: string }>("SELECT motivo, tipo FROM movimientos_inventario WHERE motivo LIKE 'Reseteo de ventas%'");
    expect(m).toMatchObject({ tipo: 'ENTRADA' });
    expect(m!.motivo).toMatch(/Reseteo de ventas/);
  });

  it('simular cuenta lo que haría sin tocar nada', async () => {
    await entrada(P, accesorios, 5);
    const v = await vender(P, accesorios, 3);
    await devolver(v, P, v.codigos.slice(0, 1));

    const r = await resetearVentas(env, sA, { simular: true });

    expect(r).toMatchObject({ ventas: 1, devoluciones: 1, piezas: 2, simulado: true });
    expect(await stock(P, accesorios)).toBe(3);
    expect(await contar('ventas')).toBe(1);
    expect(await contar('devoluciones')).toBe(1);
  });

  it('sin ventas no hace nada y repetirlo no daña el stock', async () => {
    await entrada(P, accesorios, 4);
    await vender(P, accesorios, 2);
    await resetearVentas(env, sA);
    const otra = await resetearVentas(env, sA);
    expect(otra).toMatchObject({ ventas: 0, devoluciones: 0, piezas: 0 });
    expect(await stock(P, accesorios)).toBe(4);
  });

  it('una pieza vendida que NO es de una venta registrada (p. ej. un repuesto) no se toca', async () => {
    await entrada(P, accesorios, 4);
    await vender(P, accesorios, 1);
    await registrarMovimiento(env, sE, { productoId: P, tipo: 'SALIDA', cantidad: 1, localId: accesorios, motivo: 'Repuesto, orden de servicio #1' });
    await resetearVentas(env, sA);
    expect(await stock(P, accesorios)).toBe(3);
    expect(await vendidas()).toBe(1);
  });

  it('solo el administrador: el gerente, el encargado, el vendedor y el contador reciben 403 y no cambia nada', async () => {
    await entrada(P, accesorios, 4);
    await vender(P, accesorios, 2);
    for (const s of [sG, sE, sV, sC]) {
      await rechazo(resetearVentas(env, s), 403);
      await rechazo(resetearVentas(env, s, { simular: true }), 403);
    }
    expect(await contar('ventas')).toBe(1);
    expect(await stock(P, accesorios)).toBe(2);
  });
});
