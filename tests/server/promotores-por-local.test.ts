// Promotores por local (migración 0028): el selector del cobro con precio de promotor muestra los promotores registrados en ESE local.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { autorizarPrecio } from '../../src/server/servicios/autorizaciones';
import { crearPromotor, listarPromotoresDelLocal } from '../../src/server/servicios/promotores';
import { guardarVenta } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let uAdmin: UsuarioDePrueba, uEncargadoVid: UsuarioDePrueba, uEncargadoAcc: UsuarioDePrueba, uVendedorVid: UsuarioDePrueba, uTecnico: UsuarioDePrueba, uContador: UsuarioDePrueba;
let admin: Sesion, encargadoVid: Sesion, encargadoAcc: Sesion, vendedorVid: Sesion, tecnico: Sesion, contador: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

const PRODUCTO = 'p-vidrio';
const LUIS = { cedula: 'V-11111111', nombre: 'Luis', apellido: 'Mora', telefono: '0414-1234567', banco: 'Banesco' };
const ANA = { cedula: 'V-22222222', nombre: 'Ana', apellido: 'Rojas' };

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  uAdmin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null, nombre: 'Ada Admin', clave: 'Clave-administrador-null-123' });
  uEncargadoVid = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Vidrios', clave: 'Clave-encargado-vidrios-123' });
  uEncargadoAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, nombre: 'Ema Accesorios', clave: 'Clave-encargado-accesorios-123' });
  uVendedorVid = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios, nombre: 'Vera Vendedora', clave: 'Clave-vendedor-vidrios-123' });
  uTecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: vidrios, clave: 'Clave-tecnico-vidrios-123' });
  uContador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null, nombre: 'Cora Contadora', clave: 'Clave-contador-null-123' });
  [admin, encargadoVid, encargadoAcc, vendedorVid, tecnico, contador] = await Promise.all([uAdmin, uEncargadoVid, uEncargadoAcc, uVendedorVid, uTecnico, uContador].map(sesionDe));
  await env.DB
    .prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES (?, '2000000000015', 'Vidrio blindado A15', 'Vidrios Templados', 2, 12, 0)")
    .bind(PRODUCTO)
    .run();
});

const nombres = async (s: Sesion, localId?: string) => (await listarPromotoresDelLocal(env, s, localId)).map((p) => p.nombre);

describe('promotores por local', () => {
  it('un promotor registrado en Vidrios aparece en la lista de Vidrios y no en la de Accesorios', async () => {
    await crearPromotor(env, encargadoVid, LUIS);
    await crearPromotor(env, encargadoAcc, ANA);
    expect(await nombres(vendedorVid)).toEqual(['Luis']); // también el vendedor
    expect(await nombres(encargadoVid)).toEqual(['Luis']);
    expect(await nombres(encargadoAcc)).toEqual(['Ana']);
  });

  it('el administrador elige el local; sin elegir ve todos', async () => {
    await crearPromotor(env, encargadoVid, LUIS);
    await crearPromotor(env, encargadoAcc, ANA);
    expect(await nombres(admin, vidrios)).toEqual(['Luis']);
    expect(await nombres(admin, accesorios)).toEqual(['Ana']);
    expect((await nombres(admin)).sort()).toEqual(['Ana', 'Luis']);
  });

  it('el administrador puede registrar a un promotor en un local concreto con local_id', async () => {
    await crearPromotor(env, admin, { ...LUIS, local_id: accesorios });
    expect(await nombres(encargadoAcc)).toEqual(['Luis']);
    expect(await nombres(vendedorVid)).toEqual([]);
  });

  it('un encargado no puede registrar promotores en el local de otro', async () => {
    await expect(crearPromotor(env, encargadoVid, { ...LUIS, local_id: accesorios })).rejects.toBeInstanceOf(ErrorApi);
    expect(await nombres(admin)).toEqual([]);
  });

  it('vender en otro local con la cédula de un promotor lo agrega también a la lista de ese local', async () => {
    await crearPromotor(env, encargadoVid, LUIS);
    expect(await nombres(encargadoAcc)).toEqual([]);
    await env.DB.prepare("INSERT INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo) VALUES (?, ?, 5, 0)").bind(accesorios, PRODUCTO).run();
    const vendedorAcc = await sesionDe(await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios, nombre: 'Vico Acc', clave: 'Clave-vendedor-accesorios-123' }));
    const aut = await autorizarPrecio(env, vendedorAcc, { local_id: accesorios, promotor: LUIS, lineas: [{ producto_id: PRODUCTO, precio: 15 }] });
    const nueva: NuevaVenta = {
      fecha: '2026-11-03T15:00:00.000Z',
      local_id: accesorios,
      cliente_cedula: 'V-12345678',
      cliente_nombre: 'Ana Pérez',
      cliente_telefono: '0414-1234567',
      metodo_pago: 'USD_EFECTIVO',
      pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 15, monto_bs: null }],
      vuelto: null,
      total: 15,
      items: [{ producto_id: PRODUCTO, nombre: 'Vidrio blindado A15', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 15 }],
      tasa_cambio: 36.5,
      total_bs: null,
      promotor: LUIS,
      autorizacion_precio: aut.token,
    };
    await guardarVenta(env, vendedorAcc, nueva);
    expect(await nombres(encargadoAcc)).toEqual(['Luis']);
    expect(await nombres(vendedorVid)).toEqual(['Luis']); // sigue en Vidrios
  });

  it('el técnico y el contador no pueden pedir la lista', async () => {
    await expect(listarPromotoresDelLocal(env, tecnico)).rejects.toMatchObject({ status: 403 });
    await expect(listarPromotoresDelLocal(env, contador)).rejects.toMatchObject({ status: 403 });
  });
});
