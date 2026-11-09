// Un producto no se repite por nombre: crear otro igual se rechaza y se dice cuál es, para sumarle unidades con «+ Stock».
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { actualizarProducto, crearProducto, crearProductosLote, crearProductosRapidos, listarProductos } from '../../src/server/servicios/catalogo';

const env = crearEntornoDePrueba();
let admin: Sesion;
let encargado: Sesion;

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null })));
  encargado = await cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol: 'encargado', localId: IDS_LOCALES.vidrios })));
});

async function rechazo(promesa: Promise<unknown>, status: number, codigo: string, texto?: string | RegExp): Promise<void> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    expect((err as ErrorApi).codigo).toBe(codigo);
    if (texto) expect((err as ErrorApi).message).toMatch(texto);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const vidrio = { codigo_barras: '2000000000015', nombre: 'Vidrio curvo Infinix Note 40 pro', categoria: 'Vidrios curvos', precio_venta: 7 };
const cuantos = async () => (await env.DB.prepare('SELECT count(*) AS n FROM productos').first<{ n: number }>())!.n;

describe('crear un producto con un nombre que ya existe', () => {
  it('igual de exacto: se rechaza (409), dice cuál es (con su referencia) y no crea otro ítem', async () => {
    const primero = await crearProducto(env, admin, vidrio);
    await rechazo(
      crearProducto(env, admin, { ...vidrio, codigo_barras: '2000000000022' }),
      409,
      'nombre_repetido',
      new RegExp(`«Vidrio curvo Infinix Note 40 pro».*\\(${primero.referencia}\\).*«\\+ Stock»`)
    );
    expect(await cuantos()).toBe(1);
  });

  it('no distingue mayúsculas, acentos ni espacios de más', async () => {
    await crearProducto(env, admin, { ...vidrio, nombre: 'Cargador Rápido 20W' });
    for (const variante of ['cargador rapido 20w', '  CARGADOR   RÁPIDO  20W ', 'Cargador Rapido 20w']) {
      await rechazo(crearProducto(env, admin, { ...vidrio, codigo_barras: `20000${variante.length}`, nombre: variante }), 409, 'nombre_repetido');
    }
    expect(await cuantos()).toBe(1);
  });

  it('un nombre distinto sí se crea (otro modelo no es el mismo producto)', async () => {
    await crearProducto(env, admin, vidrio);
    await crearProducto(env, admin, { ...vidrio, codigo_barras: '2000000000022', nombre: 'Vidrio curvo Infinix Note 40' });
    expect(await cuantos()).toBe(2);
  });

  it('también lo exige al encargado', async () => {
    await crearProducto(env, admin, vidrio);
    await rechazo(crearProducto(env, encargado, { ...vidrio, codigo_barras: '2000000000022' }), 409, 'nombre_repetido');
  });
});

describe('alta rápida, importador y edición', () => {
  it('el alta rápida rechaza un nombre que ya existe y no crea ninguno de la lista (todo o nada)', async () => {
    await crearProducto(env, admin, vidrio);
    await rechazo(
      crearProductosRapidos(env, admin, [
        { nombre: 'Cable USB-C 1 m', categoria: 'Cables', precio_venta: 3 },
        { nombre: 'vidrio curvo infinix note 40 PRO', categoria: 'Vidrios curvos', precio_venta: 7 },
      ]),
      409,
      'nombre_repetido'
    );
    expect(await cuantos()).toBe(1);
  });

  it('una lista con el mismo nombre dos veces también se rechaza (400)', async () => {
    await rechazo(
      crearProductosRapidos(env, admin, [
        { nombre: 'Cable USB-C 1 m', categoria: 'Cables', precio_venta: 3 },
        { nombre: 'cable usb-c 1 M', categoria: 'Cables', precio_venta: 3 },
      ]),
      400,
      'nombre_repetido'
    );
    expect(await cuantos()).toBe(0);
  });

  it('el importador (crearProductosLote) rechaza nombres que ya existen o repetidos en el archivo', async () => {
    await crearProducto(env, admin, vidrio);
    await rechazo(crearProductosLote(env, admin, [{ ...vidrio, codigo_barras: '2000000000022' }]), 409, 'nombre_repetido');
    await rechazo(
      crearProductosLote(env, admin, [
        { codigo_barras: '2000000000039', nombre: 'Popsocket', categoria: 'Popsockets' },
        { codigo_barras: '2000000000046', nombre: 'POPSOCKET', categoria: 'Popsockets' },
      ]),
      400,
      'nombre_repetido'
    );
    expect(await cuantos()).toBe(1);
  });

  it('renombrar un producto al nombre de otro se rechaza; guardarlo con su propio nombre (aunque cambien las mayúsculas) no', async () => {
    const a = await crearProducto(env, admin, vidrio);
    const b = await crearProducto(env, admin, { ...vidrio, codigo_barras: '2000000000022', nombre: 'Otro vidrio' });
    await rechazo(actualizarProducto(env, admin, b.id, { nombre: 'VIDRIO CURVO INFINIX NOTE 40 PRO' }), 409, 'nombre_repetido', /«Vidrio curvo Infinix Note 40 pro»/);
    expect((await actualizarProducto(env, admin, a.id, { nombre: 'VIDRIO CURVO INFINIX NOTE 40 PRO', precio_venta: 8 })).precio_venta).toBe(8);
  });

  it('los productos que YA estaban repetidos se pueden seguir editando mientras no se toque el nombre', async () => {
    const a = await crearProducto(env, admin, vidrio);
    // Dos ítems iguales que venían de antes (se insertan directo, como los de la carga inicial)
    await env.DB
      .prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo, prefijo_codigo, referencia, created_at) VALUES (?, ?, ?, ?, 0, 7, 0, 'CRV', 'CRV-099', ?)")
      .bind(crypto.randomUUID(), '2000000000077', vidrio.nombre, vidrio.categoria, new Date().toISOString())
      .run();
    expect((await actualizarProducto(env, admin, a.id, { nombre: vidrio.nombre, precio_venta: 9 })).precio_venta).toBe(9);
    expect((await listarProductos(env, admin)).filter((p) => p.nombre === vidrio.nombre)).toHaveLength(2);
  });
});
