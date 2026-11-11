// Las piezas defectuosas marcadas al cobrar y las bajas por cantidad de Descargo (mermas) aparecen solas como PÉRDIDA en Inversión
// (migración 0022: valor de una pieza guardado al registrar la merma). Solo las ven administrador y gerente.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { actualizarProducto, crearProducto } from '../../src/server/servicios/catalogo';
import { actualizarInversion, eliminarInversion, hoyDelNegocio, listarInversiones } from '../../src/server/servicios/inversion';
import { darDeBajaPorCantidad, registrarSalidaConMerma } from '../../src/server/servicios/mermas';
import { registrarMovimiento } from '../../src/server/servicios/movimientos';
import { totalizar } from '../../src/utils/inversion';

const env = crearEntornoDePrueba();
const { vidrios, accesorios } = IDS_LOCALES;

let admin: Sesion, gerente: Sesion, encargado: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const ua = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  const ug = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  const ue = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Encargada' });
  [admin, gerente, encargado] = await Promise.all([ua, ug, ue].map(sesionDe));
  await env.DB.prepare("INSERT INTO tasas_cambio (id, fecha, tasa, created_at) VALUES ('t1', '2026-01-10', 40, '2026-01-10T12:00:00.000Z')").run();
});

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

async function vidrioConStock(nombre: string, codigo: string, precioVenta: number, precioCompra = 0) {
  const p = await crearProducto(env, admin, { codigo_barras: codigo, nombre, categoria: 'Vidrios Templados', precio_venta: precioVenta, precio_compra: precioCompra, control_por_cantidad: 1 });
  await registrarMovimiento(env, encargado, { productoId: p.id, tipo: 'ENTRADA', cantidad: 50, localId: vidrios, motivo: 'Compra' });
  return p;
}

describe('pérdidas automáticas de vidrios en Inversión', () => {
  it('un vidrio defectuoso al cobrar aparece como PÉRDIDA automática, valorada a su precio de venta si no tiene costo', async () => {
    const p = await vidrioConStock('Vidrio sencillo Samsung A15', '2000000000015', 2);
    await registrarSalidaConMerma(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1, danados: 2, motivo: 'DEFECTO_FABRICA', nota: 'burbujas' });
    const lista = await listarInversiones(env, gerente);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ tipo: 'PERDIDA', local_id: vidrios, monto_usd: 4, automatica: true, tasa_bcv: 40, fecha: hoyDelNegocio(env), creado_por_nombre: 'Eli Encargada', proveedor_nombre: null });
    expect(lista[0].id).toMatch(/^merma:/);
    expect(lista[0].descripcion).toBe('2 × Vidrio sencillo Samsung A15 — defectuoso en una venta (venía defectuoso, burbujas)');
  });

  it('con costo cargado se valora al costo; una baja de Descargo también aparece', async () => {
    const p = await vidrioConStock('Vidrio sencillo Xiaomi Note 12', '2000000000022', 2, 1.5);
    await darDeBajaPorCantidad(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 4, motivo: 'DANADO_AL_COLOCAR' });
    const [r] = await listarInversiones(env, admin);
    expect(r).toMatchObject({ monto_usd: 6, automatica: true });
    expect(r.descripcion).toBe('4 × Vidrio sencillo Xiaomi Note 12 — dado de baja en Descargo (se dañó al colocar)');
  });

  it('el valor queda fijo aunque el precio del producto cambie después', async () => {
    const p = await vidrioConStock('Vidrio sencillo Tecno Spark', '2000000000039', 2);
    await darDeBajaPorCantidad(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 3 });
    await actualizarProducto(env, admin, p.id, { precio_venta: 1 });
    expect((await listarInversiones(env, gerente))[0].monto_usd).toBe(6);
  });

  it('suma en el total de pérdidas junto a las pérdidas anotadas a mano, y respeta tipo, local y fechas', async () => {
    const p = await vidrioConStock('Vidrio sencillo Samsung A05', '2000000000046', 2);
    await darDeBajaPorCantidad(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 2 });
    const hoy = hoyDelNegocio(env);
    await env.DB
      .prepare("INSERT INTO inversiones (id, local_id, tipo, fecha, descripcion, monto_usd, tasa_bcv, creado_por_nombre) VALUES ('i1', ?, 'PERDIDA', ?, 'Caja mojada', 10, 40, 'Gaby')")
      .bind(vidrios, hoy)
      .run();
    const todo = await listarInversiones(env, gerente);
    expect(todo).toHaveLength(2);
    expect(totalizar(todo)).toMatchObject({ perdidas_usd: 14, n_perdidas: 2, compras_usd: 0 });
    expect(await listarInversiones(env, gerente, { tipo: 'COMPRA' })).toHaveLength(0);
    expect(await listarInversiones(env, gerente, { tipo: 'PERDIDA' })).toHaveLength(2);
    expect(await listarInversiones(env, gerente, { localId: accesorios })).toHaveLength(0);
    expect(await listarInversiones(env, gerente, { localId: vidrios })).toHaveLength(2);
    expect(await listarInversiones(env, gerente, { desde: hoy, hasta: hoy })).toHaveLength(2);
    expect(await listarInversiones(env, gerente, { desde: '2020-01-01', hasta: '2020-01-31' })).toHaveLength(0);
  });

  it('las automáticas no se editan ni se eliminan desde Inversión (400); el encargado no las ve (403)', async () => {
    const p = await vidrioConStock('Vidrio sencillo Honor X7', '2000000000053', 2);
    await darDeBajaPorCantidad(env, encargado, { productoId: p.id, localId: vidrios, cantidad: 1 });
    const [r] = await listarInversiones(env, gerente);
    await rechazo(eliminarInversion(env, gerente, r.id), 400, 'registro_automatico');
    await rechazo(actualizarInversion(env, gerente, r.id, { localId: vidrios, tipo: 'PERDIDA', fecha: hoyDelNegocio(env), descripcion: 'Otra cosa', monto_usd: 1 }), 400, 'registro_automatico');
    await rechazo(listarInversiones(env, encargado), 403);
  });
});
