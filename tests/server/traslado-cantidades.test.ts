// Traslados entre locales de productos por cantidad (vidrios sencillos, sin código por pieza; migración 0027): despachar, recibir total o
// parcial, cerrar (lo que no llegó vuelve al origen) y mezcla con piezas que sí tienen código.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { registrarMovimientos } from '../../src/server/servicios/movimientos';
import { cerrarTraslado, despacharTraslado, listarTraslados, recibirTraslado } from '../../src/server/servicios/traslados';

const env = crearEntornoDePrueba();
const { vidrios, accesorios } = IDS_LOCALES;
const C = 'p-sencillo-c'; // por cantidad
const D = 'p-sencillo-d'; // por cantidad
const A = 'p-vidrio-a'; // con etiqueta

let admin: Sesion, encVidrios: Sesion, encAccesorios: Sesion, vendedor: Sesion;
const sesionDe = (u: UsuarioDePrueba) => cargarSesion(env, peticionComo(u));

const stock = async (productoId: string, local: string) =>
  (await env.DB.prepare('SELECT stock_actual AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?').bind(productoId, local).first<{ s: number }>())?.s ?? 0;

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
  const uEV = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Vidrios', clave: 'Clave-encargado-vidrios-123' });
  const uEA = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, nombre: 'Ema Accesorios', clave: 'Clave-encargado-accesorios-123' });
  const uV = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios, nombre: 'Vera Vendedora', clave: 'Clave-vendedor-vidrios-123' });
  [admin, encVidrios, encAccesorios, vendedor] = await Promise.all([uAdmin, uEV, uEA, uV].map(sesionDe));
  const insertar = (id: string, codigo: string, nombre: string, prefijo: string, precio: number, porCantidad: number) =>
    env.DB
      .prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo, prefijo_codigo, control_por_cantidad) VALUES (?, ?, ?, 'Vidrios Templados', 0, ?, 0, ?, ?)")
      .bind(id, codigo, nombre, precio, prefijo, porCantidad)
      .run();
  await insertar(C, '2000000000039', 'Vidrio sencillo Moto G14', 'VSM', 1, 1);
  await insertar(D, '2000000000046', 'Vidrio sencillo Tecno Spark', 'VST', 1, 1);
  await insertar(A, '2000000000015', 'Vidrio blindado Samsung A15', 'VID', 5, 0);
  await registrarMovimientos(env, admin, [
    { productoId: C, tipo: 'ENTRADA', cantidad: 20, localId: vidrios },
    { productoId: D, tipo: 'ENTRADA', cantidad: 6, localId: vidrios },
    { productoId: A, tipo: 'ENTRADA', cantidad: 3, localId: vidrios },
  ]);
});

const despachar = (cantidades: { producto_id: string; cantidad: number }[], extra: Record<string, unknown> = {}) =>
  despacharTraslado(env, admin, { origenLocalId: vidrios, destinoLocalId: accesorios, codigos: [], cantidades, ...extra });

describe('despachar por cantidad', () => {
  it('sale del stock del origen y queda en tránsito; el destino aún no tiene nada', async () => {
    const t = await despachar([{ producto_id: C, cantidad: 8 }, { producto_id: D, cantidad: 2 }], { notas: 'Pedido de Barquicenter' });
    expect(t).toMatchObject({ estado: 'EN_TRANSITO', notas: 'Pedido de Barquicenter', unidades: [] });
    expect(t.cantidades).toEqual([
      { producto_id: C, producto_nombre: 'Vidrio sencillo Moto G14', cantidad: 8, recibida: 0, devuelta: 0 },
      { producto_id: D, producto_nombre: 'Vidrio sencillo Tecno Spark', cantidad: 2, recibida: 0, devuelta: 0 },
    ]);
    expect(await stock(C, vidrios)).toBe(12);
    expect(await stock(D, vidrios)).toBe(4);
    expect(await stock(C, accesorios)).toBe(0);
    const mov = await env.DB.prepare("SELECT tipo, cantidad, motivo, unidad_codigos FROM movimientos_inventario WHERE producto_id = ? AND tipo = 'TRASLADO_SALIDA'").bind(C).first<{ tipo: string; cantidad: number; motivo: string; unidad_codigos: string | null }>();
    expect(mov).toMatchObject({ cantidad: 8, unidad_codigos: null });
    expect(mov!.motivo).toMatch(/^Traslado #0001/);
  });

  it('se puede mezclar con piezas que sí tienen código, en el mismo traslado', async () => {
    const piezas = (await env.DB.prepare("SELECT codigo FROM unidades_producto WHERE producto_id = ? ORDER BY codigo").bind(A).all<{ codigo: string }>()).results.map((f) => f.codigo);
    const t = await despachar([{ producto_id: C, cantidad: 5 }], { codigos: piezas.slice(0, 2) });
    expect(t.unidades).toHaveLength(2);
    expect(t.cantidades).toHaveLength(1);
  });

  it('valida: stock, producto con etiqueta, cantidades inválidas, repetidos y que haya algo que mandar', async () => {
    await rechazo(despachar([{ producto_id: C, cantidad: 21 }]), 409, 'stock_insuficiente');
    await rechazo(despachar([{ producto_id: A, cantidad: 1 }]), 400, 'no_es_por_cantidad');
    await rechazo(despachar([{ producto_id: C, cantidad: 0 }]), 400);
    await rechazo(despachar([{ producto_id: C, cantidad: 1.5 }]), 400);
    await rechazo(despachar([{ producto_id: C, cantidad: 1 }, { producto_id: C, cantidad: 2 }]), 400);
    await rechazo(despachar([{ producto_id: 'no-existe', cantidad: 1 }]), 404);
    await rechazo(despachar([]), 400);
    expect(await stock(C, vidrios)).toBe(20);
    expect((await listarTraslados(env, admin)).length).toBe(0);
  });

  it('el vendedor no puede y el encargado solo despacha desde su local', async () => {
    await rechazo(despacharTraslado(env, vendedor, { origenLocalId: vidrios, destinoLocalId: accesorios, codigos: [], cantidades: [{ producto_id: C, cantidad: 1 }] }), 403);
    await rechazo(despacharTraslado(env, encAccesorios, { origenLocalId: vidrios, destinoLocalId: accesorios, codigos: [], cantidades: [{ producto_id: C, cantidad: 1 }] }), 403);
    const t = await despacharTraslado(env, encVidrios, { origenLocalId: vidrios, destinoLocalId: accesorios, codigos: [], cantidades: [{ producto_id: C, cantidad: 1 }] });
    expect(t.estado).toBe('EN_TRANSITO');
  });
});

describe('recibir y cerrar por cantidad', () => {
  it('recibir todo cierra el traslado y suma al stock del destino', async () => {
    const t = await despachar([{ producto_id: C, cantidad: 8 }]);
    const r = await recibirTraslado(env, encAccesorios, t.id, [], [{ producto_id: C, cantidad: 8 }]);
    expect(r).toMatchObject({ estado: 'RECIBIDO', recibido_por: 'Ema Accesorios' });
    expect(r.cantidades![0]).toMatchObject({ cantidad: 8, recibida: 8, devuelta: 0 });
    expect(await stock(C, accesorios)).toBe(8);
    expect(await stock(C, vidrios)).toBe(12);
  });

  it('recibir una parte lo deja en tránsito; no se puede recibir más de lo que queda', async () => {
    const t = await despachar([{ producto_id: C, cantidad: 8 }]);
    const r = await recibirTraslado(env, encAccesorios, t.id, [], [{ producto_id: C, cantidad: 5 }]);
    expect(r.estado).toBe('EN_TRANSITO');
    expect(r.cantidades![0].recibida).toBe(5);
    expect(await stock(C, accesorios)).toBe(5);
    await rechazo(recibirTraslado(env, encAccesorios, t.id, [], [{ producto_id: C, cantidad: 4 }]), 409);
    expect(await stock(C, accesorios)).toBe(5);
    const fin = await recibirTraslado(env, encAccesorios, t.id, [], [{ producto_id: C, cantidad: 3 }]);
    expect(fin.estado).toBe('RECIBIDO');
    await rechazo(recibirTraslado(env, encAccesorios, t.id, [], [{ producto_id: C, cantidad: 1 }]), 409, 'traslado_cerrado');
  });

  it('solo el local de destino recibe y el producto debe ser del traslado', async () => {
    const t = await despachar([{ producto_id: C, cantidad: 4 }]);
    await rechazo(recibirTraslado(env, encVidrios, t.id, [], [{ producto_id: C, cantidad: 1 }]), 403);
    await rechazo(recibirTraslado(env, encAccesorios, t.id, [], [{ producto_id: D, cantidad: 1 }]), 400);
    await rechazo(recibirTraslado(env, encAccesorios, t.id, [], []), 400);
  });

  it('cerrar devuelve al origen lo que no llegó; sin recibir nada queda ANULADO', async () => {
    const t = await despachar([{ producto_id: C, cantidad: 8 }, { producto_id: D, cantidad: 3 }]);
    await recibirTraslado(env, encAccesorios, t.id, [], [{ producto_id: C, cantidad: 5 }]);
    const c = await cerrarTraslado(env, encVidrios, t.id);
    expect(c.estado).toBe('RECIBIDO');
    expect(c.cantidades!.find((x) => x.producto_id === C)).toMatchObject({ recibida: 5, devuelta: 3 });
    expect(c.cantidades!.find((x) => x.producto_id === D)).toMatchObject({ recibida: 0, devuelta: 3 });
    expect(await stock(C, vidrios)).toBe(15);
    expect(await stock(D, vidrios)).toBe(6);
    expect(await stock(C, accesorios)).toBe(5);

    const t2 = await despachar([{ producto_id: C, cantidad: 2 }]);
    expect((await cerrarTraslado(env, admin, t2.id)).estado).toBe('ANULADO');
    expect(await stock(C, vidrios)).toBe(15);
  });

  it('un traslado mezclado se cierra cuando llegó todo, piezas y cantidades', async () => {
    const piezas = (await env.DB.prepare('SELECT codigo FROM unidades_producto WHERE producto_id = ? ORDER BY codigo').bind(A).all<{ codigo: string }>()).results.map((f) => f.codigo);
    const t = await despachar([{ producto_id: C, cantidad: 4 }], { codigos: piezas.slice(0, 2) });
    expect((await recibirTraslado(env, encAccesorios, t.id, piezas.slice(0, 2), [])).estado).toBe('EN_TRANSITO');
    expect((await recibirTraslado(env, encAccesorios, t.id, [], [{ producto_id: C, cantidad: 4 }])).estado).toBe('RECIBIDO');
    expect(await stock(A, accesorios)).toBe(2);
    expect(await stock(C, accesorios)).toBe(4);
  });
});
