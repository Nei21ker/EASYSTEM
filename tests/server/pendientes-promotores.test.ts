// Promotores registrados y Pendientes (migración 0018): la venta con precio de promotor anota la comisión por pagar y deja al promotor en el
// directorio (con su banco receptor); el encargado anota la mercancía que un promotor se llevó; gerente/administrador/contador pagan comisiones.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { autorizarPrecio } from '../../src/server/servicios/autorizaciones';
import { asignarPromotorAPendiente, cerrarPendiente, crearPendienteMercancia, listarPendientes, pagarComisionesPromotor } from '../../src/server/servicios/pendientes';
import { actualizarPromotor, buscarPromotorPorCedula, crearPromotor, listarPromotores } from '../../src/server/servicios/promotores';
import { eliminarVentas, guardarVenta } from '../../src/server/servicios/ventas';
import type { NuevaVenta } from '../../src/types/database.types';

const env = crearEntornoDePrueba();
const { accesorios, vidrios } = IDS_LOCALES;

let uAdmin: UsuarioDePrueba, uGerente: UsuarioDePrueba, uEncargado: UsuarioDePrueba, uEncargadoAcc: UsuarioDePrueba, uVendedor: UsuarioDePrueba, uContador: UsuarioDePrueba, uTecnico: UsuarioDePrueba;
let admin: Sesion, gerente: Sesion, encargado: Sesion, encargadoAcc: Sesion, vendedor: Sesion, contador: Sesion, tecnico: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

const PRODUCTO = 'p-vidrio';
const PROMOTOR = { cedula: 'V-11111111', nombre: 'Pedro', apellido: 'Promotor', telefono: '0414-1234567', banco: 'Banesco' };

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  uAdmin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null, nombre: 'Ada Admin', clave: 'Clave-administrador-null-123' });
  uGerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null, nombre: 'Gaby Gerente', clave: 'Clave-gerente-null-123' });
  uEncargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: vidrios, nombre: 'Eli Vidrios', clave: 'Clave-encargado-vidrios-123' });
  uEncargadoAcc = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios, nombre: 'Ema Accesorios', clave: 'Clave-encargado-accesorios-123' });
  uVendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios, nombre: 'Vera Vendedora', clave: 'Clave-vendedor-vidrios-123' });
  uContador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null, nombre: 'Cora Contadora', clave: 'Clave-contador-null-123' });
  uTecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: vidrios, clave: 'Clave-tecnico-vidrios-123' });
  [admin, gerente, encargado, encargadoAcc, vendedor, contador, tecnico] = await Promise.all([uAdmin, uGerente, uEncargado, uEncargadoAcc, uVendedor, uContador, uTecnico].map(sesionDe));
  await env.DB
    .prepare("INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo) VALUES (?, '2000000000015', 'Vidrio blindado A15', 'Vidrios Templados', 2, 12, 0)")
    .bind(PRODUCTO)
    .run();
});

async function rechazo(promesa: Promise<unknown>, status: number, codigo?: string, texto?: string | RegExp): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).status).toBe(status);
    if (codigo) expect((err as ErrorApi).codigo).toBe(codigo);
    if (texto) expect((err as ErrorApi).message).toMatch(texto);
    return err as ErrorApi;
  }
  throw new Error('Debía rechazarse y no se rechazó');
}

const venta = (extra: Partial<NuevaVenta> = {}): NuevaVenta => ({
  fecha: '2026-11-03T15:00:00.000Z',
  local_id: vidrios,
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
  ...extra,
});

/** Vende con precio de promotor ($15 sobre la lista de $12 = $3 de comisión), autorizado por el encargado del local. */
async function ventaConPromotor(promotor: Record<string, string | null> | null = PROMOTOR, extra: Partial<NuevaVenta> = {}) {
  const aut = await autorizarPrecio(env, vendedor, { email: uEncargado.email, clave: uEncargado.clave, local_id: vidrios, promotor, lineas: [{ producto_id: PRODUCTO, precio: 15 }] });
  return guardarVenta(env, vendedor, venta({ promotor, autorizacion_precio: aut.token, ...extra }));
}

const n = async (sql: string, ...v: unknown[]) => (await env.DB.prepare(sql).bind(...v).first<{ n: number }>())!.n;

describe('la venta con precio de promotor anota la comisión y registra al promotor', () => {
  it('crea el pendiente de comisión (con venta y folio) y deja al promotor con su banco receptor', async () => {
    const v = await ventaConPromotor();
    expect(v.comision).toBe(3);
    expect(v.promotor_banco).toBe('Banesco');
    const [p] = await listarPendientes(env, encargado);
    expect(p).toMatchObject({ tipo: 'COMISION', estado: 'PENDIENTE', monto_usd: 3, local_id: vidrios, venta_id: v.id, venta_folio: v.folio, promotor_cedula: 'V-11111111', promotor_nombre: 'Pedro Promotor', promotor_telefono: '0414-1234567', promotor_banco: 'Banesco' });
    expect(p.descripcion).toMatch(/Vidrio blindado A15/);
    const promotor = await buscarPromotorPorCedula(env, vendedor, '11111111');
    expect(promotor).toMatchObject({ cedula: 'V-11111111', nombre: 'Pedro', apellido: 'Promotor', banco: 'Banesco', telefono: '0414-1234567' });
  });

  it('una segunda venta del mismo promotor no lo duplica: completa lo que faltaba y no pisa con vacíos', async () => {
    await ventaConPromotor();
    // La segunda venta no anota banco ni teléfono: se conservan los del directorio
    await ventaConPromotor({ cedula: 'V-11111111', nombre: 'Pedro', apellido: 'Promotor', telefono: null, banco: null }, { cliente_cedula: 'V-22222222' });
    expect(await n('SELECT count(*) AS n FROM promotores')).toBe(1);
    expect((await buscarPromotorPorCedula(env, vendedor, 'V-11111111'))!.banco).toBe('Banesco');
    expect(await n("SELECT count(*) AS n FROM pendientes WHERE tipo = 'COMISION'")).toBe(2);
    // Un banco nuevo SÍ actualiza el directorio
    await ventaConPromotor({ ...PROMOTOR, banco: 'Mercantil' }, { cliente_cedula: 'V-33333333' });
    expect((await buscarPromotorPorCedula(env, vendedor, 'V-11111111'))!.banco).toBe('Mercantil');
  });

  it('corregir el banco no invalida la autorización de precio (no es dato de identidad)', async () => {
    const aut = await autorizarPrecio(env, vendedor, { email: uEncargado.email, clave: uEncargado.clave, local_id: vidrios, promotor: PROMOTOR, lineas: [{ producto_id: PRODUCTO, precio: 15 }] });
    const v = await guardarVenta(env, vendedor, venta({ promotor: { ...PROMOTOR, banco: 'Provincial' }, autorizacion_precio: aut.token }));
    expect(v.promotor_banco).toBe('Provincial');
  });

  it('sin cédula también se anota la comisión (sin promotor del directorio) y luego se ata a uno registrado', async () => {
    await ventaConPromotor({ nombre: 'Juan', apellido: 'Suelto' });
    expect(await n('SELECT count(*) AS n FROM promotores')).toBe(0);
    const [p] = await listarPendientes(env, encargado);
    expect(p).toMatchObject({ promotor_id: null, promotor_nombre: 'Juan Suelto', monto_usd: 3 });

    const registrado = await crearPromotor(env, gerente, { cedula: 'V-44444444', nombre: 'Juan', apellido: 'Suelto', banco: 'BNC' });
    const atado = await asignarPromotorAPendiente(env, encargado, p.id, registrado.id);
    expect(atado).toMatchObject({ promotor_id: registrado.id, promotor_cedula: 'V-44444444', promotor_banco: 'BNC' });
    await rechazo(asignarPromotorAPendiente(env, encargado, p.id, 'no-existe'), 400);
  });

  it('con "precio del local" (sin promotor) no hay comisión ni pendiente', async () => {
    const aut = await autorizarPrecio(env, vendedor, { email: uEncargado.email, clave: uEncargado.clave, local_id: vidrios, modo: 'local', lineas: [{ producto_id: PRODUCTO, precio: 15 }] });
    await guardarVenta(env, vendedor, venta({ autorizacion_precio: aut.token }));
    expect(await n('SELECT count(*) AS n FROM pendientes')).toBe(0);
    expect(await n('SELECT count(*) AS n FROM promotores')).toBe(0);
  });

  it('un banco con caracteres raros se rechaza', async () => {
    await rechazo(autorizarPrecio(env, vendedor, { email: uEncargado.email, clave: uEncargado.clave, local_id: vidrios, promotor: { ...PROMOTOR, banco: '<script>' }, lineas: [{ producto_id: PRODUCTO, precio: 15 }] }), 400, 'promotor_invalido', /banco/i);
  });
});

describe('directorio de promotores', () => {
  it('administrador, gerente, encargado y contador agregan y corrigen; vendedor y técnico no', async () => {
    for (const [s, ced] of [[admin, 'V-10000001'], [gerente, 'V-10000002'], [encargado, 'V-10000003'], [contador, 'V-10000004']] as const) {
      expect((await crearPromotor(env, s, { cedula: ced, nombre: 'Ana', apellido: 'Gómez' })).cedula).toBe(ced);
    }
    await rechazo(crearPromotor(env, vendedor, { cedula: 'V-10000005', nombre: 'Ana', apellido: 'Gómez' }), 403);
    await rechazo(crearPromotor(env, tecnico, { cedula: 'V-10000005', nombre: 'Ana', apellido: 'Gómez' }), 403);
    const [primero] = await listarPromotores(env, contador);
    const corregido = await actualizarPromotor(env, contador, primero.id, { cedula: primero.cedula, nombre: 'Anita', apellido: 'Gómez', banco: 'Banesco' });
    expect(corregido).toMatchObject({ nombre: 'Anita', banco: 'Banesco' });
  });

  it('la cédula es única y la cédula, el nombre y el apellido son obligatorios', async () => {
    await crearPromotor(env, encargado, { cedula: '12345678', nombre: 'Luis', apellido: 'Mora', telefono: '04141234567' });
    const repetido = await rechazo(crearPromotor(env, gerente, { cedula: 'V-12345678', nombre: 'Otro', apellido: 'Distinto' }), 409, 'promotor_repetido');
    expect(repetido.message).toMatch(/Luis Mora/);
    await rechazo(crearPromotor(env, gerente, { cedula: 'abc', nombre: 'Ana', apellido: 'Gómez' }), 400, 'promotor_invalido');
    await rechazo(crearPromotor(env, gerente, { cedula: 'V-12345679', nombre: '', apellido: 'Gómez' }), 400);
    await rechazo(crearPromotor(env, gerente, { cedula: 'V-12345679', nombre: 'Ana', apellido: '' }), 400);
    await rechazo(crearPromotor(env, gerente, { cedula: 'V-12345679', nombre: 'Ana', apellido: 'Gómez', telefono: '123' }), 400, 'promotor_invalido');
    // Cambiar la cédula a la de otro promotor tampoco vale
    const otro = await crearPromotor(env, gerente, { cedula: 'V-12345679', nombre: 'Ana', apellido: 'Gómez' });
    await rechazo(actualizarPromotor(env, gerente, otro.id, { cedula: 'V-12345678', nombre: 'Ana', apellido: 'Gómez' }), 409, 'promotor_repetido');
    await rechazo(actualizarPromotor(env, gerente, 'no-existe', { cedula: 'V-99999999', nombre: 'Ana', apellido: 'Gómez' }), 404);
  });

  it('buscar por cédula: lo usan quienes venden; el técnico y el contador no', async () => {
    await crearPromotor(env, gerente, { cedula: 'V-12345678', nombre: 'Luis', apellido: 'Mora', banco: 'Banesco' });
    expect((await buscarPromotorPorCedula(env, vendedor, '12345678'))!.nombre).toBe('Luis');
    expect(await buscarPromotorPorCedula(env, vendedor, 'V-87654321')).toBeNull();
    expect(await buscarPromotorPorCedula(env, vendedor, '')).toBeNull();
    await rechazo(buscarPromotorPorCedula(env, vendedor, 'xx'), 400, 'promotor_invalido');
    await rechazo(buscarPromotorPorCedula(env, tecnico, '12345678'), 403);
    await rechazo(buscarPromotorPorCedula(env, contador, '12345678'), 403);
  });

  it('el listado resume lo pendiente con cada promotor dentro del alcance de quien consulta', async () => {
    await ventaConPromotor(); // comisión $3 en vidrios
    const luis = await crearPromotor(env, gerente, { cedula: 'V-12345678', nombre: 'Luis', apellido: 'Mora' });
    await crearPendienteMercancia(env, encargado, { localId: vidrios, promotorId: luis.id, descripcion: '3 vidrios A15 y un cargador', monto_usd: 20 });

    const comoGerente = await listarPromotores(env, gerente);
    expect(comoGerente.find((p) => p.cedula === 'V-11111111')).toMatchObject({ comision_pendiente: 3, mercancia_pendiente: 0, n_pendientes: 1 });
    expect(comoGerente.find((p) => p.cedula === 'V-12345678')).toMatchObject({ comision_pendiente: 0, mercancia_pendiente: 20, n_pendientes: 1 });
    expect((await listarPromotores(env, contador)).length).toBe(2);
    // El encargado de OTRO local ve el directorio pero ninguna deuda de vidrios
    const deOtroLocal = await listarPromotores(env, encargadoAcc);
    expect(deOtroLocal.every((p) => p.n_pendientes === 0 && p.comision_pendiente === 0 && p.mercancia_pendiente === 0)).toBe(true);
    // Filtro por nombre
    expect((await listarPromotores(env, gerente, { buscar: 'luis' })).map((p) => p.cedula)).toEqual(['V-12345678']);
    await rechazo(listarPromotores(env, vendedor), 403);
  });
});

describe('pendientes de mercancía', () => {
  async function promotorLuis() {
    return crearPromotor(env, gerente, { cedula: 'V-12345678', nombre: 'Luis', apellido: 'Mora', telefono: '04141234567', banco: 'Banesco' });
  }

  it('el encargado la anota en su local; no en otro; vendedor, técnico y contador no pueden', async () => {
    const luis = await promotorLuis();
    const p = await crearPendienteMercancia(env, encargado, { localId: vidrios, promotorId: luis.id, descripcion: '  5 vidrios   A15 ', monto_usd: 15 });
    expect(p).toMatchObject({ tipo: 'MERCANCIA', estado: 'PENDIENTE', monto_usd: 15, descripcion: '5 vidrios A15', creado_por_nombre: 'Eli Vidrios', promotor_nombre: 'Luis Mora', promotor_banco: 'Banesco' });
    await rechazo(crearPendienteMercancia(env, encargado, { localId: accesorios, promotorId: luis.id, descripcion: 'otro local', monto_usd: 5 }), 403);
    for (const s of [vendedor, tecnico, contador]) await rechazo(crearPendienteMercancia(env, s, { localId: vidrios, promotorId: luis.id, descripcion: 'no puedo', monto_usd: 5 }), 403);
    // El gerente y el administrador la anotan en cualquier local
    await crearPendienteMercancia(env, gerente, { localId: vidrios, promotorId: luis.id, descripcion: 'del gerente', monto_usd: 5 });
    await crearPendienteMercancia(env, admin, { localId: accesorios, promotorId: luis.id, descripcion: 'del admin', monto_usd: 5 });
  });

  it('valida la descripción, el monto y el promotor', async () => {
    const luis = await promotorLuis();
    const base = { localId: vidrios, promotorId: luis.id, descripcion: 'Algo de mercancía', monto_usd: 10 };
    await rechazo(crearPendienteMercancia(env, encargado, { ...base, descripcion: ' ' }), 400);
    await rechazo(crearPendienteMercancia(env, encargado, { ...base, monto_usd: 0 }), 400);
    await rechazo(crearPendienteMercancia(env, encargado, { ...base, monto_usd: -3 }), 400);
    await rechazo(crearPendienteMercancia(env, encargado, { ...base, promotorId: 'no-existe' }), 400);
  });

  it('el encargado y el gerente la marcan pagada; el contador no; ya pagada no se paga dos veces', async () => {
    const luis = await promotorLuis();
    const p = await crearPendienteMercancia(env, encargado, { localId: vidrios, promotorId: luis.id, descripcion: 'Vidrios llevados', monto_usd: 15 });
    await rechazo(cerrarPendiente(env, contador, p.id, 'pagar'), 403);
    const pagado = await cerrarPendiente(env, encargado, p.id, 'pagar', 'Pagó en efectivo');
    expect(pagado).toMatchObject({ estado: 'PAGADO', cerrado_por_nombre: 'Eli Vidrios', nota_cierre: 'Pagó en efectivo' });
    expect(pagado.cerrado_en).toBeTruthy();
    await rechazo(cerrarPendiente(env, gerente, p.id, 'pagar'), 409, 'pendiente_cerrado');
    await rechazo(cerrarPendiente(env, gerente, p.id, 'anular'), 409, 'pendiente_cerrado');
    // Ya no cuenta como deuda
    expect((await listarPromotores(env, gerente))[0].mercancia_pendiente).toBe(0);
  });

  it('el encargado de otro local no ve ni toca un pendiente ajeno (404, igual que si no existiera)', async () => {
    const luis = await promotorLuis();
    const p = await crearPendienteMercancia(env, encargado, { localId: vidrios, promotorId: luis.id, descripcion: 'Vidrios llevados', monto_usd: 15 });
    expect(await listarPendientes(env, encargadoAcc)).toEqual([]);
    await rechazo(cerrarPendiente(env, encargadoAcc, p.id, 'pagar'), 404);
    await rechazo(cerrarPendiente(env, encargadoAcc, 'no-existe', 'pagar'), 404);
    expect((await listarPendientes(env, encargado)).length).toBe(1);
    expect((await listarPendientes(env, contador)).length).toBe(1);
    await rechazo(listarPendientes(env, vendedor), 403);
    await rechazo(listarPendientes(env, tecnico), 403);
  });
});

describe('pendientes de comisión', () => {
  it('la pagan el gerente, el administrador y el contador (desde Nómina); el encargado no', async () => {
    await ventaConPromotor();
    await ventaConPromotor(PROMOTOR, { cliente_cedula: 'V-22222222' });
    await ventaConPromotor(PROMOTOR, { cliente_cedula: 'V-33333333' });
    const abiertos = await listarPendientes(env, gerente, { estado: 'PENDIENTE', tipo: 'COMISION' });
    expect(abiertos.length).toBe(3);
    await rechazo(cerrarPendiente(env, encargado, abiertos[0].id, 'pagar'), 403, 'sin_permiso');
    expect((await cerrarPendiente(env, contador, abiertos[0].id, 'pagar', 'Transferencia 0123')).estado).toBe('PAGADO');
    expect((await cerrarPendiente(env, gerente, abiertos[1].id, 'pagar')).estado).toBe('PAGADO');
    expect((await cerrarPendiente(env, admin, abiertos[2].id, 'pagar')).estado).toBe('PAGADO');
    expect((await listarPromotores(env, gerente))[0].comision_pendiente).toBe(0);
  });

  it('anular una comisión es solo del gerente y el administrador', async () => {
    await ventaConPromotor();
    const [p] = await listarPendientes(env, gerente);
    await rechazo(cerrarPendiente(env, encargado, p.id, 'anular'), 403);
    await rechazo(cerrarPendiente(env, contador, p.id, 'anular'), 403);
    expect((await cerrarPendiente(env, gerente, p.id, 'anular', 'Venta mal cobrada')).estado).toBe('ANULADO');
    expect((await listarPendientes(env, gerente, { estado: 'PENDIENTE' })).length).toBe(0);
  });

  it('los filtros del listado funcionan', async () => {
    const luis = await crearPromotor(env, gerente, { cedula: 'V-12345678', nombre: 'Luis', apellido: 'Mora' });
    await ventaConPromotor();
    await crearPendienteMercancia(env, encargado, { localId: vidrios, promotorId: luis.id, descripcion: 'Mercancía', monto_usd: 10 });
    expect((await listarPendientes(env, gerente)).length).toBe(2);
    expect((await listarPendientes(env, gerente, { tipo: 'MERCANCIA' })).map((p) => p.promotor_nombre)).toEqual(['Luis Mora']);
    expect((await listarPendientes(env, gerente, { promotorId: luis.id })).length).toBe(1);
    expect((await listarPendientes(env, gerente, { localId: accesorios })).length).toBe(0);
  });
});

describe('si la venta se elimina, su comisión por pagar desaparece con ella', () => {
  it('se borran las comisiones abiertas; las ya pagadas se conservan', async () => {
    const v1 = await ventaConPromotor();
    const v2 = await ventaConPromotor(PROMOTOR, { cliente_cedula: 'V-22222222' });
    const pagada = (await listarPendientes(env, gerente)).find((p) => p.venta_id === v2.id)!;
    await cerrarPendiente(env, gerente, pagada.id, 'pagar');
    await eliminarVentas(env, admin, [v1.id, v2.id]);
    const quedan = await listarPendientes(env, gerente);
    expect(quedan.map((p) => p.estado)).toEqual(['PAGADO']);
  });
});

describe('«Marcar todo pagado» de la tarjeta de un promotor', () => {
  async function dosComisiones() {
    await ventaConPromotor();
    await ventaConPromotor(PROMOTOR, { cliente_cedula: 'V-22222222' });
    const [promotor] = await listarPromotores(env, gerente);
    const ids = (await listarPendientes(env, gerente, { estado: 'PENDIENTE' })).map((p) => p.id);
    return { promotor, ids };
  }

  it('el contador (o gerente/administrador) paga todas las comisiones elegidas de una vez, con la misma nota', async () => {
    const { promotor, ids } = await dosComisiones();
    expect(ids).toHaveLength(2);
    const r = await pagarComisionesPromotor(env, contador, promotor.id, ids, 'Transferencia 0123');
    expect(r).toEqual({ pagadas: 2, total_usd: 6 });
    const pagadas = await listarPendientes(env, gerente, { estado: 'PAGADO' });
    expect(pagadas).toHaveLength(2);
    expect(pagadas.every((p) => p.cerrado_por_nombre === 'Cora Contadora' && p.nota_cierre === 'Transferencia 0123')).toBe(true);
    expect((await listarPromotores(env, gerente))[0].comision_pendiente).toBe(0);
  });

  it('solo paga lo que sigue pendiente: una ya pagada no se repite y si no queda ninguna da 409', async () => {
    const { promotor, ids } = await dosComisiones();
    await cerrarPendiente(env, gerente, ids[0], 'pagar', 'ya');
    const r = await pagarComisionesPromotor(env, gerente, promotor.id, ids);
    expect(r).toEqual({ pagadas: 1, total_usd: 3 });
    await rechazo(pagarComisionesPromotor(env, gerente, promotor.id, ids), 409, 'pendiente_cerrado');
  });

  it('no toca comisiones de otro promotor ni mercancía, aunque lleguen sus ids', async () => {
    const { promotor, ids } = await dosComisiones();
    const otro = await crearPromotor(env, gerente, { cedula: 'V-55555555', nombre: 'Otro', apellido: 'Promotor' });
    await rechazo(pagarComisionesPromotor(env, gerente, otro.id, ids), 409, 'pendiente_cerrado');
    const merc = await crearPendienteMercancia(env, encargado, { localId: vidrios, promotorId: promotor.id, descripcion: 'Vidrios', monto_usd: 5 });
    const r = await pagarComisionesPromotor(env, gerente, promotor.id, [...ids, merc.id]);
    expect(r.pagadas).toBe(2);
    expect((await listarPendientes(env, gerente, { estado: 'PENDIENTE' })).map((p) => p.id)).toEqual([merc.id]);
  });

  it('el encargado, el vendedor y el técnico no pueden (403); una nota muy larga es 400', async () => {
    const { promotor, ids } = await dosComisiones();
    await rechazo(pagarComisionesPromotor(env, encargado, promotor.id, ids), 403);
    await rechazo(pagarComisionesPromotor(env, vendedor, promotor.id, ids), 403);
    await rechazo(pagarComisionesPromotor(env, tecnico, promotor.id, ids), 403);
    await rechazo(pagarComisionesPromotor(env, gerente, promotor.id, ids, 'x'.repeat(301)), 400, 'datos_invalidos');
    expect(await n("SELECT count(*) AS n FROM pendientes WHERE estado = 'PAGADO'")).toBe(0);
  });
});
