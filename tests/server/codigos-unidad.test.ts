import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { actualizarProducto, crearProducto, crearProductosLote } from '../../src/server/servicios/catalogo';
import { registrarMovimiento, registrarMovimientos } from '../../src/server/servicios/movimientos';
import migracion0008 from '../../migrations/0008_renumerar_unidades.sql?raw';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let sA: Sesion;

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  sA = await cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null })));
  for (const [id, marca, modelo] of [['m1', 'Infinix', 'Hot 30'], ['m2', 'Tecno', 'Spark 10'], ['m3', 'Samsung', 'A54'], ['m4', 'Apple', 'iPhone 13']]) {
    await env.DB.prepare('INSERT INTO modelos_telefono (id, marca, modelo) VALUES (?, ?, ?)').bind(id, marca, modelo).run();
  }
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

let n = 0;
const producto = (nombre: string, extra: Record<string, unknown> = {}) =>
  crearProducto(env, sA, { codigo_barras: `200000000${String(++n).padStart(4, '0')}`, nombre, categoria: 'Cargadores', precio_venta: 5, ...extra } as never);
const entrada = async (productoId: string, cantidad: number, localId: string = accesorios) =>
  (await registrarMovimiento(env, sA, { productoId, tipo: 'ENTRADA', cantidad, localId, motivo: 'Compra' })).unidadCodigos;

describe('prefijo del producto', () => {
  it('se guarda el que se indica (en mayúsculas)', async () => {
    expect((await producto('Cargador Infinix', { prefijo_codigo: 'inf' })).prefijo_codigo).toBe('INF');
    expect((await producto('Cargador Tecno', { prefijo_codigo: 'TEC' })).prefijo_codigo).toBe('TEC');
  });

  it('si no se indica, lo sugiere la marca del nombre, iPhone, o la categoría', async () => {
    expect((await producto('Cargador Infinix 20W')).prefijo_codigo).toBe('INF');
    expect((await producto('Forro silicona iPhone 13')).prefijo_codigo).toBe('IPH');
    expect((await producto('Cargador de carro 3.1A')).prefijo_codigo).toBe('CAR');
    expect((await producto('Cosa', { categoria: '123' })).prefijo_codigo).toBe('GEN');
  });

  it('rechaza un prefijo inválido', async () => {
    for (const malo of ['I', 'INFINIX', 'IN1', 'IÑF', 'IN F']) await rechazo(producto('X', { prefijo_codigo: malo }), 400, /prefijo/i);
  });

  it('se puede corregir al editar el producto', async () => {
    const p = await producto('Cargador Honor', { prefijo_codigo: 'HNR' });
    expect((await actualizarProducto(env, sA, p.id, { prefijo_codigo: 'hon' })).prefijo_codigo).toBe('HON');
    await rechazo(actualizarProducto(env, sA, p.id, { prefijo_codigo: '1' }), 400, /prefijo/i);
  });

  it('el importador por lote también lo pone (indicado o sugerido)', async () => {
    const [a, b] = await crearProductosLote(env, sA, [
      { codigo_barras: '2000000009991', nombre: 'Cargador Tecno', categoria: 'Cargadores', prefijo_codigo: 'tec' },
      { codigo_barras: '2000000009992', nombre: 'Cable Samsung', categoria: 'Cables' },
    ]);
    const fila = (id: string) => env.DB.prepare('SELECT prefijo_codigo AS p FROM productos WHERE id = ?').bind(id).first<{ p: string }>();
    expect((await fila(a.id))!.p).toBe('TEC');
    expect((await fila(b.id))!.p).toBe('SAM');
  });
});

describe('códigos de las unidades nuevas', () => {
  it('llevan el prefijo del producto y un número de 6 dígitos consecutivo', async () => {
    const p = await producto('Cargador Infinix', { prefijo_codigo: 'INF' });
    expect(await entrada(p.id, 3)).toEqual(['INF000001', 'INF000002', 'INF000003']);
    expect(await entrada(p.id, 2, vidrios)).toEqual(['INF000004', 'INF000005']);
  });

  it('productos con el mismo prefijo comparten la cuenta; otro prefijo empieza en 1', async () => {
    const cargador = await producto('Cargador Infinix', { prefijo_codigo: 'INF' });
    const cable = await producto('Cable Infinix', { prefijo_codigo: 'INF' });
    const tecno = await producto('Cargador Tecno', { prefijo_codigo: 'TEC' });
    expect(await entrada(cargador.id, 2)).toEqual(['INF000001', 'INF000002']);
    expect(await entrada(cable.id, 1)).toEqual(['INF000003']);
    expect(await entrada(tecno.id, 2)).toEqual(['TEC000001', 'TEC000002']);
    expect(await entrada(cargador.id, 1)).toEqual(['INF000004']);
  });

  it('varios movimientos en un mismo lote no repiten números', async () => {
    const a = await producto('Cargador Infinix', { prefijo_codigo: 'INF' });
    const b = await producto('Cable Infinix', { prefijo_codigo: 'INF' });
    const r = await registrarMovimientos(env, sA, [
      { productoId: a.id, tipo: 'ENTRADA', cantidad: 2, localId: accesorios },
      { productoId: b.id, tipo: 'ENTRADA', cantidad: 2, localId: accesorios },
    ]);
    expect(r.flatMap((x) => x.unidadCodigos)).toEqual(['INF000001', 'INF000002', 'INF000003', 'INF000004']);
  });

  it('cambiar el prefijo después solo afecta a las unidades nuevas', async () => {
    const p = await producto('Cargador', { prefijo_codigo: 'CAR' });
    const viejas = await entrada(p.id, 2);
    await actualizarProducto(env, sA, p.id, { prefijo_codigo: 'INF' });
    expect(viejas).toEqual(['CAR000001', 'CAR000002']);
    expect(await entrada(p.id, 1)).toEqual(['INF000001']);
    const guardadas = (await env.DB.prepare('SELECT codigo FROM unidades_producto ORDER BY rowid').all<{ codigo: string }>()).results.map((f) => f.codigo);
    expect(guardadas).toEqual(['CAR000001', 'CAR000002', 'INF000001']);
  });

  it('una devolución reactiva la MISMA pieza (conserva su código) y las nuevas siguen la cuenta', async () => {
    const p = await producto('Cargador Infinix', { prefijo_codigo: 'INF' });
    const [c1] = await entrada(p.id, 2);
    await registrarMovimiento(env, sA, { productoId: p.id, tipo: 'SALIDA', cantidad: 1, localId: accesorios, unidadCodigos: [c1] });
    await registrarMovimiento(env, sA, { productoId: p.id, tipo: 'ENTRADA', cantidad: 1, localId: accesorios, unidadCodigos: [c1] });
    expect(await entrada(p.id, 1)).toEqual(['INF000003']);
  });
});

/** Ejecuta la migración de datos 0008 (sentencia por sentencia: D1 no admite varias en una sola). */
async function correrMigracion0008() {
  const sentencias = migracion0008
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(sentencias.map((s) => env.DB.prepare(s)));
}

describe('migración 0008: renumera lo que ya existía', () => {
  async function productoAntiguo(id: string, nombre: string, categoria: string, modeloId?: string) {
    await env.DB.prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_venta) VALUES (?, ?, ?, ?, 5)").bind(id, `cb-${id}`, nombre, categoria).run();
    if (modeloId) await env.DB.prepare('INSERT INTO compatibilidades (id, producto_id, modelo_id) VALUES (?, ?, ?)').bind(`c-${id}`, id, modeloId).run();
  }
  async function unidadAntigua(id: string, productoId: string, codigo: string, creada: string, estado = 'DISPONIBLE') {
    await env.DB
      .prepare("INSERT INTO unidades_producto (id, producto_id, local_id, codigo, estado, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, productoId, accesorios, codigo, estado, creada)
      .run();
  }
  const codigos = async () => (await env.DB.prepare('SELECT codigo FROM unidades_producto ORDER BY created_at, rowid').all<{ codigo: string }>()).results.map((f) => f.codigo);
  const prefijoDe = async (id: string) => (await env.DB.prepare('SELECT prefijo_codigo AS p FROM productos WHERE id = ?').bind(id).first<{ p: string }>())!.p;

  it('asigna prefijo (iPhone, marca del nombre, marca de sus modelos, categoría) y numera por orden de llegada', async () => {
    await productoAntiguo('p-inf', 'Cargador Infinix 20W', 'Cargadores');
    await productoAntiguo('p-iph', 'Forro silicona iPhone 13', 'Forros');
    await productoAntiguo('p-sam', 'Forro antigolpes', 'Forros', 'm3'); // marca por el modelo con el que es compatible
    await productoAntiguo('p-cat', 'Cargador de carro', 'Cargadores');
    await unidadAntigua('u1', 'p-inf', '2100000000012', '2026-01-01T10:00:00.000Z');
    await unidadAntigua('u2', 'p-iph', '2100000000029', '2026-01-01T10:01:00.000Z');
    await unidadAntigua('u3', 'p-inf', '2100000000036', '2026-01-01T10:02:00.000Z', 'VENDIDA');
    await unidadAntigua('u4', 'p-sam', '2100000000043', '2026-01-01T10:03:00.000Z');
    await unidadAntigua('u5', 'p-cat', '2100000000050', '2026-01-01T10:04:00.000Z');

    await correrMigracion0008();

    expect([await prefijoDe('p-inf'), await prefijoDe('p-iph'), await prefijoDe('p-sam'), await prefijoDe('p-cat')]).toEqual(['INF', 'IPH', 'SAM', 'CAR']);
    expect(await codigos()).toEqual(['INF000001', 'IPH000001', 'INF000002', 'SAM000001', 'CAR000001']);
  });

  it('el contador de cada prefijo sigue donde quedó: la siguiente unidad nueva no repite', async () => {
    await productoAntiguo('p-inf', 'Cargador Infinix', 'Cargadores');
    await unidadAntigua('u1', 'p-inf', '2100000000012', '2026-01-01T10:00:00.000Z');
    await unidadAntigua('u2', 'p-inf', '2100000000029', '2026-01-01T10:01:00.000Z');
    await correrMigracion0008();
    expect(await entrada('p-inf', 1)).toEqual(['INF000003']);
  });

  it('actualiza también las piezas de los traslados', async () => {
    await productoAntiguo('p-inf', 'Cargador Infinix', 'Cargadores');
    await unidadAntigua('u1', 'p-inf', '2100000000012', '2026-01-01T10:00:00.000Z', 'EN_TRANSITO');
    await env.DB
      .prepare("INSERT INTO traslados (id, folio, origen_local_id, destino_local_id, estado, enviado_por) VALUES ('t1', 1, ?, ?, 'EN_TRANSITO', 'Ana')")
      .bind(accesorios, vidrios)
      .run();
    await env.DB.prepare("INSERT INTO traslado_unidades (traslado_id, codigo, producto_id, producto_nombre) VALUES ('t1', '2100000000012', 'p-inf', 'Cargador Infinix')").run();
    await correrMigracion0008();
    const fila = await env.DB.prepare('SELECT codigo FROM traslado_unidades WHERE traslado_id = ?').bind('t1').first<{ codigo: string }>();
    expect(fila!.codigo).toBe('INF000001');
  });

  it('es idempotente: correrla otra vez no cambia nada', async () => {
    await productoAntiguo('p-inf', 'Cargador Infinix', 'Cargadores');
    await unidadAntigua('u1', 'p-inf', '2100000000012', '2026-01-01T10:00:00.000Z');
    await correrMigracion0008();
    await correrMigracion0008();
    expect(await codigos()).toEqual(['INF000001']);
    expect(await entrada('p-inf', 1)).toEqual(['INF000002']);
  });
});
