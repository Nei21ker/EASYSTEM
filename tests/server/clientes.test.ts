import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { buscarCliente } from '../../src/server/servicios/clientes';
import { guardarVenta } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let sV: Sesion, sV2: Sesion, sC: Sesion, sA: Sesion;
const sesionDe = (u: UsuarioDePrueba) => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  const vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  const otro = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios });
  const contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  const admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  [sV, sV2, sC, sA] = await Promise.all([vendedor, otro, contador, admin].map(sesionDe));
});

const venta = (extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-10-20T15:00:00.000Z',
  local_id: accesorios,
  cliente_cedula: 'V-12345678',
  cliente_nombre: 'María José Pérez García',
  cliente_apellido: 'Pérez García',
  cliente_telefono: '0414-1234567',
  metodo_pago: 'USD_EFECTIVO',
  pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 6, monto_bs: null }],
  vuelto: null,
  total: 6,
  items: [{ producto_id: 'p1', nombre: 'Cargador', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 6, unidades: [] }],
  tasa_cambio: 36.5,
  total_bs: null,
  ...extra,
});

async function rechazo(promesa: Promise<unknown>, status: number) {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    return;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

describe('clientes que ya compraron', () => {
  it('una cédula que nunca compró no devuelve nada', async () => {
    expect(await buscarCliente(env, sV, 'V-99999999')).toBeNull();
  });

  it('después de una venta se recuerda al cliente con nombre, apellido y teléfono separados', async () => {
    await guardarVenta(env, sV, venta());
    expect(await buscarCliente(env, sV, 'V-12345678')).toEqual({ cedula: 'V-12345678', nombre: 'María José', apellido: 'Pérez García', telefono: '0414-1234567' });
  });

  it('otro vendedor, de otro local, también lo encuentra (el cliente es de todos los locales)', async () => {
    await guardarVenta(env, sV, venta());
    expect(await buscarCliente(env, sV2, 'v-12345678')).toMatchObject({ nombre: 'María José', apellido: 'Pérez García' });
  });

  it('una compra nueva actualiza sus datos (teléfono nuevo) sin duplicarlo', async () => {
    await guardarVenta(env, sV, venta());
    await guardarVenta(env, sV2, venta({ local_id: vidrios, cliente_telefono: '0424-7654321' }));
    expect(await buscarCliente(env, sV, 'V-12345678')).toMatchObject({ telefono: '0424-7654321' });
    expect((await env.DB.prepare('SELECT count(*) AS n FROM clientes').first<{ n: number }>())?.n).toBe(1);
  });

  it('sin apellido aparte (ventas viejas o del modo demo) el nombre completo queda como nombre', async () => {
    await guardarVenta(env, sV, venta({ cliente_apellido: undefined, cliente_nombre: 'Ana Gómez' }));
    expect(await buscarCliente(env, sV, 'V-12345678')).toMatchObject({ nombre: 'Ana Gómez', apellido: '' });
  });

  it('si la venta falla no queda el cliente guardado a medias', async () => {
    await rechazo(guardarVenta(env, sV, venta({ total: -1 })), 400);
    expect(await buscarCliente(env, sV, 'V-12345678')).toBeNull();
  });

  it('el contador no puede consultar clientes; el administrador sí; una cédula con basura no rompe nada', async () => {
    await guardarVenta(env, sV, venta());
    await rechazo(buscarCliente(env, sC, 'V-12345678'), 403);
    expect(await buscarCliente(env, sA, 'V-12345678')).not.toBeNull();
    expect(await buscarCliente(env, sV, "V-1'; DROP TABLE clientes;--")).toBeNull();
    expect(await buscarCliente(env, sV, '')).toBeNull();
  });
});
