import { describe, expect, it } from 'vitest';
import {
  errorDeCobro,
  inicioDelPeriodo,
  PORCENTAJE_LOCAL_PREDETERMINADO,
  repartoDeCobro,
  repuestosDeOrdenUsd,
  resumenPorTecnico,
  resumirTecnico,
  resumirTienda,
} from '../../src/utils/servicioTecnico';
import type { OrdenServicio } from '../../src/types/database.types';

const repuesto = (cantidad: number, precio: number) => ({ producto_id: 'p', nombre: 'Pantalla', codigo_barras: '1', cantidad, precio_unitario: precio });

describe('reparto del cobro de una reparación', () => {
  it('ejemplo del dueño: pantalla de $10, cobro de $25 y 20 % → local $3, técnico $12, la pieza queda en la tienda', () => {
    expect(repartoDeCobro({ totalCobrado: 25, repuestosUsd: 10, porcentaje: 20 })).toEqual({
      ganancia: 15,
      comision_local_usd: 3,
      pago_tecnico_usd: 12,
    });
  });

  it('el porcentaje puede variar por trabajo (40 %)', () => {
    expect(repartoDeCobro({ totalCobrado: 25, repuestosUsd: 10, porcentaje: 40 })).toMatchObject({ comision_local_usd: 6, pago_tecnico_usd: 9 });
  });

  it('si el técnico usa una pieza suya (sin repuestos del local) el porcentaje se calcula sobre todo lo cobrado', () => {
    expect(repartoDeCobro({ totalCobrado: 20, repuestosUsd: 0, porcentaje: 30 })).toEqual({ ganancia: 20, comision_local_usd: 6, pago_tecnico_usd: 14 });
  });

  it('redondea a centavos y la suma siempre cuadra con la ganancia', () => {
    const r = repartoDeCobro({ totalCobrado: 10.01, repuestosUsd: 3.33, porcentaje: 33.33 });
    expect(Math.round((r.comision_local_usd + r.pago_tecnico_usd) * 100) / 100).toBe(r.ganancia);
  });

  it('0 % deja todo al técnico y 100 % todo a la tienda', () => {
    expect(repartoDeCobro({ totalCobrado: 15, repuestosUsd: 5, porcentaje: 0 })).toMatchObject({ comision_local_usd: 0, pago_tecnico_usd: 10 });
    expect(repartoDeCobro({ totalCobrado: 15, repuestosUsd: 5, porcentaje: 100 })).toMatchObject({ comision_local_usd: 10, pago_tecnico_usd: 0 });
  });

  it('el porcentaje de fábrica es 30', () => {
    expect(PORCENTAJE_LOCAL_PREDETERMINADO).toBe(30);
  });
});

describe('validación del cobro', () => {
  it('no deja cobrar menos de lo que cuestan los repuestos', () => {
    expect(errorDeCobro({ totalCobrado: 8, repuestosUsd: 10, porcentaje: 30 })).toMatch(/repuestos/);
  });
  it('porcentaje fuera de 0–100 o no numérico', () => {
    expect(errorDeCobro({ totalCobrado: 25, repuestosUsd: 10, porcentaje: 101 })).toMatch(/porcentaje/i);
    expect(errorDeCobro({ totalCobrado: 25, repuestosUsd: 10, porcentaje: -1 })).toMatch(/porcentaje/i);
    expect(errorDeCobro({ totalCobrado: 25, repuestosUsd: 10, porcentaje: Number.NaN })).toMatch(/porcentaje/i);
  });
  it('el total debe ser un número no negativo', () => {
    expect(errorDeCobro({ totalCobrado: -1, repuestosUsd: 0, porcentaje: 30 })).toMatch(/total/i);
    expect(errorDeCobro({ totalCobrado: Number.NaN, repuestosUsd: 0, porcentaje: 30 })).toMatch(/total/i);
  });
  it('un cobro correcto no da error', () => {
    expect(errorDeCobro({ totalCobrado: 25, repuestosUsd: 10, porcentaje: 30 })).toBeNull();
    expect(errorDeCobro({ totalCobrado: 0, repuestosUsd: 0, porcentaje: 30 })).toBeNull();
  });
});

describe('repuestos de una orden', () => {
  it('suma cantidad × precio de catálogo', () => {
    expect(repuestosDeOrdenUsd([repuesto(1, 10), repuesto(2, 3.5)])).toBe(17);
    expect(repuestosDeOrdenUsd([])).toBe(0);
  });
});

function orden(extra: Partial<OrdenServicio>): OrdenServicio {
  return {
    id: 'o', folio: 1, local_id: 'L', cliente_cedula: 'V-1', cliente_nombre: 'Ana', cliente_telefono: '04141234567', equipo_marca: 'Apple', equipo_modelo: 'iPhone',
    falla_reportada: 'x', diagnostico: null, estado: 'pendiente', repuestos: [], mano_de_obra_usd: 0, total_usd: 0, recibida_en: '2026-11-10T10:00:00.000Z',
    actualizada_en: '2026-11-10T10:00:00.000Z', ...extra,
  } as OrdenServicio;
}

const cobrada = (tecnico: string, pago: number, en: string, pagado = false, extra: Partial<OrdenServicio> = {}) =>
  orden({
    estado: 'entregado', tecnico_id: tecnico, tecnico_nombre: tecnico.toUpperCase(), cobrado_en: en, pago_tecnico_usd: pago, comision_local_usd: 1,
    tecnico_pagado_en: pagado ? '2026-11-14T10:00:00.000Z' : null, ...extra,
  });

describe('resumen del técnico (su historial)', () => {
  const ordenes = [
    cobrada('r', 12, '2026-11-02T10:00:00.000Z', true),
    cobrada('r', 9, '2026-11-12T10:00:00.000Z'),
    cobrada('m', 50, '2026-11-12T10:00:00.000Z'),
    orden({ estado: 'en_reparacion', tecnico_id: 'r' }),
    orden({ estado: 'entregado', tecnico_id: 'r' }), // entregada antes del cobro con porcentaje: no cuenta
  ];

  it('cuenta solo los trabajos cobrados del técnico: hechos, ganado, pagado y por cobrar', () => {
    expect(resumirTecnico(ordenes, 'r')).toEqual({ trabajos: 2, ganado: 21, pagado: 12, pendiente: 9, enCurso: 1 });
  });

  it('se puede acotar desde una fecha (p. ej. el mes)', () => {
    expect(resumirTecnico(ordenes, 'r', '2026-11-10T00:00:00.000Z')).toMatchObject({ trabajos: 1, ganado: 9, pagado: 0, pendiente: 9 });
  });

  it('sin trabajos todo es cero', () => {
    expect(resumirTecnico([], 'r')).toEqual({ trabajos: 0, ganado: 0, pagado: 0, pendiente: 0, enCurso: 0 });
  });
});

describe('resumen por técnico (para pagarles)', () => {
  const ordenes = [
    cobrada('r', 12, '2026-11-02T10:00:00.000Z', true, { id: 'a' }),
    cobrada('r', 9, '2026-11-12T10:00:00.000Z', false, { id: 'b' }),
    cobrada('r', 4.5, '2026-11-13T10:00:00.000Z', false, { id: 'c' }),
    cobrada('m', 50, '2026-11-12T10:00:00.000Z', false, { id: 'd' }),
  ];

  it('agrupa por técnico con lo que se les debe y los ids que se liquidan', () => {
    const r = resumenPorTecnico(ordenes);
    const ricardo = r.find((x) => x.tecnico_id === 'r')!;
    expect(ricardo).toMatchObject({ tecnico_nombre: 'R', trabajos: 3, ganado: 25.5, pagado: 12, pendiente: 13.5 });
    expect(ricardo.idsPendientes.sort()).toEqual(['b', 'c']);
    expect(r.find((x) => x.tecnico_id === 'm')).toMatchObject({ pendiente: 50, idsPendientes: ['d'] });
  });

  it('ordena primero a quien más se le debe', () => {
    expect(resumenPorTecnico(ordenes).map((x) => x.tecnico_id)).toEqual(['m', 'r']);
  });
});

describe('períodos del resumen', () => {
  // 2026-11-12 es jueves
  const ahora = new Date(2026, 10, 12, 15, 30);
  it('hoy, semana (desde el lunes), mes y todo', () => {
    expect(inicioDelPeriodo('hoy', ahora)).toBe(new Date(2026, 10, 12).toISOString());
    expect(inicioDelPeriodo('semana', ahora)).toBe(new Date(2026, 10, 9).toISOString());
    expect(inicioDelPeriodo('mes', ahora)).toBe(new Date(2026, 10, 1).toISOString());
    expect(inicioDelPeriodo('todo', ahora)).toBeUndefined();
  });
  it('un domingo la semana empieza el lunes anterior', () => {
    expect(inicioDelPeriodo('semana', new Date(2026, 10, 15, 9, 0))).toBe(new Date(2026, 10, 9).toISOString());
  });
});

describe('resumen de la tienda en un período', () => {
  const ordenes = [
    cobrada('r', 12, '2026-11-02T10:00:00.000Z', true, { total_usd: 25, comision_local_usd: 3 }),
    cobrada('m', 50, '2026-11-12T10:00:00.000Z', false, { total_usd: 80, comision_local_usd: 20 }),
    orden({ estado: 'en_reparacion', total_usd: 99 }),
  ];
  it('suma lo cobrado, la comisión de la tienda y lo que va para los técnicos', () => {
    expect(resumirTienda(ordenes)).toEqual({ trabajos: 2, cobrado: 105, comision: 23, paraTecnicos: 62 });
  });
  it('se puede acotar desde una fecha', () => {
    expect(resumirTienda(ordenes, '2026-11-10T00:00:00.000Z')).toEqual({ trabajos: 1, cobrado: 80, comision: 20, paraTecnicos: 50 });
  });
});
