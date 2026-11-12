// Alta de locales (solo administrador, migración 0026: sede) y mercancía que viaja a un local nuevo de otra sede (Barquicenter).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearLocal } from '../../src/server/servicios/locales';
import { registrarMovimientos } from '../../src/server/servicios/movimientos';
import { despacharTraslado, listarDestinos, recibirTraslado } from '../../src/server/servicios/traslados';
import { listarLocalesVisibles } from '../../src/server/servicios/catalogo';

const env = crearEntornoDePrueba();
const { accesorios } = IDS_LOCALES;
const P = 'p-forro-1';

let admin: Sesion, gerente: Sesion;
const sesionDe = (u: UsuarioDePrueba) => cargarSesion(env, peticionComo(u));

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
  const uGerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null, nombre: 'Gaby Gerente', clave: 'Clave-gerente-null-123' });
  [admin, gerente] = await Promise.all([uAdmin, uGerente].map(sesionDe));
});

describe('crearLocal', () => {
  it('el administrador agrega un local con tipo y sede; queda vigente y visible', async () => {
    const l = await crearLocal(env, admin, { nombre: '  Barquicenter   Accesorios ', tipo: 'accesorios', sede: 'Barquicenter' });
    expect(l).toMatchObject({ nombre: 'Barquicenter Accesorios', tipo: 'accesorios', sede: 'Barquicenter', activo: true, subscription_status: 'ACTIVE' });
    const visibles = await listarLocalesVisibles(env, gerente);
    expect(visibles.some((x) => x.id === l.id)).toBe(true);
  });

  it('solo el administrador: el gerente recibe 403', async () => {
    await rechazo(crearLocal(env, gerente, { nombre: 'Barquicenter Vidrios', tipo: 'vidrios', sede: 'Barquicenter' }), 403);
  });

  it('rechaza nombres repetidos (sin mayúsculas), nombres cortos y tipos inválidos', async () => {
    await crearLocal(env, admin, { nombre: 'Barquicenter Vidrios', tipo: 'vidrios', sede: 'Barquicenter' });
    await rechazo(crearLocal(env, admin, { nombre: 'barquicenter vidrios', tipo: 'vidrios' }), 409, 'local_repetido');
    await rechazo(crearLocal(env, admin, { nombre: 'ab', tipo: 'vidrios' }), 400);
    await rechazo(crearLocal(env, admin, { nombre: 'Local X', tipo: 'otro' as never }), 400);
  });

  it('la sede es opcional', async () => {
    const l = await crearLocal(env, admin, { nombre: 'Local sin sede', tipo: 'controles' });
    expect(l.sede).toBeNull();
  });
});

describe('mercancía hacia un local de otra sede', () => {
  it('el destino aparece con su sede y recibe el traslado igual que cualquier local', async () => {
    const nuevo = await crearLocal(env, admin, { nombre: 'Barquicenter Accesorios', tipo: 'accesorios', sede: 'Barquicenter' });
    const destinos = await listarDestinos(env, admin);
    expect(destinos.find((d) => d.id === nuevo.id)).toMatchObject({ nombre: 'Barquicenter Accesorios', sede: 'Barquicenter' });

    await env.DB.prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo, prefijo_codigo) VALUES (?, '2000000000077', 'Forro silicona A15', 'Forros', 0, 6, 0, 'FOR')").bind(P).run();
    await registrarMovimientos(env, admin, [{ productoId: P, tipo: 'ENTRADA', cantidad: 3, localId: accesorios }]);
    const codigos = (await env.DB.prepare("SELECT codigo FROM unidades_producto WHERE producto_id = ? ORDER BY codigo").bind(P).all<{ codigo: string }>()).results.map((f) => f.codigo);
    expect(codigos).toHaveLength(3);

    const t = await despacharTraslado(env, admin, { origenLocalId: accesorios, destinoLocalId: nuevo.id, codigos, notas: 'Pedido de Barquicenter' });
    expect(t).toMatchObject({ estado: 'EN_TRANSITO', notas: 'Pedido de Barquicenter' });

    const uDestino = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: nuevo.id, nombre: 'Beto Barquicenter', clave: 'Clave-encargado-barqui-123' });
    const recibido = await recibirTraslado(env, await sesionDe(uDestino), t.id, codigos);
    expect(recibido.unidades.every((u) => u.recibida_en)).toBe(true);

    const stock = async (local: string) => (await env.DB.prepare('SELECT COALESCE(stock_actual, 0) AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?').bind(P, local).first<{ s: number }>())?.s ?? 0;
    expect(await stock(accesorios)).toBe(0);
    expect(await stock(nuevo.id)).toBe(3);
  });
});
