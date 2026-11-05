import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto, eliminarProducto, eliminarProductosLote, listarProductos } from '../../src/server/servicios/catalogo';
import { registrarMovimiento } from '../../src/server/servicios/movimientos';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, encargado: UsuarioDePrueba, vendedor: UsuarioDePrueba;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
});

async function rechazo(promesa: Promise<unknown>, status: number, codigo?: string): Promise<void> {
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

let n = 0;
const nuevo = async (nombre: string) => (await crearProducto(env, await sesionDe(admin), { codigo_barras: `20000000${String(++n).padStart(5, '0')}`, nombre, categoria: 'Controles', precio_venta: 5 })).id;
const entrar = async (productoId: string, cantidad: number, localId: string = accesorios) =>
  (await registrarMovimiento(env, await sesionDe(admin), { productoId, tipo: 'ENTRADA', cantidad, localId, motivo: 'Compra' })).unidadCodigos;
const cuenta = async (tabla: string, productoId: string) =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${tabla} WHERE producto_id = ?`).bind(productoId).first<{ n: number }>())!.n;

describe('eliminar un producto ingresado por error', () => {
  it('borra el producto con todo lo que se ingresó: unidades, movimientos y stock en todos los locales', async () => {
    const p = await nuevo('Control equivocado');
    await entrar(p, 5, accesorios);
    await entrar(p, 2, vidrios);
    await eliminarProducto(env, await sesionDe(gerente), p);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM productos WHERE id = ?').bind(p).first<{ n: number }>())!.n).toBe(0);
    for (const tabla of ['unidades_producto', 'movimientos_inventario', 'inventario_local']) expect(await cuenta(tabla, p)).toBe(0);
  });

  it('no se puede si el producto ya tuvo una venta (queda historial que se perdería): 409 y no borra nada', async () => {
    const p = await nuevo('Control vendido');
    await entrar(p, 3);
    await registrarMovimiento(env, await sesionDe(admin), { productoId: p, tipo: 'SALIDA', cantidad: 1, localId: accesorios, motivo: 'Venta POS' });
    await rechazo(eliminarProducto(env, await sesionDe(admin), p), 409, 'producto_con_historial');
    expect(await cuenta('unidades_producto', p)).toBe(3);
  });

  it('tampoco si una de sus piezas salió del stock por una baja o un traslado', async () => {
    const p = await nuevo('Control en baja');
    const [codigo] = await entrar(p, 2);
    await env.DB.prepare("UPDATE unidades_producto SET estado = 'BAJA' WHERE codigo = ?").bind(codigo).run();
    await rechazo(eliminarProducto(env, await sesionDe(admin), p), 409, 'producto_con_historial');
  });

  it('solo administrador y gerente; los demás reciben 403 aunque el producto no exista', async () => {
    const p = await nuevo('Control');
    await rechazo(eliminarProducto(env, await sesionDe(encargado), p), 403);
    await rechazo(eliminarProducto(env, await sesionDe(vendedor), 'no-existe'), 403);
    await rechazo(eliminarProductosLote(env, await sesionDe(encargado), [p]), 403);
    await rechazo(eliminarProductosLote(env, await sesionDe(vendedor), [p]), 403);
  });
});

describe('eliminar varios productos de una vez', () => {
  it('borra los que se pueden y avisa cuáles no (con el motivo), sin tocar esos', async () => {
    const a = await nuevo('Control A');
    const b = await nuevo('Control B');
    const vendido = await nuevo('Control vendido');
    await entrar(a, 2);
    await entrar(b, 1);
    await entrar(vendido, 2);
    await registrarMovimiento(env, await sesionDe(admin), { productoId: vendido, tipo: 'SALIDA', cantidad: 1, localId: accesorios, motivo: 'Venta POS' });

    const r = await eliminarProductosLote(env, await sesionDe(admin), [a, b, vendido, 'no-existe']);
    expect(r.eliminados.sort()).toEqual([a, b].sort());
    expect(r.bloqueados).toEqual([{ id: vendido, nombre: 'Control vendido', motivo: expect.stringMatching(/ventas|historial/i) }]);
    const quedan = (await listarProductos(env, await sesionDe(admin))).map((p) => p.id);
    expect(quedan).toEqual([vendido]);
    expect(await cuenta('unidades_producto', vendido)).toBe(2);
  });

  it('acepta hasta 100 por petición; una lista vacía no hace nada', async () => {
    const admin1 = await sesionDe(admin);
    await rechazo(eliminarProductosLote(env, admin1, Array.from({ length: 101 }, (_, i) => `id-${i}`)), 400, 'lote_grande');
    expect(await eliminarProductosLote(env, admin1, [])).toEqual({ eliminados: [], bloqueados: [] });
  });
});
