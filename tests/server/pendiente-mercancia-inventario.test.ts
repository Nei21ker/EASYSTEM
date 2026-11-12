// Mercancía que se llevó un promotor con productos del inventario (migración 0024): quedan EN ESPERA (el stock no se toca) y
// al marcar el pendiente como pagado se descuentan del inventario del local; si no alcanza el stock, no se cierra.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { registrarMovimientos } from '../../src/server/servicios/movimientos';
import { cerrarPendiente, crearPendienteMercancia, listarPendientes } from '../../src/server/servicios/pendientes';
import { crearPromotor } from '../../src/server/servicios/promotores';

const env = crearEntornoDePrueba();
const { vidrios } = IDS_LOCALES;
const P1 = 'p-vidrio-a';
const P2 = 'p-vidrio-b';
let admin: Sesion, encargado: Sesion;
let promotorId: string;

async function stock(productoId: string): Promise<number> {
  const f = await env.DB.prepare('SELECT stock_actual AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?').bind(productoId, vidrios).first<{ s: number }>();
  return f?.s ?? 0;
}
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
  const uEnc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Vidrios', clave: 'Clave-encargado-vidrios-123' });
  admin = await cargarSesion(env, peticionComo(uAdmin));
  encargado = await cargarSesion(env, peticionComo(uEnc));
  await env.DB
    .prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo, prefijo_codigo) VALUES (?, '2000000000015', 'Vidrio blindado A15', 'Vidrios Templados', 2, 12, 0, 'VID')")
    .bind(P1)
    .run();
  await env.DB
    .prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo, prefijo_codigo) VALUES (?, '2000000000022', 'Hidrogel A15', 'Hidrogel', 1, 4, 0, 'HID')")
    .bind(P2)
    .run();
  await registrarMovimientos(env, admin, [
    { productoId: P1, tipo: 'ENTRADA', cantidad: 10, localId: vidrios },
    { productoId: P2, tipo: 'ENTRADA', cantidad: 3, localId: vidrios },
  ]);
  promotorId = (await crearPromotor(env, admin, { cedula: 'V-11111111', nombre: 'Pedro', apellido: 'Promotor', telefono: null, banco: 'Banesco' })).id;
});

const anotar = (items: { producto_id: string; cantidad: number }[], descripcion = '', monto = 30) =>
  crearPendienteMercancia(env, encargado, { localId: vidrios, promotorId, descripcion, items, monto_usd: monto });

describe('mercancía pendiente con productos del inventario', () => {
  it('anotarla guarda los productos (nombre y precio de hoy) y NO toca el stock', async () => {
    const p = await anotar([{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 1 }], 'más lo que falte');
    expect(p.items).toEqual([
      { producto_id: P1, nombre: 'Vidrio blindado A15', codigo: expect.any(String), cantidad: 2, precio_unitario: 12 },
      { producto_id: P2, nombre: 'Hidrogel A15', codigo: expect.any(String), cantidad: 1, precio_unitario: 4 },
    ]);
    expect(p.descripcion).toBe('2 × Vidrio blindado A15, 1 × Hidrogel A15 · más lo que falte');
    expect(await stock(P1)).toBe(10);
    expect(await stock(P2)).toBe(3);
    const lista = await listarPendientes(env, encargado, {});
    expect(lista[0].items?.length).toBe(2);
  });

  it('suma los productos repetidos y rechaza cantidades inválidas o productos que no existen', async () => {
    const p = await anotar([{ producto_id: P1, cantidad: 2 }, { producto_id: P1, cantidad: 3 }]);
    expect(p.items).toHaveLength(1);
    expect(p.items![0].cantidad).toBe(5);
    await rechazo(anotar([{ producto_id: P1, cantidad: 0 }]), 400, 'datos_invalidos');
    await rechazo(anotar([{ producto_id: P1, cantidad: 1.5 }]), 400, 'datos_invalidos');
    await rechazo(anotar([{ producto_id: 'no-existe', cantidad: 1 }]), 400, 'datos_invalidos');
    await rechazo(anotar([], ''), 400, 'datos_invalidos');
  });

  it('un pendiente solo de texto sigue funcionando (sin items)', async () => {
    const p = await anotar([], '10 vidrios que no están cargados');
    expect(p.items ?? null).toBeNull();
    const cerrado = await cerrarPendiente(env, encargado, p.id, 'pagar', null);
    expect(cerrado.estado).toBe('PAGADO');
    expect(await stock(P1)).toBe(10);
  });

  it('marcarla cobrada descuenta del inventario del local (una SALIDA por producto)', async () => {
    const p = await anotar([{ producto_id: P1, cantidad: 4 }, { producto_id: P2, cantidad: 3 }]);
    const cerrado = await cerrarPendiente(env, encargado, p.id, 'pagar', 'pagó en efectivo');
    expect(cerrado.estado).toBe('PAGADO');
    expect(await stock(P1)).toBe(6);
    expect(await stock(P2)).toBe(0);
    const movs = await env.DB.prepare("SELECT producto_id, tipo, cantidad, motivo FROM movimientos_inventario WHERE tipo = 'SALIDA' ORDER BY producto_id").all<{ producto_id: string; tipo: string; cantidad: number; motivo: string }>();
    expect(movs.results).toHaveLength(2);
    expect(movs.results[0].motivo).toContain('Mercancía de promotor cobrada');
    const unidadesDisp = await env.DB.prepare("SELECT COUNT(*) AS n FROM unidades_producto WHERE producto_id = ? AND estado = 'DISPONIBLE'").bind(P1).first<{ n: number }>();
    expect(unidadesDisp!.n).toBe(6);
  });

  it('sin stock suficiente NO se marca cobrada: sigue pendiente y no se mueve nada', async () => {
    const p = await anotar([{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 5 }]);
    await rechazo(cerrarPendiente(env, encargado, p.id, 'pagar', null), 409, 'stock_insuficiente');
    expect(await stock(P1)).toBe(10);
    expect(await stock(P2)).toBe(3);
    const [despues] = await listarPendientes(env, encargado, { estado: 'PENDIENTE' });
    expect(despues.id).toBe(p.id);
    // al ingresar la mercancía que faltaba, ya se puede cobrar
    await registrarMovimientos(env, admin, [{ productoId: P2, tipo: 'ENTRADA', cantidad: 2, localId: vidrios }]);
    expect((await cerrarPendiente(env, encargado, p.id, 'pagar', null)).estado).toBe('PAGADO');
    expect(await stock(P2)).toBe(0);
  });

  it('anularla no descuenta nada y cobrar dos veces no descuenta dos veces', async () => {
    const a = await anotar([{ producto_id: P1, cantidad: 2 }]);
    await cerrarPendiente(env, encargado, a.id, 'anular', null);
    expect(await stock(P1)).toBe(10);
    const b = await anotar([{ producto_id: P1, cantidad: 2 }]);
    await cerrarPendiente(env, encargado, b.id, 'pagar', null);
    await rechazo(cerrarPendiente(env, encargado, b.id, 'pagar', null), 409);
    expect(await stock(P1)).toBe(8);
  });
});
