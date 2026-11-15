import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { calcularEsperadoCuadre } from '../../src/server/servicios/cuadres';
import {
  actualizarOrden,
  cobrarOrden,
  crearOrden,
  listarOrdenes,
  listarTecnicosDeLocal,
  obtenerOrden,
  pagarTecnicos,
} from '../../src/server/servicios/ordenes';
import type { CobroOrdenServicio } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, servicio } = IDS_LOCALES;

let tecR: UsuarioDePrueba, tecM: UsuarioDePrueba, tecOtroLocal: UsuarioDePrueba, tecInactivo: UsuarioDePrueba;
let sA: Sesion, sG: Sesion, sS: Sesion, sE: Sesion, sV: Sesion, sTR: Sesion, sTM: Sesion, sC: Sesion, sEAcc: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  const gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  const supervisor = await crearUsuarioDePrueba(env, { rol: 'supervisor', localId: null });
  const encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: servicio, nombre: 'Elena Encargada' });
  const encargadoAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios });
  const vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: servicio });
  tecR = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: servicio, nombre: 'Ricardo' });
  tecM = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: servicio, nombre: 'Mauricio' });
  tecOtroLocal = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: accesorios, nombre: 'Otro Local' });
  tecInactivo = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: servicio, nombre: 'Inactivo' });
  await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(tecInactivo.id).run();
  const contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  [sA, sG, sS, sE, sV, sTR, sTM, sC, sEAcc] = await Promise.all([admin, gerente, supervisor, encargado, vendedor, tecR, tecM, contador, encargadoAcc].map(sesionDe));
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

const nueva = (extra: Record<string, unknown> = {}) => ({
  local_id: servicio,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'Ana Pérez',
  cliente_telefono: '0414-1234567',
  equipo_marca: 'Apple',
  equipo_modelo: 'iPhone 11',
  equipo_imei: null,
  accesorios_recibidos: null,
  falla_reportada: 'Pantalla rota',
  ...extra,
});

const pantalla = (cantidad = 1, precio = 10) => ({ producto_id: 'p1', nombre: 'Pantalla', codigo_barras: '2000000000015', cantidad, precio_unitario: precio });

const efectivo = (usd: number): CobroOrdenServicio['pagos'] => [{ metodo: 'USD_EFECTIVO', monto_usd: usd, monto_bs: null }];
const cobro = (extra: Partial<CobroOrdenServicio> = {}): CobroOrdenServicio => ({ total_usd: 25, porcentaje_local: 20, pagos: efectivo(25), ...extra });

/** Orden lista para cobrar: técnico asignado, pantalla de $10 anotada y en reparación. */
async function ordenEnReparacion(tecnico: UsuarioDePrueba = tecR, repuestos = [pantalla()]): Promise<string> {
  const o = await crearOrden(env, sE, nueva());
  await actualizarOrden(env, sE, o.id, { tecnico_id: tecnico.id, repuestos, estado: 'en_reparacion' });
  return o.id;
}

describe('técnicos asignables', () => {
  it('lista los técnicos ACTIVOS del local (nombre incluido), no los de otros locales ni los inactivos', async () => {
    const lista = await listarTecnicosDeLocal(env, sE, servicio);
    expect(lista.map((t) => t.nombre).sort()).toEqual(['Mauricio', 'Ricardo']);
    expect(lista.every((t) => t.local_id === servicio)).toBe(true);
  });

  it('los vendedores del local también (anotan el trabajo); administrador/gerente/supervisor lo piden por local; técnico y contador no', async () => {
    expect(await listarTecnicosDeLocal(env, sV, servicio)).toHaveLength(2);
    for (const s of [sA, sG, sS]) expect(await listarTecnicosDeLocal(env, s, servicio)).toHaveLength(2);
    await rechazo(listarTecnicosDeLocal(env, sTR, servicio), 403);
    await rechazo(listarTecnicosDeLocal(env, sC, servicio), 403);
  });

  it('un encargado de otro local no ve los técnicos de este', async () => {
    await rechazo(listarTecnicosDeLocal(env, sEAcc, servicio), 403);
  });

  it('asignar a una orden: el nombre sale del perfil (no del cliente) y solo vale un técnico activo del mismo local', async () => {
    const o = await crearOrden(env, sE, nueva());
    const a = await actualizarOrden(env, sE, o.id, { tecnico_id: tecR.id, tecnico_nombre: 'Nombre Falso' });
    expect(a).toMatchObject({ tecnico_id: tecR.id, tecnico_nombre: 'Ricardo' });
    await rechazo(actualizarOrden(env, sE, o.id, { tecnico_id: tecOtroLocal.id }), 400, /técnico/i);
    await rechazo(actualizarOrden(env, sE, o.id, { tecnico_id: tecInactivo.id }), 400, /técnico/i);
    await rechazo(actualizarOrden(env, sE, o.id, { tecnico_id: sE.userId }), 400, /técnico/i);
    const sin = await actualizarOrden(env, sE, o.id, { tecnico_id: null });
    expect(sin).toMatchObject({ tecnico_id: null, tecnico_nombre: null });
  });
});

describe('el técnico solo ve y toca sus trabajos', () => {
  it('no registra equipos nuevos', async () => {
    await rechazo(crearOrden(env, sTR, nueva()), 403);
  });

  it('listarOrdenes y obtenerOrden: solo las suyas', async () => {
    const mia = await ordenEnReparacion(tecR);
    const deOtro = await ordenEnReparacion(tecM);
    await crearOrden(env, sE, nueva()); // sin técnico
    expect((await listarOrdenes(env, sTR, {})).map((o) => o.id)).toEqual([mia]);
    expect((await listarOrdenes(env, sTM, {})).map((o) => o.id)).toEqual([deOtro]);
    expect((await obtenerOrden(env, sTR, mia))?.id).toBe(mia);
    expect(await obtenerOrden(env, sTR, deOtro)).toBeNull();
    expect((await listarOrdenes(env, sE, {})).length).toBe(3);
  });

  it('puede anotar el diagnóstico y avanzar a «listo», nada más', async () => {
    const id = await ordenEnReparacion(tecR);
    const a = await actualizarOrden(env, sTR, id, { diagnostico: 'Cambio de pantalla', estado: 'listo' });
    expect(a).toMatchObject({ diagnostico: 'Cambio de pantalla', estado: 'listo' });
    await rechazo(actualizarOrden(env, sTR, id, { estado: 'entregado' }), 403);
    await rechazo(actualizarOrden(env, sTR, id, { mano_de_obra_usd: 99 }), 403);
    await rechazo(actualizarOrden(env, sTR, id, { repuestos: [pantalla(5, 1)] }), 403);
    await rechazo(actualizarOrden(env, sTR, id, { tecnico_id: tecM.id }), 403);
  });

  it('en la orden de otro técnico responde 404', async () => {
    const deOtro = await ordenEnReparacion(tecM);
    await rechazo(actualizarOrden(env, sTR, deOtro, { diagnostico: 'x' }), 404);
  });

  it('no cobra ni paga a nadie', async () => {
    const id = await ordenEnReparacion(tecR);
    await rechazo(cobrarOrden(env, sTR, id, cobro()), 403);
    await rechazo(pagarTecnicos(env, sTR, [id]), 403);
  });
});

describe('cobrar una reparación', () => {
  it('ejemplo del dueño: pantalla $10, cobro $25 y 20 % → la tienda $3, el técnico $12; queda entregada y cobrada', async () => {
    const id = await ordenEnReparacion();
    const o = await cobrarOrden(env, sE, id, cobro());
    expect(o).toMatchObject({
      estado: 'entregado', total_usd: 25, mano_de_obra_usd: 15, porcentaje_local: 20, comision_local_usd: 3, pago_tecnico_usd: 12,
      cobrado_nombre: 'Elena Encargada', tecnico_pagado_en: null,
    });
    expect(o.cobrado_en).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(o.entregada_en).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(o.cobrado_por).toBe(sE.userId);
    expect(o.pagos).toEqual(efectivo(25));
  });

  it('con una pieza del técnico (sin repuestos del local) el porcentaje cae sobre todo lo cobrado', async () => {
    const id = await ordenEnReparacion(tecR, []);
    const o = await cobrarOrden(env, sE, id, cobro({ total_usd: 20, porcentaje_local: 30, pagos: efectivo(20) }));
    expect(o).toMatchObject({ mano_de_obra_usd: 20, comision_local_usd: 6, pago_tecnico_usd: 14 });
  });

  it('el porcentaje es libre por trabajo (0 a 100)', async () => {
    const a = await cobrarOrden(env, sE, await ordenEnReparacion(), cobro({ porcentaje_local: 40 }));
    expect(a).toMatchObject({ comision_local_usd: 6, pago_tecnico_usd: 9 });
    const b = await cobrarOrden(env, sE, await ordenEnReparacion(), cobro({ porcentaje_local: 0 }));
    expect(b).toMatchObject({ comision_local_usd: 0, pago_tecnico_usd: 15 });
  });

  it('cobra en bolívares: guarda la tasa y el total en Bs', async () => {
    const id = await ordenEnReparacion();
    const o = await cobrarOrden(env, sE, id, cobro({ pagos: [{ metodo: 'BS_PAGO_MOVIL', monto_usd: 25, monto_bs: 900 }], tasa_cambio: 36 }));
    expect(o).toMatchObject({ tasa_cambio: 36, total_bs: 900 });
  });

  it('con vuelto: pagos − vuelto = total', async () => {
    const id = await ordenEnReparacion();
    const o = await cobrarOrden(env, sE, id, cobro({ pagos: efectivo(30), vuelto: { metodo: 'USD_EFECTIVO', monto_usd: 5, monto_bs: null } }));
    expect(o.vuelto).toEqual({ metodo: 'USD_EFECTIVO', monto_usd: 5, monto_bs: null });
    await rechazo(cobrarOrden(env, sE, await ordenEnReparacion(), cobro({ pagos: efectivo(30) })), 400, /pagos/i);
  });

  it('rechaza pagos que no suman el total, tipos inventados, Bs sin tasa y porcentajes o totales inválidos', async () => {
    const id = await ordenEnReparacion();
    await rechazo(cobrarOrden(env, sE, id, cobro({ pagos: efectivo(20) })), 400, /pagos/i);
    await rechazo(cobrarOrden(env, sE, id, cobro({ pagos: [] })), 400, /pagos/i);
    await rechazo(cobrarOrden(env, sE, id, cobro({ pagos: [{ metodo: 'TRUEQUE' as never, monto_usd: 25, monto_bs: null }] })), 400);
    await rechazo(cobrarOrden(env, sE, id, cobro({ pagos: [{ metodo: 'BS_PUNTO_VENTA', monto_usd: 25, monto_bs: 900 }] })), 400, /tasa/i);
    await rechazo(cobrarOrden(env, sE, id, cobro({ porcentaje_local: 150 })), 400, /porcentaje/i);
    await rechazo(cobrarOrden(env, sE, id, cobro({ total_usd: 8, pagos: efectivo(8) })), 400, /repuestos/i);
    await rechazo(cobrarOrden(env, sE, id, cobro({ total_usd: Number.NaN })), 400);
    expect((await obtenerOrden(env, sE, id))?.estado).toBe('en_reparacion'); // nada se cobró
  });

  it('exige técnico asignado y que el equipo esté en reparación o listo', async () => {
    const sinTecnico = await crearOrden(env, sE, nueva());
    await actualizarOrden(env, sE, sinTecnico.id, { estado: 'en_reparacion' });
    await rechazo(cobrarOrden(env, sE, sinTecnico.id, cobro({ total_usd: 5, pagos: efectivo(5) })), 409, /técnico/i);
    const pendiente = await crearOrden(env, sE, nueva());
    await actualizarOrden(env, sE, pendiente.id, { tecnico_id: tecR.id });
    await rechazo(cobrarOrden(env, sE, pendiente.id, cobro()), 409, /reparación/i);
    const lista = await ordenEnReparacion();
    await actualizarOrden(env, sE, lista, { estado: 'listo' });
    await cobrarOrden(env, sE, lista, cobro());
  });

  it('una orden ya cobrada no se cobra otra vez', async () => {
    const id = await ordenEnReparacion();
    await cobrarOrden(env, sE, id, cobro());
    await rechazo(cobrarOrden(env, sE, id, cobro()), 409, /entregada/i);
  });

  it('quién puede: administrador, gerente, supervisor, encargado y vendedor del local; no el técnico, el contador ni otro local', async () => {
    for (const s of [sA, sG, sS, sE, sV]) await cobrarOrden(env, s, await ordenEnReparacion(), cobro());
    const id = await ordenEnReparacion();
    await rechazo(cobrarOrden(env, sC, id, cobro()), 403);
    await rechazo(cobrarOrden(env, sEAcc, id, cobro()), 404);
    await rechazo(cobrarOrden(env, sE, 'no-existe', cobro()), 404);
  });

  it('el total cobrado queda en total_usd aunque se cambien los repuestos antes', async () => {
    const id = await ordenEnReparacion(tecR, [pantalla(1, 10), { ...pantalla(2, 3), producto_id: 'p2' }]);
    const o = await cobrarOrden(env, sE, id, cobro({ total_usd: 30, pagos: efectivo(30), porcentaje_local: 25 }));
    // repuestos 10 + 6 = 16 → ganancia 14 → tienda 3,50 → técnico 10,50
    expect(o).toMatchObject({ total_usd: 30, mano_de_obra_usd: 14, comision_local_usd: 3.5, pago_tecnico_usd: 10.5 });
  });

  it('sube la versión de ordenes_servicio en ese local', async () => {
    const id = await ordenEnReparacion();
    await env.DB.prepare('DELETE FROM cambios').run();
    await cobrarOrden(env, sE, id, cobro());
    expect(await env.DB.prepare('SELECT tabla, local_id FROM cambios').all()).toMatchObject({ results: [{ tabla: 'ordenes_servicio', local_id: servicio }] });
  });
});

describe('pagarle al técnico', () => {
  async function cobradas(): Promise<{ r1: string; r2: string; m1: string }> {
    const r1 = await ordenEnReparacion(tecR);
    const r2 = await ordenEnReparacion(tecR);
    const m1 = await ordenEnReparacion(tecM);
    for (const id of [r1, r2, m1]) await cobrarOrden(env, sE, id, cobro());
    return { r1, r2, m1 };
  }

  it('marca como pagadas las órdenes indicadas y devuelve cuántas y cuánto', async () => {
    const { r1, r2, m1 } = await cobradas();
    const r = await pagarTecnicos(env, sE, [r1, r2]);
    expect(r).toEqual({ pagadas: 2, total_usd: 24 });
    const o = (await obtenerOrden(env, sE, r1))!;
    expect(o.tecnico_pagado_en).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(o).toMatchObject({ tecnico_pagado_por: sE.userId, tecnico_pagado_nombre: 'Elena Encargada' });
    expect((await obtenerOrden(env, sE, m1))?.tecnico_pagado_en).toBeNull();
  });

  it('las ya pagadas no se pagan dos veces; si no queda ninguna, 409', async () => {
    const { r1, r2 } = await cobradas();
    await pagarTecnicos(env, sE, [r1]);
    expect(await pagarTecnicos(env, sE, [r1, r2])).toEqual({ pagadas: 1, total_usd: 12 });
    await rechazo(pagarTecnicos(env, sE, [r1, r2]), 409, /por pagar/i);
  });

  it('ignora órdenes sin cobrar, de otro local y ids que no existen', async () => {
    const { r1 } = await cobradas();
    const sinCobrar = await ordenEnReparacion(tecR);
    await rechazo(pagarTecnicos(env, sE, [sinCobrar, 'no-existe']), 409);
    expect(await pagarTecnicos(env, sE, [r1, sinCobrar, 'no-existe'])).toEqual({ pagadas: 1, total_usd: 12 });
    await rechazo(pagarTecnicos(env, sEAcc, [r1]), 409);
  });

  it('quién puede: administrador, gerente, supervisor y encargado; no el vendedor ni el contador', async () => {
    const { r1, r2, m1 } = await cobradas();
    await rechazo(pagarTecnicos(env, sV, [r1]), 403);
    await rechazo(pagarTecnicos(env, sC, [r1]), 403);
    await pagarTecnicos(env, sG, [r1]);
    await pagarTecnicos(env, sS, [r2]);
    await pagarTecnicos(env, sA, [m1]);
  });

  it('pide al menos una orden y no más de 200', async () => {
    await rechazo(pagarTecnicos(env, sE, []), 400);
    await rechazo(pagarTecnicos(env, sE, Array.from({ length: 201 }, (_, i) => `x${i}`)), 400);
  });

  it('el técnico ve en su historial lo que se le pagó', async () => {
    const { r1 } = await cobradas();
    await pagarTecnicos(env, sE, [r1]);
    const mias = await listarOrdenes(env, sTR, {});
    expect(mias.filter((o) => o.tecnico_pagado_en).length).toBe(1);
    expect(mias.reduce((s, o) => s + (o.pago_tecnico_usd ?? 0), 0)).toBe(24);
  });
});

describe('cuadre de caja', () => {
  it('lo cobrado en reparaciones entra a lo esperado del día del local, por tipo de cobro', async () => {
    const a = await ordenEnReparacion();
    const b = await ordenEnReparacion();
    await cobrarOrden(env, sE, a, cobro());
    await cobrarOrden(env, sE, b, cobro({ total_usd: 30, pagos: [{ metodo: 'BS_PAGO_MOVIL', monto_usd: 30, monto_bs: 1080 }], tasa_cambio: 36 }));
    await env.DB.prepare("UPDATE ordenes_servicio SET cobrado_en = '2026-10-20T16:00:00.000Z'").run();
    const esperado = await calcularEsperadoCuadre(env, sE, servicio, '2026-10-20');
    expect(esperado.find((e) => e.metodo === 'USD_EFECTIVO')).toMatchObject({ ventas: 1, usd: 25 });
    expect(esperado.find((e) => e.metodo === 'BS_PAGO_MOVIL')).toMatchObject({ ventas: 1, bs: 1080 });
    const otroDia = await calcularEsperadoCuadre(env, sE, servicio, '2026-10-21');
    expect(otroDia.every((e) => e.ventas === 0 && e.usd === 0 && e.bs === 0)).toBe(true);
  });
});
