// Venta EN ESPERA (Local Vidrios): el carrito se deja guardado como mercancía pendiente (sin tocar el stock, pero reservándolo),
// se retoma desde el POS y al cobrar se cierra en el MISMO lote que la venta. Quien cobra puede ser un vendedor.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearEspera, listarEspera, liberarEspera, reservadoPorEspera } from '../../src/server/servicios/espera';
import { registrarMovimientos } from '../../src/server/servicios/movimientos';
import { listarPendientes } from '../../src/server/servicios/pendientes';
import { guardarVenta } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { vidrios, accesorios } = IDS_LOCALES;
const P1 = 'p-vidrio-a';
const P2 = 'p-vidrio-b';
let admin: Sesion, vendedor: Sesion, otroVendedor: Sesion, vendedorAcc: Sesion, tecnico: Sesion;

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
  const sesionDe = async (rol: 'administrador' | 'vendedor' | 'tecnico', local: string | null, nombre: string) =>
    cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol, localId: local, nombre, clave: `Clave-${nombre.replace(/\s/g, '')}-123456` })));
  admin = await sesionDe('administrador', null, 'Ada Admin');
  vendedor = await sesionDe('vendedor', vidrios, 'Vera Vidrios');
  otroVendedor = await sesionDe('vendedor', vidrios, 'Otto Vidrios');
  vendedorAcc = await sesionDe('vendedor', accesorios, 'Alma Accesorios');
  tecnico = await sesionDe('tecnico', vidrios, 'Tito Tecnico');
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
});

const dejar = (s: Sesion, items: { producto_id: string; cantidad: number }[], extra: { promotor_nombre?: string; nota?: string } = {}) =>
  crearEspera(env, s, { localId: vidrios, items, ...extra });

const ventaDe = (espera_id: string | null, extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: vidrios,
  cliente_cedula: '',
  cliente_nombre: '',
  cliente_telefono: '',
  metodo_pago: 'USD_EFECTIVO',
  pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 24, monto_bs: null }],
  vuelto: null,
  total: 24,
  items: [{ producto_id: P1, nombre: 'Vidrio blindado A15', codigo_barras: '2000000000015', cantidad: 2, precio_unitario: 12 }],
  tasa_cambio: 40,
  total_bs: null,
  espera_id,
  ...extra,
});

describe('dejar el carrito en espera', () => {
  it('guarda los productos con su precio de catálogo, NO toca el stock y queda como mercancía pendiente', async () => {
    const e = await dejar(vendedor, [{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 1 }], { promotor_nombre: '  Pedro   Salas ', nota: 'viene en 10 min' });
    expect(e).toMatchObject({ tipo: 'MERCANCIA', estado: 'PENDIENTE', local_id: vidrios, monto_usd: 28, promotor_nombre: 'Pedro Salas', creado_por_nombre: 'Vera Vidrios' });
    expect(e.items).toEqual([
      { producto_id: P1, nombre: 'Vidrio blindado A15', codigo: expect.any(String), cantidad: 2, precio_unitario: 12 },
      { producto_id: P2, nombre: 'Hidrogel A15', codigo: expect.any(String), cantidad: 1, precio_unitario: 4 },
    ]);
    expect(e.descripcion).toContain('En espera: viene en 10 min');
    expect(await stock(P1)).toBe(10);
    expect(await stock(P2)).toBe(3);
    // Es la misma lista que Pendientes: la gerencia la ve ahí
    expect((await listarPendientes(env, admin, { estado: 'PENDIENTE', tipo: 'MERCANCIA' })).map((x) => x.id)).toContain(e.id);
  });

  it('otro vendedor del local ve la venta en espera; la de otro local no', async () => {
    const e = await dejar(vendedor, [{ producto_id: P1, cantidad: 1 }]);
    expect((await listarEspera(env, otroVendedor)).map((x) => x.id)).toEqual([e.id]);
    expect(await listarEspera(env, vendedorAcc)).toEqual([]);
  });

  it('reserva el stock: lo reservado no se puede volver a dejar en espera y sale en el resumen de reservas', async () => {
    await dejar(vendedor, [{ producto_id: P2, cantidad: 2 }]);
    expect((await reservadoPorEspera(env, vidrios)).get(P2)).toBe(2);
    await dejar(otroVendedor, [{ producto_id: P2, cantidad: 1 }]); // queda 1 sin reservar: alcanza
    await rechazo(dejar(otroVendedor, [{ producto_id: P2, cantidad: 1 }]), 409, 'stock_insuficiente');
    expect(await stock(P2)).toBe(3);
  });

  it('rechaza un carrito vacío, cantidades inválidas, productos que no existen y textos demasiado largos', async () => {
    await rechazo(dejar(vendedor, []), 400);
    await rechazo(dejar(vendedor, [{ producto_id: P1, cantidad: 0 }]), 400);
    await rechazo(dejar(vendedor, [{ producto_id: 'no-existe', cantidad: 1 }]), 400);
    await rechazo(dejar(vendedor, [{ producto_id: P1, cantidad: 1 }], { promotor_nombre: 'x'.repeat(81) }), 400);
    await rechazo(dejar(vendedor, [{ producto_id: P1, cantidad: 1 }], { nota: 'x'.repeat(201) }), 400);
    expect(await listarEspera(env, vendedor)).toEqual([]);
  });

  it('solo en el Local Vidrios; el técnico no puede; un local ajeno da 403', async () => {
    await rechazo(crearEspera(env, vendedorAcc, { localId: accesorios, items: [{ producto_id: P1, cantidad: 1 }] }), 400, 'solo_vidrios');
    await rechazo(crearEspera(env, tecnico, { localId: vidrios, items: [{ producto_id: P1, cantidad: 1 }] }), 403);
    await rechazo(crearEspera(env, vendedorAcc, { localId: vidrios, items: [{ producto_id: P1, cantidad: 1 }] }), 403);
    await rechazo(listarEspera(env, tecnico), 403);
  });
});

describe('liberar una venta en espera', () => {
  it('deja de reservar el stock y sale de la lista; no mueve inventario; no se libera dos veces', async () => {
    const e = await dejar(vendedor, [{ producto_id: P1, cantidad: 4 }]);
    expect((await reservadoPorEspera(env, vidrios)).get(P1)).toBe(4);
    await liberarEspera(env, otroVendedor, e.id);
    expect((await reservadoPorEspera(env, vidrios)).get(P1)).toBeUndefined();
    expect(await listarEspera(env, vendedor)).toEqual([]);
    expect(await stock(P1)).toBe(10);
    await rechazo(liberarEspera(env, vendedor, e.id), 409, 'espera_cerrada');
  });

  it('un id desconocido o de otro local responde 404 (no se pueden tantear ids)', async () => {
    const e = await dejar(vendedor, [{ producto_id: P1, cantidad: 1 }]);
    await rechazo(liberarEspera(env, vendedor, 'no-existe'), 404);
    await rechazo(liberarEspera(env, vendedorAcc, e.id), 404);
    await rechazo(liberarEspera(env, tecnico, e.id), 403);
  });
});

describe('cobrar una venta en espera', () => {
  it('la venta cierra la espera en el mismo lote (con el folio) y no mueve el stock otra vez', async () => {
    const e = await dejar(vendedor, [{ producto_id: P1, cantidad: 2 }]);
    const venta = await guardarVenta(env, otroVendedor, ventaDe(e.id));
    const cerrada = (await listarPendientes(env, admin, { tipo: 'MERCANCIA' })).find((x) => x.id === e.id)!;
    expect(cerrada).toMatchObject({ estado: 'PAGADO', venta_id: venta.id, venta_folio: venta.folio, cerrado_por_nombre: 'Otto Vidrios' });
    expect(cerrada.nota_cierre).toBe(`Cobrada en la venta #${venta.folio}`);
    expect(await listarEspera(env, vendedor)).toEqual([]);
    expect(await stock(P1)).toBe(10); // guardarVenta solo registra la venta: el stock lo mueve el POS aparte
  });

  it('una espera ya cobrada, liberada, inexistente o de otro local no se puede volver a cobrar', async () => {
    const e = await dejar(vendedor, [{ producto_id: P1, cantidad: 2 }]);
    await guardarVenta(env, vendedor, ventaDe(e.id));
    await rechazo(guardarVenta(env, vendedor, ventaDe(e.id)), 409, 'espera_cerrada');
    const l = await dejar(vendedor, [{ producto_id: P1, cantidad: 1 }]);
    await liberarEspera(env, vendedor, l.id);
    await rechazo(guardarVenta(env, vendedor, ventaDe(l.id)), 409, 'espera_cerrada');
    await rechazo(guardarVenta(env, vendedor, ventaDe('no-existe')), 409, 'espera_cerrada');
  });

  it('una venta normal (sin espera) no toca las esperas abiertas', async () => {
    const e = await dejar(vendedor, [{ producto_id: P1, cantidad: 2 }]);
    await guardarVenta(env, vendedor, ventaDe(null));
    expect((await listarEspera(env, vendedor)).map((x) => x.id)).toEqual([e.id]);
  });
});
