import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, reiniciarBase } from './ayudas';
import { ahoraISO, nuevoId, rangoDelDiaUTC, redondear2, sentenciaContador } from '../../src/server/util';
import { bd } from '../../src/server/db/cliente';
import { locales, ventas } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';

const env = crearEntornoDePrueba();

beforeEach(() => reiniciarBase(env.DB));

describe('utilidades', () => {
  it('redondear2 deja dos decimales (sin arrastrar el error de coma flotante)', () => {
    expect(redondear2(0.1 + 0.2)).toBe(0.3);
    expect(redondear2(1.005 + 1.005)).toBe(2.01);
    expect(redondear2(38 * 2)).toBe(76);
  });

  it('nuevoId produce UUID distintos', () => {
    const a = nuevoId();
    const b = nuevoId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('ahoraISO es ISO-8601 en UTC', () => {
    expect(ahoraISO()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it('sentenciaContador numera 1, 2, 3 dentro de un lote y cada nombre va por separado', async () => {
    const lote = await env.DB.batch<{ valor: number }>([
      sentenciaContador(env.DB, 'ventas'),
      sentenciaContador(env.DB, 'ventas'),
      sentenciaContador(env.DB, 'devoluciones'),
      sentenciaContador(env.DB, 'ventas'),
    ]);
    expect(lote.map((r) => r.results[0].valor)).toEqual([1, 2, 1, 3]);
  });
});

describe('rangoDelDiaUTC (el día del negocio, no el de UTC)', () => {
  it('en Venezuela (UTC-4, sin horario de verano) el día empieza a las 04:00 UTC', () => {
    expect(rangoDelDiaUTC('2026-11-03', 'America/Caracas')).toEqual({ desde: '2026-11-03T04:00:00.000Z', hasta: '2026-11-04T04:00:00.000Z' });
  });

  it('con UTC el día coincide con el de UTC', () => {
    expect(rangoDelDiaUTC('2026-11-03', 'UTC')).toEqual({ desde: '2026-11-03T00:00:00.000Z', hasta: '2026-11-04T00:00:00.000Z' });
  });

  it('respeta el horario de verano de otras zonas (Madrid cambia de hora el 25 de octubre de 2026)', () => {
    expect(rangoDelDiaUTC('2026-10-24', 'Europe/Madrid').desde).toBe('2026-10-23T22:00:00.000Z');
    expect(rangoDelDiaUTC('2026-10-25', 'Europe/Madrid')).toEqual({ desde: '2026-10-24T22:00:00.000Z', hasta: '2026-10-25T23:00:00.000Z' });
  });

  it('una fecha inválida lanza error', () => {
    expect(() => rangoDelDiaUTC('03/11/2026', 'UTC')).toThrow();
    expect(() => rangoDelDiaUTC('2026-02-30', 'UTC')).toThrow();
  });
});

describe('Drizzle sobre D1', () => {
  it('guarda y lee una fila con columnas JSON como objetos', async () => {
    const db = bd(env);
    await db.insert(locales).values({ id: 'l1', nombre: 'Local Accesorios', tipo: 'accesorios' });
    const items = [{ producto_id: 'p1', nombre: 'Forro', codigo_barras: '2000000000015', cantidad: 2, precio_unitario: 6, unidades: ['2100000000012'] }];
    await db.insert(ventas).values({
      id: 'v1', folio: 1, local_id: 'l1', cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567',
      metodo_pago: 'USD_EFECTIVO', total: 12, items,
    });
    const [fila] = await db.select().from(ventas).where(eq(ventas.id, 'v1'));
    expect(fila.items).toEqual(items);
    expect(fila.pagos).toBeNull();
    expect(fila.total).toBe(12);
  });
});
