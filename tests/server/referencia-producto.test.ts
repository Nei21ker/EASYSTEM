import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { actualizarProducto, crearProducto, crearProductosLote, listarProductos } from '../../src/server/servicios/catalogo';
import migracion0010 from '../../migrations/0010_numerar_productos.sql?raw';

const env = crearEntornoDePrueba();
let sA: Sesion;

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  sA = await cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null })));
});

let n = 0;
const producto = (nombre: string, extra: Record<string, unknown> = {}) =>
  crearProducto(env, sA, { codigo_barras: `200000001${String(++n).padStart(4, '0')}`, nombre, categoria: 'Cargadores', precio_venta: 5, ...extra } as never);

describe('referencia del producto (PREFIJO-NNN)', () => {
  it('cada producto recibe la referencia de su prefijo, consecutiva por prefijo', async () => {
    const a = await producto('Cargador Infinix', { prefijo_codigo: 'INF' });
    const b = await producto('Cable Infinix', { prefijo_codigo: 'INF' });
    const c = await producto('Cargador Tecno', { prefijo_codigo: 'TEC' });
    const d = await producto('Otro Infinix', { prefijo_codigo: 'INF' });
    expect([a.referencia, b.referencia, c.referencia, d.referencia]).toEqual(['INF-001', 'INF-002', 'TEC-001', 'INF-003']);
  });

  it('la referencia viaja en la lista de productos', async () => {
    const a = await producto('Cargador Infinix', { prefijo_codigo: 'INF' });
    const lista = await listarProductos(env, sA);
    expect(lista.find((p) => p.id === a.id)!.referencia).toBe('INF-001');
  });

  it('el importador por lote también las asigna, sin repetir', async () => {
    await producto('Cargador Infinix', { prefijo_codigo: 'INF' });
    const r = await crearProductosLote(env, sA, [
      { codigo_barras: '2000000009991', nombre: 'Cargador Tecno', categoria: 'Cargadores', prefijo_codigo: 'tec' },
      { codigo_barras: '2000000009992', nombre: 'Cable Tecno', categoria: 'Cables', prefijo_codigo: 'tec' },
      { codigo_barras: '2000000009993', nombre: 'Cable Infinix', categoria: 'Cables', prefijo_codigo: 'inf' },
    ]);
    const refs = (await env.DB.prepare('SELECT id, referencia FROM productos').all<{ id: string; referencia: string }>()).results;
    const de = (id: string) => refs.find((f) => f.id === id)!.referencia;
    expect(r.map((x) => de(x.id))).toEqual(['TEC-001', 'TEC-002', 'INF-002']);
  });

  it('cambiar el prefijo después NO cambia la referencia (no se reimprime nada)', async () => {
    const p = await producto('Cargador', { prefijo_codigo: 'CAR' });
    const editado = await actualizarProducto(env, sA, p.id, { prefijo_codigo: 'INF' });
    expect(editado.referencia).toBe('CAR-001');
    expect((await producto('Otro', { prefijo_codigo: 'CAR' })).referencia).toBe('CAR-002');
  });

  it('la referencia no se puede escribir desde la edición', async () => {
    const p = await producto('Cargador', { prefijo_codigo: 'CAR' });
    const editado = await actualizarProducto(env, sA, p.id, { referencia: 'XXX-999' } as never);
    expect(editado.referencia).toBe('CAR-001');
  });

  it('pasado el 999 sigue con 4 dígitos', async () => {
    await env.DB.prepare("INSERT INTO contadores (nombre, valor) VALUES ('producto:INF', 999)").run();
    expect((await producto('Cargador', { prefijo_codigo: 'INF' })).referencia).toBe('INF-1000');
  });
});

async function correrMigracion0010() {
  const sentencias = migracion0010
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(sentencias.map((s) => env.DB.prepare(s)));
}

describe('migración 0010: numera los productos que ya existían', () => {
  const antiguo = (id: string, prefijo: string, creado: string) =>
    env.DB.prepare('INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_venta, prefijo_codigo, created_at, referencia) VALUES (?, ?, ?, ?, 5, ?, ?, NULL)').bind(id, `cb-${id}`, id, 'X', prefijo, creado).run();
  const refs = async () => (await env.DB.prepare('SELECT id, referencia FROM productos ORDER BY created_at, rowid').all<{ id: string; referencia: string }>()).results.map((f) => `${f.id}=${f.referencia}`);

  it('numera por prefijo y por orden de creación, y el contador sigue desde ahí', async () => {
    await antiguo('a', 'INF', '2026-01-01T10:00:00.000Z');
    await antiguo('b', 'TEC', '2026-01-01T10:01:00.000Z');
    await antiguo('c', 'INF', '2026-01-01T10:02:00.000Z');
    await correrMigracion0010();
    expect(await refs()).toEqual(['a=INF-001', 'b=TEC-001', 'c=INF-002']);
    expect((await producto('Nuevo', { prefijo_codigo: 'INF' })).referencia).toBe('INF-003');
  });

  it('es idempotente', async () => {
    await antiguo('a', 'INF', '2026-01-01T10:00:00.000Z');
    await correrMigracion0010();
    await correrMigracion0010();
    expect(await refs()).toEqual(['a=INF-001']);
    expect((await producto('Nuevo', { prefijo_codigo: 'INF' })).referencia).toBe('INF-002');
  });
});
