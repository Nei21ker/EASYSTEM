import { beforeEach, describe, expect, it } from 'vitest';
import { actualizarTasaDesdeBcv, leerRespuestaBcv } from '../../src/server/servicios/tasaBcv';
import { crearEntornoDePrueba, reiniciarBase } from './ayudas';

const env = crearEntornoDePrueba();

// Domingo 15-nov-2026 08:05 en Caracas (12:05 UTC) y lunes 16-nov-2026 08:05
const DOMINGO = new Date('2026-11-15T12:05:00Z');
const LUNES = new Date('2026-11-16T12:05:00Z');

function fuente(promedio: unknown, fecha = '2026-11-13T00:00:00-04:00') {
  return async () => ({ moneda: 'USD', fuente: 'oficial', promedio, fechaActualizacion: fecha });
}

async function filas() {
  return (await env.DB.prepare('SELECT * FROM tasas_cambio ORDER BY created_at, rowid').all<{
    fecha: string; tasa: number; registrado_por: string | null; registrado_nombre: string;
  }>()).results;
}

beforeEach(async () => {
  await reiniciarBase(env.DB);
});

describe('leerRespuestaBcv', () => {
  it('toma el promedio y la fecha de vigencia', () => {
    expect(leerRespuestaBcv({ promedio: 911.6243, fechaActualizacion: '2026-11-13T00:00:00-04:00' })).toEqual({ tasa: 911.6243, vigenteDesde: '2026-11-13' });
  });
  it('rechaza respuestas que no son una tasa', () => {
    expect(leerRespuestaBcv(null)).toBeNull();
    expect(leerRespuestaBcv({ promedio: 0 })).toBeNull();
    expect(leerRespuestaBcv({ promedio: -3 })).toBeNull();
    expect(leerRespuestaBcv({ promedio: 'abc' })).toBeNull();
    expect(leerRespuestaBcv({ promedio: 99999999 })).toBeNull();
  });
});

describe('actualizarTasaDesdeBcv', () => {
  it('un domingo registra la tasa de hoy (la última publicada) a nombre del BCV automático', async () => {
    const r = await actualizarTasaDesdeBcv(env, { ahora: DOMINGO, traer: fuente(911.6243) });
    expect(r).toMatchObject({ resultado: 'registrada', tasa: 911.6243, fecha: '2026-11-15' });
    const [f] = await filas();
    expect(f).toMatchObject({ fecha: '2026-11-15', tasa: 911.6243, registrado_por: null });
    expect(f.registrado_nombre).toContain('BCV');
  });

  it('no repite si hoy ya hay una tasa con el mismo valor', async () => {
    await actualizarTasaDesdeBcv(env, { ahora: DOMINGO, traer: fuente(911.6243) });
    const r = await actualizarTasaDesdeBcv(env, { ahora: DOMINGO, traer: fuente(911.6243) });
    expect(r.resultado).toBe('ya_registrada');
    expect(await filas()).toHaveLength(1);
  });

  it('si la fuente publica una tasa nueva el mismo día reemplaza la automática (ej. la del lunes publicada el fin de semana)', async () => {
    await actualizarTasaDesdeBcv(env, { ahora: DOMINGO, traer: fuente(911.6243) });
    const r = await actualizarTasaDesdeBcv(env, { ahora: DOMINGO, traer: fuente(915.5, '2026-11-16T00:00:00-04:00') });
    expect(r.resultado).toBe('registrada');
    const todas = await filas();
    expect(todas).toHaveLength(2);
    expect(todas[1].tasa).toBe(915.5);
  });

  it('no pisa una tasa que alguien escribió a mano hoy', async () => {
    await env.DB.prepare("INSERT INTO tasas_cambio (id, fecha, tasa, created_at, registrado_nombre) VALUES ('x', '2026-11-16', 920, '2026-11-16T11:00:00Z', 'Ana')").run();
    const r = await actualizarTasaDesdeBcv(env, { ahora: LUNES, traer: fuente(915.5) });
    expect(r.resultado).toBe('ya_registrada');
    expect(await filas()).toHaveLength(1);
  });

  it('rechaza una tasa que se aleja más de 25 % de la anterior', async () => {
    await env.DB.prepare("INSERT INTO tasas_cambio (id, fecha, tasa, created_at, registrado_nombre) VALUES ('x', '2026-11-13', 900, '2026-11-13T11:00:00Z', 'Ana')").run();
    const r = await actualizarTasaDesdeBcv(env, { ahora: LUNES, traer: fuente(90) });
    expect(r.resultado).toBe('error');
    expect(await filas()).toHaveLength(1);
  });

  it('si la fuente falla o responde basura no registra nada y no lanza', async () => {
    const caida = await actualizarTasaDesdeBcv(env, { ahora: LUNES, traer: async () => { throw new Error('sin red'); } });
    expect(caida.resultado).toBe('error');
    const basura = await actualizarTasaDesdeBcv(env, { ahora: LUNES, traer: async () => ({ hola: 1 }) });
    expect(basura.resultado).toBe('error');
    expect(await filas()).toHaveLength(0);
  });

  it('recalcula el equivalente en dólares de los productos con precio fijo en Bs', async () => {
    await env.DB.prepare(
      "INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, moneda_precio, precio_bs) VALUES ('p1', '2000000000017', 'Vidrio', 'Vidrios Templados', 0, 1, 'BS', 1100)"
    ).run();
    await actualizarTasaDesdeBcv(env, { ahora: LUNES, traer: fuente(1000) });
    const p = await env.DB.prepare("SELECT precio_venta FROM productos WHERE id = 'p1'").first<{ precio_venta: number }>();
    expect(p?.precio_venta).toBeCloseTo(1.1, 6);
  });
});
