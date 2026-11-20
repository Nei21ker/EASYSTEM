import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto } from '../../src/server/servicios/catalogo';
import { registrarMovimiento } from '../../src/server/servicios/movimientos';
import { actualizarOrden, crearOrden, eliminarOrdenes, resetearServicioTecnico } from '../../src/server/servicios/ordenes';
import type { RepuestoOrden } from '../../src/types/database.types';
import { LOCAL_PANTALLAS_ID } from '../../src/lib/constantes-locales';
import { cambiarRepuestoOrden, listarRepuestosOrden } from '../../src/server/servicios/repuestosOrden';

const env = crearEntornoDePrueba();
const { accesorios, servicio } = IDS_LOCALES;
const OTRO_SERVICIO = '00000000-0000-4000-8000-000000000009';

let sA: Sesion, sG: Sesion, sS: Sesion, sE: Sesion;
let pantalla: string, vidrio: string;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  await env.DB.prepare("INSERT INTO locales (id, nombre, tipo) VALUES (?, 'Local 2 Servicio técnico', 'servicio_tecnico')").bind(OTRO_SERVICIO).run();
  const usuarios = await Promise.all([
    crearUsuarioDePrueba(env, { rol: 'administrador', localId: null }),
    crearUsuarioDePrueba(env, { rol: 'gerente', localId: null }),
    crearUsuarioDePrueba(env, { rol: 'supervisor', localId: null }),
    crearUsuarioDePrueba(env, { rol: 'encargado', localId: servicio }),
  ]);
  [sA, sG, sS, sE] = await Promise.all(usuarios.map(sesionDe));
  pantalla = (await crearProducto(env, sA, { codigo_barras: '2000000000015', nombre: 'Pnt Samsung A07', categoria: 'Pantalla', precio_venta: 11 })).id;
  vidrio = (await crearProducto(env, sA, { codigo_barras: '2000000000022', nombre: 'Mica sencilla', categoria: 'Micas', precio_venta: 1.5, control_por_cantidad: 1 })).id;
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

const una = <T>(sql: string, ...v: unknown[]) => env.DB.prepare(sql).bind(...v).first<T>();
const stock = async (productoId: string, localId: string) =>
  (await una<{ s: number }>('SELECT stock_actual AS s FROM inventario_local WHERE producto_id = ? AND local_id = ?', productoId, localId))?.s ?? 0;
const contar = async (tabla: string) => (await una<{ n: number }>(`SELECT count(*) AS n FROM ${tabla}`))!.n;
const estadoPieza = async (codigo: string) => (await una<{ estado: string; local_id: string }>('SELECT estado, local_id FROM unidades_producto WHERE codigo = ?', codigo))!;

const nueva = (local_id: string) => ({
  local_id, cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567',
  equipo_marca: 'Samsung', equipo_modelo: 'A07', equipo_imei: null, accesorios_recibidos: null, falla_reportada: 'Pantalla rota',
});

/** Como hace la pantalla: la salida de stock (con sus piezas) y la orden con el repuesto anotado. */
async function ordenConRepuesto(local: string, productoId: string, cantidad: number, precio: number): Promise<{ id: string; codigos: string[] }> {
  const { unidadCodigos } = await registrarMovimiento(env, sA, { productoId, tipo: 'SALIDA', cantidad, localId: local, motivo: 'Repuesto, orden de servicio' });
  const o = await crearOrden(env, sE.localId === local ? sE : sA, nueva(local));
  const repuesto: RepuestoOrden = { producto_id: productoId, nombre: 'Repuesto', codigo_barras: '1', cantidad, precio_unitario: precio, ...(unidadCodigos.length ? { unidades: unidadCodigos } : {}) };
  await actualizarOrden(env, sA, o.id, { repuestos: [repuesto] });
  return { id: o.id, codigos: unidadCodigos };
}

describe('resetearServicioTecnico', () => {
  it('descuenta la pieza escaneada del Local de pantallas y la devuelve a su origen', async () => {
    await env.DB.prepare("INSERT INTO locales (id, nombre, tipo) VALUES (?, 'Local de pantallas', 'servicio_tecnico')").bind(LOCAL_PANTALLAS_ID).run();
    const { unidadCodigos } = await registrarMovimiento(env, sA, { productoId: pantalla, tipo: 'ENTRADA', cantidad: 2, localId: LOCAL_PANTALLAS_ID });
    const orden = await crearOrden(env, sE, nueva(servicio));
    expect(await listarRepuestosOrden(env, sE, orden.id)).toEqual([expect.objectContaining({ id: pantalla, origen_local_id: LOCAL_PANTALLAS_ID, stock_actual: 2 })]);
    const conRepuesto = await cambiarRepuestoOrden(env, sE, orden.id, { accion: 'escanear', codigo: unidadCodigos[1] });
    expect(conRepuesto.repuestos).toEqual([expect.objectContaining({ unidades: [unidadCodigos[1]], origen_local_id: LOCAL_PANTALLAS_ID })]);
    expect(await stock(pantalla, LOCAL_PANTALLAS_ID)).toBe(1);
    expect(await stock(pantalla, servicio)).toBe(0);
    await cambiarRepuestoOrden(env, sE, orden.id, { accion: 'quitar', productoId: pantalla, origen: LOCAL_PANTALLAS_ID });
    expect(await estadoPieza(unidadCodigos[1])).toEqual({ estado: 'DISPONIBLE', local_id: LOCAL_PANTALLAS_ID });
    expect(await stock(pantalla, LOCAL_PANTALLAS_ID)).toBe(2);
  });

  it('en Pantallas solo comparte baterías de Servicio Técnico y el reset devuelve cantidades a su origen', async () => {
    await env.DB.prepare("INSERT INTO locales (id, nombre, tipo) VALUES (?, 'Local de pantallas', 'servicio_tecnico')").bind(LOCAL_PANTALLAS_ID).run();
    const bateria = (await crearProducto(env, sA, { codigo_barras: '2000000000039', nombre: 'Batería de prueba', categoria: 'Baterías', precio_venta: 2, control_por_cantidad: 1 })).id;
    await registrarMovimiento(env, sA, { productoId: bateria, tipo: 'ENTRADA', cantidad: 3, localId: servicio });
    await registrarMovimiento(env, sA, { productoId: vidrio, tipo: 'ENTRADA', cantidad: 3, localId: servicio });
    const orden = await crearOrden(env, sS, nueva(LOCAL_PANTALLAS_ID));
    expect((await listarRepuestosOrden(env, sS, orden.id)).map((p) => p.id)).toEqual([bateria]);
    await rechazo(cambiarRepuestoOrden(env, sS, orden.id, { accion: 'agregar', productoId: vidrio, origen: servicio, cantidad: 1 }), 409);
    await cambiarRepuestoOrden(env, sS, orden.id, { accion: 'agregar', productoId: bateria, origen: servicio, cantidad: 2 });
    expect(await stock(bateria, servicio)).toBe(1);
    await resetearServicioTecnico(env, sA, { localId: LOCAL_PANTALLAS_ID });
    expect(await stock(bateria, servicio)).toBe(3);
    expect(await stock(bateria, LOCAL_PANTALLAS_ID)).toBe(0);
  });

  it('al agregar en paralelo conserva la correspondencia entre la orden y el stock', async () => {
    await registrarMovimiento(env, sA, { productoId: vidrio, tipo: 'ENTRADA', cantidad: 3, localId: servicio });
    const orden = await crearOrden(env, sE, nueva(servicio));
    const agregar = () => cambiarRepuestoOrden(env, sE, orden.id, { accion: 'agregar', productoId: vidrio, origen: servicio, cantidad: 1 });
    const resultados = await Promise.allSettled([agregar(), agregar()]);
    const agregadas = resultados.filter((r) => r.status === 'fulfilled').length;
    expect(agregadas).toBeGreaterThan(0);
    expect(await stock(vidrio, servicio)).toBe(3 - agregadas);
    const fila = await una<{ repuestos: string }>('SELECT repuestos FROM ordenes_servicio WHERE id = ?', orden.id);
    expect(JSON.parse(fila!.repuestos)).toEqual([expect.objectContaining({ cantidad: agregadas })]);
  });
  it('borra las órdenes del local y devuelve los repuestos con los MISMOS códigos (y los de por cantidad por la cantidad usada)', async () => {
    await registrarMovimiento(env, sA, { productoId: pantalla, tipo: 'ENTRADA', cantidad: 5, localId: servicio, motivo: 'Compra' });
    await registrarMovimiento(env, sA, { productoId: vidrio, tipo: 'ENTRADA', cantidad: 10, localId: servicio, motivo: 'Compra' });
    const a = await ordenConRepuesto(servicio, pantalla, 2, 11);
    await ordenConRepuesto(servicio, vidrio, 3, 1.5);
    expect(await stock(pantalla, servicio)).toBe(3);
    expect(await stock(vidrio, servicio)).toBe(7);
    expect(await contar('ordenes_servicio')).toBe(2);

    const r = await resetearServicioTecnico(env, sA, { localId: servicio });
    expect(r).toEqual({ ordenes: 2, cobradas: 0, piezas: 5, simulado: false });

    expect(await stock(pantalla, servicio)).toBe(5);
    expect(await stock(vidrio, servicio)).toBe(10);
    for (const c of a.codigos) expect(await estadoPieza(c)).toEqual({ estado: 'DISPONIBLE', local_id: servicio });
    expect(await contar('ordenes_servicio')).toBe(0);
    const mov = await una<{ n: number }>("SELECT count(*) n FROM movimientos_inventario WHERE tipo = 'ENTRADA' AND motivo = 'Reseteo de servicio técnico (restaura el stock)'");
    expect(mov?.n).toBe(2);
    const total = await una<{ s: number }>('SELECT stock_actual s FROM productos WHERE id = ?', pantalla);
    expect(total?.s).toBe(5);
  });

  it('solo toca el local indicado: las órdenes y el stock de otro local de servicio técnico quedan igual', async () => {
    await registrarMovimiento(env, sA, { productoId: pantalla, tipo: 'ENTRADA', cantidad: 4, localId: servicio, motivo: 'Compra' });
    await registrarMovimiento(env, sA, { productoId: pantalla, tipo: 'ENTRADA', cantidad: 4, localId: OTRO_SERVICIO, motivo: 'Compra' });
    await ordenConRepuesto(servicio, pantalla, 1, 11);
    const otra = await ordenConRepuesto(OTRO_SERVICIO, pantalla, 2, 11);

    await resetearServicioTecnico(env, sA, { localId: servicio });

    expect(await stock(pantalla, servicio)).toBe(4);
    expect(await stock(pantalla, OTRO_SERVICIO)).toBe(2); // sigue con lo que usó su orden
    expect(await contar('ordenes_servicio')).toBe(1);
    for (const c of otra.codigos) expect((await estadoPieza(c)).estado).toBe('VENDIDA');
  });

  it('un repuesto que ya se quitó de la orden (y volvió al stock) no se cuenta dos veces', async () => {
    await registrarMovimiento(env, sA, { productoId: pantalla, tipo: 'ENTRADA', cantidad: 3, localId: servicio, motivo: 'Compra' });
    const { id, codigos } = await ordenConRepuesto(servicio, pantalla, 2, 11);
    // Se quitó de la orden: la pieza vuelve al stock y el repuesto sale de la lista
    await registrarMovimiento(env, sA, { productoId: pantalla, tipo: 'ENTRADA', cantidad: 2, localId: servicio, motivo: 'Repuesto devuelto', unidadCodigos: codigos });
    await actualizarOrden(env, sA, id, { repuestos: [] });
    expect(await stock(pantalla, servicio)).toBe(3);

    const r = await resetearServicioTecnico(env, sA, { localId: servicio });
    expect(r).toMatchObject({ ordenes: 1, piezas: 0 });
    expect(await stock(pantalla, servicio)).toBe(3);
  });

  it('simular solo cuenta: no borra ni repone nada', async () => {
    await registrarMovimiento(env, sA, { productoId: pantalla, tipo: 'ENTRADA', cantidad: 3, localId: servicio, motivo: 'Compra' });
    await ordenConRepuesto(servicio, pantalla, 2, 11);
    const r = await resetearServicioTecnico(env, sA, { localId: servicio, simular: true });
    expect(r).toEqual({ ordenes: 1, cobradas: 0, piezas: 2, simulado: true });
    expect(await contar('ordenes_servicio')).toBe(1);
    expect(await stock(pantalla, servicio)).toBe(1);
  });

  it('repetirlo no hace nada más', async () => {
    await registrarMovimiento(env, sA, { productoId: pantalla, tipo: 'ENTRADA', cantidad: 3, localId: servicio, motivo: 'Compra' });
    await ordenConRepuesto(servicio, pantalla, 2, 11);
    await resetearServicioTecnico(env, sA, { localId: servicio });
    const otra = await resetearServicioTecnico(env, sA, { localId: servicio });
    expect(otra).toEqual({ ordenes: 0, cobradas: 0, piezas: 0, simulado: false });
    expect(await stock(pantalla, servicio)).toBe(3);
  });

  it('solo el administrador; el local debe existir y tener servicio técnico; local_id es obligatorio', async () => {
    await rechazo(resetearServicioTecnico(env, sG, { localId: servicio }), 403);
    await rechazo(resetearServicioTecnico(env, sS, { localId: servicio }), 403);
    await rechazo(resetearServicioTecnico(env, sE, { localId: servicio }), 403);
    await rechazo(resetearServicioTecnico(env, sA, { localId: '' }), 400);
    await rechazo(resetearServicioTecnico(env, sA, { localId: 'no-existe' }), 404);
    await rechazo(resetearServicioTecnico(env, sA, { localId: accesorios }), 400, /servicio técnico/);
  });
});

describe('eliminarOrdenes', () => {
  it('solo elimina la orden seleccionada del local y exige administrador', async () => {
    const elegida = await crearOrden(env, sA, nueva(servicio));
    const otra = await crearOrden(env, sA, nueva(servicio));
    const externa = await crearOrden(env, sA, nueva(OTRO_SERVICIO));
    await rechazo(eliminarOrdenes(env, sG, servicio, [elegida.id]), 403);
    await rechazo(eliminarOrdenes(env, sA, servicio, [elegida.id, externa.id]), 409);
    expect(await contar('ordenes_servicio')).toBe(3);
    expect(await eliminarOrdenes(env, sA, servicio, [elegida.id])).toEqual({ eliminadas: 1 });
    expect(await una('SELECT id FROM ordenes_servicio WHERE id = ?', otra.id)).toEqual({ id: otra.id });
    expect(await contar('ordenes_servicio')).toBe(2);
  });

  it('protege la selección completa si una orden consumió stock', async () => {
    await registrarMovimiento(env, sA, { productoId: vidrio, tipo: 'ENTRADA', cantidad: 2, localId: servicio });
    const protegida = await ordenConRepuesto(servicio, vidrio, 1, 1.5);
    const elegida = await crearOrden(env, sA, nueva(servicio));
    await rechazo(eliminarOrdenes(env, sA, servicio, [elegida.id, protegida.id]), 409);
    expect(await contar('ordenes_servicio')).toBe(2);
    expect(await stock(vidrio, servicio)).toBe(1);
  });
});
