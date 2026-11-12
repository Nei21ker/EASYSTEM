// Cobro rápido del Local Vidrios: los datos del cliente son opcionales SOLO en locales de tipo vidrios.
// En los demás locales siguen siendo obligatorios, y si en Vidrios se escribe algo se valida completo.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { guardarVenta, listarVentas } from '../../src/server/servicios/ventas';
import { CLIENTE_SIN_DATOS, esClienteSinDatos } from '../../src/utils/clienteSinDatos';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let admin: UsuarioDePrueba, vendedorVid: UsuarioDePrueba, vendedorAcc: UsuarioDePrueba;
let sA: Sesion, sVV: Sesion, sVA: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  vendedorVid = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios });
  vendedorAcc = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  [sA, sVV, sVA] = await Promise.all([admin, vendedorVid, vendedorAcc].map(sesionDe));
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

const venta = (local: string, extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: local,
  cliente_cedula: '',
  cliente_nombre: '',
  cliente_telefono: '',
  metodo_pago: 'USD_EFECTIVO',
  pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 5, monto_bs: null }],
  vuelto: null,
  total: 5,
  items: [{ producto_id: 'p1', nombre: 'Vidrio blindado', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 5 }],
  tasa_cambio: 36.5,
  total_bs: null,
  ...extra,
});

const clientesGuardados = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM clientes').first<{ n: number }>())!.n;

describe('venta sin datos del cliente (cobro rápido)', () => {
  it('en el Local Vidrios se registra sin cliente y queda marcada como «sin datos»', async () => {
    const guardada = await guardarVenta(env, sVV, venta(vidrios));
    expect(guardada.cliente_cedula).toBe(CLIENTE_SIN_DATOS.cedula);
    expect(guardada.cliente_nombre).toBe(CLIENTE_SIN_DATOS.nombre);
    expect(esClienteSinDatos(guardada)).toBe(true);
    expect((await listarVentas(env, sA, {})).length).toBe(1);
  });

  it('una venta sin datos no recuerda a ningún cliente', async () => {
    await guardarVenta(env, sVV, venta(vidrios));
    expect(await clientesGuardados()).toBe(0);
  });

  it('un cliente ya marcado como «sin datos» (cola sin conexión, demo) también se acepta en Vidrios', async () => {
    const guardada = await guardarVenta(
      env,
      sVV,
      venta(vidrios, { cliente_cedula: CLIENTE_SIN_DATOS.cedula, cliente_nombre: CLIENTE_SIN_DATOS.nombre, cliente_telefono: CLIENTE_SIN_DATOS.telefono })
    );
    expect(esClienteSinDatos(guardada)).toBe(true);
    expect(await clientesGuardados()).toBe(0);
  });

  it('con los datos completos se guardan y el cliente se recuerda como siempre', async () => {
    const guardada = await guardarVenta(env, sVV, venta(vidrios, { cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez', cliente_telefono: '0414-1234567' }));
    expect(guardada.cliente_nombre).toBe('Ana Pérez');
    expect(esClienteSinDatos(guardada)).toBe(false);
    expect(await clientesGuardados()).toBe(1);
  });

  it('si en Vidrios se escribe solo una parte de los datos, se rechaza (no se adivinan los demás)', async () => {
    await rechazo(guardarVenta(env, sVV, venta(vidrios, { cliente_nombre: 'Ana Pérez' })), 400, /datos del cliente/i);
    await rechazo(guardarVenta(env, sVV, venta(vidrios, { cliente_cedula: 'V-12345678', cliente_nombre: 'Ana Pérez' })), 400, /datos del cliente/i);
    expect(await listarVentas(env, sA, {})).toEqual([]);
  });

  it('en los demás locales los datos del cliente siguen siendo obligatorios', async () => {
    await rechazo(guardarVenta(env, sVA, venta(accesorios)), 400, /datos del cliente/i);
    await rechazo(
      guardarVenta(env, sVA, venta(accesorios, { cliente_cedula: CLIENTE_SIN_DATOS.cedula, cliente_nombre: CLIENTE_SIN_DATOS.nombre, cliente_telefono: CLIENTE_SIN_DATOS.telefono })),
      400,
      /datos del cliente/i
    );
    expect(await listarVentas(env, sA, {})).toEqual([]);
  });
});
