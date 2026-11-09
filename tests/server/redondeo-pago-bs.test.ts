// Pago móvil redondeado por el cliente: la venta se guarda con lo que pagó (monto_bs) y lo que debía (monto_bs_debido).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { guardarVenta, listarVentas } from '../../src/server/servicios/ventas';
import type { NuevaVenta, PagoVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios } = IDS_LOCALES;
let vendedor: Sesion, encargado: Sesion;

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const uV = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  const uE = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios });
  vendedor = await cargarSesion(env, peticionComo(uV));
  encargado = await cargarSesion(env, peticionComo(uE));
});

const venta = (pagos: PagoVenta[], extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: accesorios,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'Ana Pérez',
  cliente_telefono: '0414-1234567',
  metodo_pago: 'BS_PAGO_MOVIL',
  pagos,
  vuelto: null,
  total: 7,
  items: [{ producto_id: 'p-x', nombre: 'Forro', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 7 }],
  tasa_cambio: 100,
  total_bs: pagos.reduce((s, p) => s + (p.monto_bs ?? 0), 0),
  referencia_pago_movil: '1234',
  ...extra,
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

describe('pago en bolívares redondeado', () => {
  it('se guarda lo que pagó y lo que debía, y el historial lo devuelve', async () => {
    const v = await guardarVenta(env, vendedor, venta([{ metodo: 'BS_PAGO_MOVIL', monto_bs: 710, monto_usd: 7, monto_bs_debido: 700 }]));
    expect(v.pagos?.[0]).toMatchObject({ monto_bs: 710, monto_usd: 7, monto_bs_debido: 700 });
    expect(v.total_bs).toBe(710);
    const [guardada] = await listarVentas(env, encargado, {});
    expect(guardada.pagos?.[0].monto_bs_debido).toBe(700);
  });

  it('sin redondeo el pago queda como siempre (sin el campo)', async () => {
    const v = await guardarVenta(env, vendedor, venta([{ metodo: 'BS_PAGO_MOVIL', monto_bs: 700, monto_usd: 7 }]));
    expect(v.pagos?.[0].monto_bs_debido).toBeUndefined();
  });

  it('se rechaza un redondeo incoherente: tipo en dólares, debido mayor a lo pagado o exceso fuera del tope', async () => {
    await rechazo(guardarVenta(env, vendedor, venta([{ metodo: 'USD_EFECTIVO', monto_bs: null, monto_usd: 7, monto_bs_debido: 700 }], { metodo_pago: 'USD_EFECTIVO', total_bs: null })), 400, /redondeo/i);
    await rechazo(guardarVenta(env, vendedor, venta([{ metodo: 'BS_PAGO_MOVIL', monto_bs: 700, monto_usd: 7, monto_bs_debido: 800 }])), 400, /redondeo/i);
    await rechazo(guardarVenta(env, vendedor, venta([{ metodo: 'BS_PAGO_MOVIL', monto_bs: 1300, monto_usd: 7, monto_bs_debido: 700 }])), 400, /redondeo/i);
  });
});
