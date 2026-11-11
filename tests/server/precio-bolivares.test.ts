// Precio de venta FIJO en bolívares: no sigue a la tasa (su equivalente en $ sí cambia con cada tasa nueva) y se puede cambiar el de
// muchos productos de una vez (por ejemplo todos los vidrios de Bs 1100 a Bs 1250).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { actualizarProducto, cambiarPreciosLote, crearProducto, crearProductosRapidos, listarProductos } from '../../src/server/servicios/catalogo';
import { registrarTasa } from '../../src/server/servicios/tasas';

const env = crearEntornoDePrueba();
let admin: Sesion;
let gerente: Sesion;
let encargado: Sesion;

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null })));
  gerente = await cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null })));
  encargado = await cargarSesion(env, peticionComo(await crearUsuarioDePrueba(env, { rol: 'encargado', localId: IDS_LOCALES.vidrios })));
});

async function rechazo(promesa: Promise<unknown>, status: number, codigo: string): Promise<void> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    expect((err as ErrorApi).codigo).toBe(codigo);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const tasa = (valor: number, fecha = '2026-11-11') => registrarTasa(env, admin, { fecha, tasa: valor });
const fila = (id: string) => env.DB.prepare('SELECT precio_venta, moneda_precio, precio_bs FROM productos WHERE id = ?').bind(id).first<{ precio_venta: number; moneda_precio: string; precio_bs: number | null }>();
const vidrio = (n: number, extra: object = {}) => ({ codigo_barras: `20000000000${n}0`, nombre: `Vidrio sencillo modelo ${n}`, categoria: 'Vidrios Templados', precio_venta: 1.22, ...extra });

describe('crear con precio fijo en bolívares', () => {
  it('guarda los Bs escritos y calcula el equivalente en dólares con la tasa de hoy (6 decimales)', async () => {
    await tasa(900);
    const p = await crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 1100, precio_venta: undefined }));
    expect(p.moneda_precio).toBe('BS');
    expect(p.precio_bs).toBe(1100);
    expect(p.precio_venta).toBeCloseTo(1100 / 900, 6);
    // Volver a convertir con la misma tasa devuelve los Bs exactos
    expect(Math.round(p.precio_venta * 900 * 100) / 100).toBe(1100);
  });

  it('sin ninguna tasa registrada no se puede fijar un precio en Bs (409 sin_tasa)', async () => {
    await rechazo(crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 })), 409, 'sin_tasa');
  });

  it('el precio en Bs debe ser mayor a 0 y no pasar el tope', async () => {
    await tasa(900);
    await rechazo(crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 0 })), 400, 'precio_bs_invalido');
    await rechazo(crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 1e12 })), 400, 'precio_bs_invalido');
    await rechazo(crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS' })), 400, 'precio_bs_invalido');
  });

  it('un producto por cantidad con precio en Bs equivalente a $3 o más se rechaza; con menos de $3 se crea', async () => {
    await tasa(900);
    await rechazo(crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 3000, control_por_cantidad: 1 })), 400, 'precio_no_permitido');
    const ok = await crearProducto(env, admin, vidrio(2, { moneda_precio: 'BS', precio_bs: 1100, control_por_cantidad: 1 }));
    expect(ok.control_por_cantidad).toBe(1);
  });

  it('el alta rápida acepta el precio en Bs para toda la lista', async () => {
    await tasa(900);
    const creados = await crearProductosRapidos(env, encargado, [
      { nombre: 'Vidrio rápido A', categoria: 'Vidrios Templados', precio_venta: 0, moneda_precio: 'BS', precio_bs: 1100 },
      { nombre: 'Vidrio rápido B', categoria: 'Vidrios Templados', precio_venta: 2 },
    ]);
    const a = await fila(creados[0].id);
    const b = await fila(creados[1].id);
    expect(a).toMatchObject({ moneda_precio: 'BS', precio_bs: 1100 });
    expect(a!.precio_venta).toBeCloseTo(1100 / 900, 6);
    expect(b).toMatchObject({ moneda_precio: 'USD', precio_bs: null, precio_venta: 2 });
  });
});

describe('la tasa nueva mueve el equivalente en dólares, no el precio en Bs', () => {
  it('registrar una tasa recalcula precio_venta de los productos en Bs y no toca los de dólares', async () => {
    await tasa(900);
    const enBs = await crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 }));
    const enUsd = await crearProducto(env, admin, vidrio(2, { precio_venta: 5 }));
    await tasa(1000, '2026-11-12');
    const a = await fila(enBs.id);
    expect(a!.precio_bs).toBe(1100);
    expect(a!.precio_venta).toBeCloseTo(1.1, 6);
    expect((await fila(enUsd.id))!.precio_venta).toBe(5);
  });

  it('sube la versión de "productos" para que las pantallas abiertas se actualicen', async () => {
    await tasa(900);
    await crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 }));
    const antes = await env.DB.prepare("SELECT version FROM cambios WHERE tabla = 'productos'").first<{ version: number }>();
    await tasa(950, '2026-11-12');
    const despues = await env.DB.prepare("SELECT version FROM cambios WHERE tabla = 'productos'").first<{ version: number }>();
    expect(despues!.version).toBeGreaterThan(antes?.version ?? 0);
  });
});

describe('editar el precio de un producto', () => {
  it('pasar de dólares a Bs y de vuelta', async () => {
    await tasa(900);
    const p = await crearProducto(env, admin, vidrio(1, { precio_venta: 4 }));
    await actualizarProducto(env, admin, p.id, { moneda_precio: 'BS', precio_bs: 1200 });
    expect(await fila(p.id)).toMatchObject({ moneda_precio: 'BS', precio_bs: 1200 });
    await actualizarProducto(env, admin, p.id, { moneda_precio: 'USD', precio_venta: 6 });
    expect(await fila(p.id)).toMatchObject({ moneda_precio: 'USD', precio_bs: null, precio_venta: 6 });
  });

  it('un precio_venta suelto (pantalla vieja o importador CSV) NO cambia un producto con precio en Bs', async () => {
    await tasa(900);
    const p = await crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 }));
    await actualizarProducto(env, admin, p.id, { precio_venta: 9, nombre: 'Vidrio renombrado' });
    const f = await fila(p.id);
    expect(f!.moneda_precio).toBe('BS');
    expect(f!.precio_venta).toBeCloseTo(1100 / 900, 6);
  });

  it('cambiar solo el precio en Bs de un producto que ya estaba en Bs', async () => {
    await tasa(900);
    const p = await crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 }));
    await actualizarProducto(env, admin, p.id, { precio_bs: 1300 });
    expect(await fila(p.id)).toMatchObject({ moneda_precio: 'BS', precio_bs: 1300 });
  });
});

describe('cambiar los precios en lote', () => {
  it('pone el mismo precio fijo en Bs a todos los elegidos (los vidrios de 1100 a 1250) y sube la versión', async () => {
    await tasa(900);
    const ids: string[] = [];
    for (let n = 1; n <= 5; n++) ids.push((await crearProducto(env, admin, vidrio(n, { moneda_precio: 'BS', precio_bs: 1100 }))).id);
    const otro = await crearProducto(env, admin, { ...vidrio(9), categoria: 'Forros', precio_venta: 6 });

    const r = await cambiarPreciosLote(env, gerente, { ids, moneda: 'BS', precio: 1250 });
    expect(r.actualizados).toBe(5);
    expect(r.precio_venta).toBeCloseTo(1250 / 900, 6);
    for (const id of ids) expect(await fila(id)).toMatchObject({ moneda_precio: 'BS', precio_bs: 1250 });
    expect(await fila(otro.id)).toMatchObject({ moneda_precio: 'USD', precio_venta: 6 });
    const version = await env.DB.prepare("SELECT version FROM cambios WHERE tabla = 'productos'").first<{ version: number }>();
    expect(version!.version).toBeGreaterThan(0);
  });

  it('sirve para pasar productos que estaban en dólares ($1,22) a Bs 1100 de una vez', async () => {
    await tasa(900);
    const ids = [(await crearProducto(env, admin, vidrio(1))).id, (await crearProducto(env, admin, vidrio(2))).id];
    await cambiarPreciosLote(env, admin, { ids, moneda: 'BS', precio: 1100 });
    for (const id of ids) expect(await fila(id)).toMatchObject({ moneda_precio: 'BS', precio_bs: 1100 });
  });

  it('en dólares quita el precio fijo en Bs', async () => {
    await tasa(900);
    const p = await crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 }));
    await cambiarPreciosLote(env, admin, { ids: [p.id], moneda: 'USD', precio: 7.5 });
    expect(await fila(p.id)).toMatchObject({ moneda_precio: 'USD', precio_bs: null, precio_venta: 7.5 });
  });

  it('maneja miles de productos (varias sentencias en un solo lote) e ignora ids que no existen', async () => {
    await tasa(900);
    const ids: string[] = [];
    for (let n = 0; n < 250; n++) {
      ids.push(`p-masivo-${n}`);
    }
    await env.DB.batch(
      ids.map((id, n) =>
        env.DB
          .prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo, created_at) VALUES (?, ?, ?, 'Vidrios Templados', 0, 1.22, 0, '2026-01-01T00:00:00Z')")
          .bind(id, `77${String(n).padStart(8, '0')}`, `Masivo ${n}`)
      )
    );
    const r = await cambiarPreciosLote(env, admin, { ids: [...ids, 'no-existe'], moneda: 'BS', precio: 1100 });
    expect(r.actualizados).toBe(250);
    const cuenta = await env.DB.prepare("SELECT count(*) AS n FROM productos WHERE moneda_precio = 'BS' AND precio_bs = 1100").first<{ n: number }>();
    expect(cuenta!.n).toBe(250);
  });

  it('sin tasa no se puede fijar en Bs (409) y no cambia nada', async () => {
    const p = await crearProducto(env, admin, vidrio(1));
    await rechazo(cambiarPreciosLote(env, admin, { ids: [p.id], moneda: 'BS', precio: 1100 }), 409, 'sin_tasa');
    expect(await fila(p.id)).toMatchObject({ moneda_precio: 'USD', precio_venta: 1.22 });
  });

  it('un producto por cantidad no puede quedar en $3 o más: se rechaza todo el lote', async () => {
    await tasa(900);
    const normal = await crearProducto(env, admin, vidrio(1));
    const porCantidad = await crearProducto(env, admin, vidrio(2, { control_por_cantidad: 1 }));
    await rechazo(cambiarPreciosLote(env, admin, { ids: [normal.id, porCantidad.id], moneda: 'BS', precio: 3000 }), 409, 'precio_no_permitido');
    expect(await fila(normal.id)).toMatchObject({ moneda_precio: 'USD' });
  });

  it('valida la lista y el precio', async () => {
    await tasa(900);
    await rechazo(cambiarPreciosLote(env, admin, { ids: [], moneda: 'BS', precio: 1100 }), 400, 'datos_invalidos');
    await rechazo(cambiarPreciosLote(env, admin, { ids: ['x'], moneda: 'BS', precio: -5 }), 400, 'precio_bs_invalido');
    await rechazo(cambiarPreciosLote(env, admin, { ids: ['x'], moneda: 'USD', precio: -1 }), 400, 'datos_invalidos');
    await rechazo(cambiarPreciosLote(env, admin, { ids: Array.from({ length: 3001 }, (_, i) => `p${i}`), moneda: 'USD', precio: 1 }), 400, 'lote_grande');
  });

  it('solo administrador y gerente: el encargado recibe 403', async () => {
    await tasa(900);
    const p = await crearProducto(env, admin, vidrio(1));
    await rechazo(cambiarPreciosLote(env, encargado, { ids: [p.id], moneda: 'BS', precio: 1100 }), 403, 'sin_permiso');
    expect(await fila(p.id)).toMatchObject({ moneda_precio: 'USD' });
  });
});

describe('la lista de productos devuelve la moneda y el precio en Bs', () => {
  it('listarProductos incluye moneda_precio y precio_bs', async () => {
    await tasa(900);
    const p = await crearProducto(env, admin, vidrio(1, { moneda_precio: 'BS', precio_bs: 1100 }));
    const lista = await listarProductos(env, admin);
    const visto = lista.find((x) => x.id === p.id)!;
    expect(visto.moneda_precio).toBe('BS');
    expect(visto.precio_bs).toBe(1100);
  });
});
