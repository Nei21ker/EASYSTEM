import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto } from '../../src/server/servicios/catalogo';
import { registrarMovimiento } from '../../src/server/servicios/movimientos';
import { darDeBaja } from '../../src/server/servicios/traslados';
import { guardarVenta, listarVentas, resetearReportes } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios } = IDS_LOCALES;

let sA: Sesion, sG: Sesion, sE: Sesion, sV: Sesion, sC: Sesion, P: string;
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
});

const una = <T>(sql: string, ...v: unknown[]) => env.DB.prepare(sql).bind(...v).first<T>();
const contar = async (tabla: string, donde = '1=1') => (await una<{ n: number }>(`SELECT count(*) AS n FROM ${tabla} WHERE ${donde}`))!.n;
const stock = async () => (await una<{ s: number }>('SELECT stock_actual AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?', P, accesorios))?.s ?? 0;

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

/** Una compra de 10, una venta de 3 (con su registro) y una baja de 1: deja movimientos de varios tipos. */
async function escenario(): Promise<void> {
  const { unidadCodigos: compradas } = await registrarMovimiento(env, sA, { productoId: P, tipo: 'ENTRADA', cantidad: 10, localId: accesorios, motivo: 'Compra' });
  const { unidadCodigos } = await registrarMovimiento(env, sV, { productoId: P, tipo: 'SALIDA', cantidad: 3, localId: accesorios, motivo: 'Venta POS' });
  const datos: NuevaVenta = {
    fecha: '2026-11-03T15:00:00.000Z', local_id: accesorios, cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567',
    metodo_pago: 'USD_EFECTIVO', pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 18, monto_bs: null }], vuelto: null, total: 18,
    items: [{ producto_id: P, nombre: 'Forro', codigo_barras: '2000000000015', cantidad: 3, precio_unitario: 6, unidades: unidadCodigos }], tasa_cambio: 36.5, total_bs: null,
  };
  await guardarVenta(env, sV, datos);
  await darDeBaja(env, sA, { localId: accesorios, codigos: [compradas[9]], motivo: 'DANADA' });
}

describe('resetearReportes', () => {
  it('borra las ventas y los movimientos de compra y venta que alimentan los reportes, sin tocar el stock ni las piezas', async () => {
    await escenario();
    expect(await stock()).toBe(6);

    const r = await resetearReportes(env, sA);

    expect(r).toMatchObject({ ventas: 1, devoluciones: 0, movimientos: 2, simulado: false });
    expect(await contar('ventas')).toBe(0);
    expect(await contar('movimientos_inventario', "tipo IN ('ENTRADA','SALIDA')")).toBe(0);
    expect(await listarVentas(env, sA, {})).toEqual([]);
    // El stock real no cambia: las 3 piezas siguen vendidas y la dada de baja sigue en baja
    expect(await stock()).toBe(6);
    expect(await contar('unidades_producto', "estado = 'VENDIDA'")).toBe(3);
    expect(await contar('unidades_producto', "estado = 'BAJA'")).toBe(1);
  });

  it('conserva el historial de bajas y traslados (los reportes no lo cuentan)', async () => {
    await escenario();
    await resetearReportes(env, sA);
    expect(await contar('movimientos_inventario', "tipo = 'BAJA'")).toBe(1);
  });

  it('con simular solo cuenta, sin cambiar nada', async () => {
    await escenario();
    const r = await resetearReportes(env, sA, { simular: true });
    expect(r).toMatchObject({ ventas: 1, devoluciones: 0, movimientos: 2, simulado: true });
    expect(await contar('ventas')).toBe(1);
    expect(await contar('movimientos_inventario', "tipo IN ('ENTRADA','SALIDA')")).toBe(2);
  });

  it('sube la versión de las pantallas en vivo para que se actualicen solas', async () => {
    await escenario();
    const antes = (await una<{ v: number }>("SELECT COALESCE(SUM(version),0) AS v FROM cambios WHERE tabla IN ('ventas','movimientos_inventario')"))!.v;
    await resetearReportes(env, sA);
    const despues = (await una<{ v: number }>("SELECT COALESCE(SUM(version),0) AS v FROM cambios WHERE tabla IN ('ventas','movimientos_inventario')"))!.v;
    expect(despues).toBeGreaterThan(antes);
  });

  it('sin nada que borrar no falla', async () => {
    expect(await resetearReportes(env, sA)).toMatchObject({ ventas: 0, devoluciones: 0, movimientos: 0 });
  });

  it('solo el administrador: gerente, encargado, vendedor y contador reciben 403 (también al simular)', async () => {
    await escenario();
    for (const s of [sG, sE, sV, sC]) {
      await rechazo(resetearReportes(env, s), 403);
      await rechazo(resetearReportes(env, s, { simular: true }), 403);
    }
    expect(await contar('ventas')).toBe(1);
  });
});
