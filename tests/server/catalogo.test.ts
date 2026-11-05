import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import {
  actualizarProducto, asegurarEnLocal, crearModelo, crearProducto, crearProductosLote, eliminarModelo, eliminarProducto,
  establecerCompatibilidades, fijarMinimosLote, listarLocalesVisibles, listarModelos, listarProductos, listarStockBajo,
  obtenerProductoPorCodigo, obtenerProductoPorId, reemplazarCompatibilidadesLote,
} from '../../src/server/servicios/catalogo';
import { obtenerUltimaTasa, registrarTasa } from '../../src/server/servicios/tasas';

const env = crearEntornoDePrueba();
const { accesorios, vidrios, servicio } = IDS_LOCALES;

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargado: UsuarioDePrueba, vendedor: UsuarioDePrueba, tecnico: UsuarioDePrueba, contador: UsuarioDePrueba;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  tecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: servicio });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
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

const forro = { codigo_barras: '2000000000015', nombre: 'Forro iPhone 11', categoria: 'Forros', precio_venta: 6, precio_compra: 2 };
const entrada = (productoId: string, localId: string, cantidad: number) =>
  env.DB.prepare("INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, local_id) VALUES (?, ?, 'ENTRADA', ?, ?)").bind(crypto.randomUUID(), productoId, cantidad, localId).run();
const modelo = async (marca: string, nombre: string) => (await crearModelo(env, await sesionDe(admin), { marca, modelo: nombre })).id;

describe('crear, editar y eliminar productos', () => {
  it.each([['administrador'], ['gerente'], ['encargado']] as const)('el %s crea productos', async (quien) => {
    const actor = { administrador: admin, gerente, encargado }[quien];
    const creado = await crearProducto(env, await sesionDe(actor), { ...forro, codigo_barras: `20000000${quien.length}0015` });
    expect(creado).toMatchObject({ nombre: 'Forro iPhone 11', categoria: 'Forros', precio_venta: 6, stock_actual: 0 });
    expect(creado.id).toBeTruthy();
  });

  it.each([['vendedor'], ['tecnico'], ['contador']] as const)('el %s no crea productos (403)', async (quien) => {
    await rechazo(crearProducto(env, await sesionDe({ vendedor, tecnico, contador }[quien]), forro), 403);
  });

  it('el encargado no fija el precio de compra: se guarda en 0 al crear y se ignora al editar', async () => {
    const e = await sesionDe(encargado);
    const creado = await crearProducto(env, e, forro);
    expect(creado.precio_compra).toBe(0);
    await actualizarProducto(env, await sesionDe(admin), creado.id, { precio_compra: 2.5 });
    const editado = await actualizarProducto(env, e, creado.id, { precio_compra: 99, precio_venta: 7 });
    expect(editado.precio_compra).toBe(2.5);
    expect(editado.precio_venta).toBe(7);
  });

  it('un código de barras repetido se rechaza con el mensaje de siempre', async () => {
    const a = await sesionDe(admin);
    await crearProducto(env, a, forro);
    await rechazo(crearProducto(env, a, { ...forro, nombre: 'Otro' }), 409, 'Ya existe un producto con el código de barras 2000000000015.');
  });

  it('valida nombre, categoría, precios y mínimo', async () => {
    const a = await sesionDe(admin);
    await rechazo(crearProducto(env, a, { ...forro, nombre: '  ' }), 400);
    await rechazo(crearProducto(env, a, { ...forro, categoria: '' }), 400);
    await rechazo(crearProducto(env, a, { ...forro, precio_venta: -1 }), 400);
    await rechazo(crearProducto(env, a, { ...forro, stock_minimo: -2 }), 400);
  });

  it('editar nunca toca el stock, y un producto inexistente da 404', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    await entrada(p.id, accesorios, 4);
    const editado = await actualizarProducto(env, a, p.id, { nombre: 'Forro nuevo', stock_actual: 99 } as never);
    expect(editado.nombre).toBe('Forro nuevo');
    expect(editado.stock_actual).toBe(4);
    await rechazo(actualizarProducto(env, a, 'no-existe', { nombre: 'X' }), 404);
  });

  it('solo administrador y gerente eliminan; se llevan su inventario', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    await entrada(p.id, accesorios, 3);
    await rechazo(eliminarProducto(env, await sesionDe(encargado), p.id), 403);
    await eliminarProducto(env, await sesionDe(gerente), p.id);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM inventario_local').first<{ n: number }>())?.n).toBe(0);
    await rechazo(eliminarProducto(env, a, p.id), 404);
  });
});

describe('listarProductos', () => {
  it('cada rol recibe el stock solo de los locales a los que accede', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    await entrada(p.id, accesorios, 4);
    await entrada(p.id, vidrios, 6);
    const deVendedor = await listarProductos(env, await sesionDe(vendedor));
    expect(deVendedor).toHaveLength(1);
    expect(deVendedor[0].inventario).toEqual([{ local_id: accesorios, producto_id: p.id, stock_actual: 4, stock_minimo: 0 }]);
    const deGerente = await listarProductos(env, await sesionDe(gerente));
    expect(deGerente[0].inventario.map((i) => i.stock_actual).sort()).toEqual([4, 6]);
    expect(deGerente[0].stock_actual).toBe(10);
  });

  it('incluye los modelos compatibles de cada producto', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    const m1 = await modelo('Apple', 'iPhone 11');
    const m2 = await modelo('Apple', 'iPhone 12');
    await establecerCompatibilidades(env, a, p.id, [m1, m2]);
    const [producto] = await listarProductos(env, await sesionDe(vendedor));
    expect(producto.modelos_compatibles.map((m) => m.modelo).sort()).toEqual(['iPhone 11', 'iPhone 12']);
  });

  it('el contador no ve el catálogo (403)', async () => {
    await rechazo(listarProductos(env, await sesionDe(contador)), 403);
  });

  it('obtenerProductoPorCodigo encuentra el producto o devuelve null', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    expect((await obtenerProductoPorCodigo(env, await sesionDe(vendedor), forro.codigo_barras))?.id).toBe(p.id);
    expect(await obtenerProductoPorCodigo(env, a, '0000000000000')).toBeNull();
  });

  it('obtenerProductoPorId devuelve el producto con su inventario, null si no existe y 403 al contador', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    expect(await obtenerProductoPorId(env, await sesionDe(vendedor), p.id)).toMatchObject({ id: p.id, nombre: forro.nombre, inventario: [], modelos_compatibles: [] });
    expect(await obtenerProductoPorId(env, a, 'no-existe')).toBeNull();
    await rechazo(obtenerProductoPorId(env, await sesionDe(contador), p.id), 403);
  });
});

describe('alertas de stock bajo', () => {
  it('solo cuentan los productos con mínimo > 0 y stock <= mínimo, por local y dentro del alcance', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    const q = await crearProducto(env, a, { ...forro, codigo_barras: '2000000000022', nombre: 'Vidrio' });
    await entrada(p.id, accesorios, 2);
    await entrada(q.id, accesorios, 9);
    await fijarMinimosLote(env, a, accesorios, [{ producto_id: p.id, stock_minimo: 3 }, { producto_id: q.id, stock_minimo: 3 }]);
    await entrada(p.id, vidrios, 1);
    await fijarMinimosLote(env, a, vidrios, [{ producto_id: p.id, stock_minimo: 0 }]); // 0 = sin control

    const todos = await listarStockBajo(env, a);
    expect(todos).toEqual([{ id: p.id, codigo_barras: forro.codigo_barras, referencia: p.referencia, nombre: forro.nombre, categoria: 'Forros', stock_actual: 2, stock_minimo: 3, local_id: accesorios, local_nombre: 'Local Accesorios' }]);
    expect(await listarStockBajo(env, await sesionDe(encargado))).toEqual([]); // su local (vidrios) no tiene alertas
    expect((await listarStockBajo(env, await sesionDe(vendedor))).length).toBe(1);
  });
});

describe('importación en lote', () => {
  const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ codigo_barras: `20000100${String(i).padStart(5, '0')}`, nombre: `Producto ${i}`, categoria: 'Forros', precio_venta: 5, stock_minimo: 0 }));

  it('solo administrador y gerente; devuelve el id de cada código', async () => {
    const creados = await crearProductosLote(env, await sesionDe(admin), filas(3));
    expect(creados.map((c) => c.codigo_barras).sort()).toEqual(filas(3).map((f) => f.codigo_barras).sort());
    await rechazo(crearProductosLote(env, await sesionDe(encargado), filas(1)), 403);
    await rechazo(crearProductosLote(env, await sesionDe(vendedor), filas(1)), 403);
  });

  it('un lote vacío no es un error (no hay nada que hacer): importar sin filas, sin pares y sin productos responde bien', async () => {
    const a = await sesionDe(admin);
    expect(await crearProductosLote(env, a, [])).toEqual([]);
    await reemplazarCompatibilidadesLote(env, a, [], []);
    await asegurarEnLocal(env, a, accesorios, []);
    await fijarMinimosLote(env, a, accesorios, []);
  });

  it('un código ya existente rechaza TODO el lote (nada queda a medias)', async () => {
    const a = await sesionDe(admin);
    await crearProducto(env, a, { ...forro, codigo_barras: filas(2)[1].codigo_barras });
    await rechazo(crearProductosLote(env, a, filas(2)), 409);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM productos').first<{ n: number }>())?.n).toBe(1);
  });

  it('más de 100 filas por petición se rechaza (límites de D1)', async () => {
    await rechazo(crearProductosLote(env, await sesionDe(admin), filas(101)), 400);
  });

  it('reemplazarCompatibilidadesLote borra las anteriores y deja las nuevas', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    const m1 = await modelo('Apple', 'iPhone 11');
    const m2 = await modelo('Apple', 'iPhone 12');
    await establecerCompatibilidades(env, a, p.id, [m1]);
    await reemplazarCompatibilidadesLote(env, a, [{ producto_id: p.id, modelo_id: m2 }], [p.id]);
    const filasCompat = await env.DB.prepare('SELECT modelo_id FROM compatibilidades WHERE producto_id = ?').bind(p.id).all<{ modelo_id: string }>();
    expect(filasCompat.results.map((f) => f.modelo_id)).toEqual([m2]);
    await rechazo(reemplazarCompatibilidadesLote(env, await sesionDe(encargado), [], [p.id]), 403);
  });
});

describe('inventario por local (alta y mínimo, nunca el stock)', () => {
  it('asegurarEnLocal da de alta con stock 0 y no toca lo que ya había', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    const q = await crearProducto(env, a, { ...forro, codigo_barras: '2000000000022', nombre: 'Otro' });
    await entrada(p.id, accesorios, 5);
    await asegurarEnLocal(env, a, accesorios, [p.id, q.id]);
    const filasInv = await env.DB.prepare('SELECT producto_id, stock_actual FROM inventario_local WHERE local_id = ? ORDER BY stock_actual').bind(accesorios).all();
    expect(filasInv.results).toEqual([{ producto_id: q.id, stock_actual: 0 }, { producto_id: p.id, stock_actual: 5 }]);
  });

  it('fijarMinimosLote cambia solo el mínimo', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    await entrada(p.id, accesorios, 5);
    await fijarMinimosLote(env, a, accesorios, [{ producto_id: p.id, stock_minimo: 4 }]);
    expect(await env.DB.prepare('SELECT stock_actual, stock_minimo FROM inventario_local WHERE producto_id = ?').bind(p.id).first()).toEqual({ stock_actual: 5, stock_minimo: 4 });
  });

  it('el encargado solo maneja el inventario de SU local; vendedor y técnico no', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    const e = await sesionDe(encargado);
    await asegurarEnLocal(env, e, vidrios, [p.id]);
    await fijarMinimosLote(env, e, vidrios, [{ producto_id: p.id, stock_minimo: 2 }]);
    await rechazo(asegurarEnLocal(env, e, accesorios, [p.id]), 403);
    await rechazo(fijarMinimosLote(env, e, accesorios, [{ producto_id: p.id, stock_minimo: 2 }]), 403);
    await rechazo(asegurarEnLocal(env, await sesionDe(vendedor), accesorios, [p.id]), 403);
    await rechazo(fijarMinimosLote(env, await sesionDe(tecnico), servicio, [{ producto_id: p.id, stock_minimo: 2 }]), 403);
  });

  it('un mínimo negativo se rechaza y un producto inexistente también', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    await rechazo(fijarMinimosLote(env, a, accesorios, [{ producto_id: p.id, stock_minimo: -1 }]), 400);
    await rechazo(asegurarEnLocal(env, a, accesorios, ['no-existe']), 400);
  });

  it('el gerente no puede tocar un local suspendido', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();
    await rechazo(asegurarEnLocal(env, await sesionDe(gerente), accesorios, [p.id]), 403);
  });
});

describe('modelos de teléfono', () => {
  it('lo ve cualquiera con acceso al catálogo; solo administrador y gerente crean y eliminan', async () => {
    const id = await modelo('Apple', 'iPhone 11');
    expect((await listarModelos(env, await sesionDe(vendedor))).map((m) => m.id)).toEqual([id]);
    await crearModelo(env, await sesionDe(gerente), { marca: 'Samsung', modelo: 'Galaxy A54' });
    await rechazo(crearModelo(env, await sesionDe(encargado), { marca: 'Xiaomi', modelo: 'Redmi 12' }), 403);
    await rechazo(eliminarModelo(env, await sesionDe(vendedor), id), 403);
    await eliminarModelo(env, await sesionDe(admin), id);
    await rechazo(listarModelos(env, await sesionDe(contador)), 403);
  });

  it('el mismo modelo dos veces se rechaza con 409', async () => {
    await modelo('Apple', 'iPhone 11');
    await rechazo(crearModelo(env, await sesionDe(admin), { marca: 'Apple', modelo: 'iPhone 11' }), 409);
  });

  it('borrar un modelo quita sus compatibilidades', async () => {
    const a = await sesionDe(admin);
    const p = await crearProducto(env, a, forro);
    const m = await modelo('Apple', 'iPhone 11');
    await establecerCompatibilidades(env, a, p.id, [m]);
    await eliminarModelo(env, a, m);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM compatibilidades').first<{ n: number }>())?.n).toBe(0);
  });
});

describe('tasa del dólar', () => {
  it('cualquier usuario con acceso (vendedor incluido) registra y la última registrada es la vigente', async () => {
    const v = await sesionDe(vendedor);
    expect(await obtenerUltimaTasa(env, v)).toBeNull();
    await registrarTasa(env, v, { fecha: '2026-11-03', tasa: 36.5, registrado_nombre: 'Vendedor' });
    await new Promise((r) => setTimeout(r, 5));
    const segunda = await registrarTasa(env, await sesionDe(encargado), { fecha: '2026-11-03', tasa: 37.1 });
    const ultima = await obtenerUltimaTasa(env, v);
    expect(ultima).toMatchObject({ id: segunda.id, tasa: 37.1, fecha: '2026-11-03' });
    expect((await env.DB.prepare('SELECT registrado_por FROM tasas_cambio WHERE id = ?').bind(segunda.id).first<{ registrado_por: string }>())?.registrado_por).toBe(encargado.id);
  });

  it('rechaza tasas no válidas, fechas mal escritas y al contador', async () => {
    const a = await sesionDe(admin);
    await rechazo(registrarTasa(env, a, { fecha: '2026-11-03', tasa: 0 }), 400);
    await rechazo(registrarTasa(env, a, { fecha: '2026-11-03', tasa: 20_000_000 }), 400);
    await rechazo(registrarTasa(env, a, { fecha: '03/11/2026', tasa: 36 }), 400);
    await rechazo(registrarTasa(env, await sesionDe(contador), { fecha: '2026-11-03', tasa: 36 }), 403);
    await rechazo(obtenerUltimaTasa(env, await sesionDe(contador)), 403);
  });
});

describe('locales visibles', () => {
  it('administrador, gerente y contador ven todos; el resto solo el suyo', async () => {
    for (const u of [admin, gerente, contador]) expect((await listarLocalesVisibles(env, await sesionDe(u))).map((l) => l.nombre)).toHaveLength(4);
    expect((await listarLocalesVisibles(env, await sesionDe(encargado))).map((l) => l.id)).toEqual([vidrios]);
    expect((await listarLocalesVisibles(env, await sesionDe(vendedor))).map((l) => l.id)).toEqual([accesorios]);
  });

  it('devuelve activo como booleano y los campos de suscripción', async () => {
    const [primero] = await listarLocalesVisibles(env, await sesionDe(admin));
    expect(primero.activo).toBe(true);
    expect(primero.subscription_status).toBe('ACTIVE');
  });
});
