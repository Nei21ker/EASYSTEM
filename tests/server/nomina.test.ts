import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import { cargarSesion, type Sesion } from '../../src/server/authz';
import { ErrorApi } from '../../src/server/errores';
import { crearProducto } from '../../src/server/servicios/catalogo';
import {
  actualizarEmpleado, catalogoReventa, crearEmpleado, eliminarPagoPendiente, generarPagosPendientes, guardarPagoIndependiente,
  guardarPagoQuincenal, listarEmpleados, listarNominas, listarReventas, obtenerNomina,
} from '../../src/server/servicios/nomina';

const env = crearEntornoDePrueba();
const { accesorios, vidrios, servicio } = IDS_LOCALES;
const Q1 = { inicio: '2026-10-01', fin: '2026-10-15' };
const Q2 = { inicio: '2026-10-16', fin: '2026-10-31' };

let admin: UsuarioDePrueba, gerente: UsuarioDePrueba, contador: UsuarioDePrueba, encargado: UsuarioDePrueba, vendedor: UsuarioDePrueba, tecnico: UsuarioDePrueba;
let sA: Sesion, sG: Sesion, sC: Sesion, sE: Sesion, sV: Sesion, sT: Sesion;
const sesionDe = (u: UsuarioDePrueba): Promise<Sesion> => cargarSesion(env, peticionComo(u));

beforeEach(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  admin = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios });
  vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  tecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: servicio });
  [sA, sG, sC, sE, sV, sT] = await Promise.all([admin, gerente, contador, encargado, vendedor, tecnico].map(sesionDe));
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

const fijo = (extra: Record<string, unknown> = {}) => ({
  local_id: accesorios, nombre: 'María', apellido: 'Fernández', cedula: 'v-18234567', cargo: 'Cajera', salario_base: 300, ...extra,
});
const independiente = (extra: Record<string, unknown> = {}) => ({
  local_id: accesorios, nombre: 'Pedro', apellido: 'Salas', cedula: 'V-26111222', cargo: 'Revendedor', salario_base: 999, tipo: 'INDEPENDIENTE' as const, ...extra,
});
const linea = (nombre: string, cantidad: number, lista: number, vendido: number) => ({ producto_id: null, producto_nombre: nombre, producto_codigo: null, cantidad, precio_lista: lista, precio_vendido: vendido });
const rutaComp = (local: string = accesorios) => `comprobantes-nomina/${local}/emp-1730000000000.jpg`;

describe('acceso a la nómina', () => {
  it.each([['encargado'], ['vendedor'], ['tecnico']] as const)('el %s no puede nada (403)', async (quien) => {
    const s = { encargado: sE, vendedor: sV, tecnico: sT }[quien];
    await rechazo(listarEmpleados(env, s), 403);
    await rechazo(crearEmpleado(env, s, fijo()), 403);
    await rechazo(listarNominas(env, s, Q1.inicio, Q1.fin), 403);
    await rechazo(generarPagosPendientes(env, s, Q1), 403);
    await rechazo(catalogoReventa(env, s, 'carg', 10), 403);
    await rechazo(listarReventas(env, s, ['x']), 403);
  });

  it('administrador, gerente y contador trabajan con todos los locales vigentes', async () => {
    const e = await crearEmpleado(env, sC, fijo({ local_id: vidrios }));
    expect(e.local_id).toBe(vidrios);
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(vidrios).run();
    expect(await listarEmpleados(env, sA)).toHaveLength(1); // el administrador nunca se bloquea
    expect(await listarEmpleados(env, sG)).toHaveLength(0);
    expect(await listarEmpleados(env, sC)).toHaveLength(0);
    await rechazo(crearEmpleado(env, sG, fijo({ local_id: vidrios, cedula: 'V-99999999' })), 403);
  });
});

describe('empleados', () => {
  it('un empleado fijo queda con frecuencia quincenal; la cédula se guarda en mayúsculas', async () => {
    const e = await crearEmpleado(env, sG, fijo());
    expect(e).toMatchObject({ tipo: 'FIJO', frecuencia_pago: 'QUINCENAL', estado: 'ACTIVO', cedula: 'V-18234567', salario_base: 300, nombre: 'María' });
    expect(e.fecha_ingreso).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  it('un trabajador independiente no tiene salario y se paga por día', async () => {
    const e = await crearEmpleado(env, sG, independiente());
    expect(e).toMatchObject({ tipo: 'INDEPENDIENTE', frecuencia_pago: 'DIARIO', salario_base: 0 });
  });

  it('valida los datos y la cédula única', async () => {
    await rechazo(crearEmpleado(env, sG, fijo({ nombre: ' ' })), 400, 'El nombre es obligatorio.');
    await rechazo(crearEmpleado(env, sG, fijo({ apellido: '' })), 400, 'El apellido es obligatorio.');
    await rechazo(crearEmpleado(env, sG, fijo({ cedula: 'V-1' })), 400, 'La cédula debe tener al menos 5 caracteres.');
    await rechazo(crearEmpleado(env, sG, fijo({ cargo: '' })), 400, 'El cargo es obligatorio.');
    await rechazo(crearEmpleado(env, sG, fijo({ salario_base: -1 })), 400, 'El salario debe ser un monto mayor o igual a 0.');
    await rechazo(crearEmpleado(env, sG, fijo({ local_id: '' })), 400, 'Elige el local del empleado.');
    await crearEmpleado(env, sG, fijo());
    await rechazo(crearEmpleado(env, sG, fijo({ cedula: 'V-18234567', nombre: 'Otra' })), 409, 'Ya existe un empleado con la cédula V-18234567.');
  });

  it('actualizar: el tipo no cambia, la cédula no se repite y se puede desactivar', async () => {
    const a = await crearEmpleado(env, sG, fijo());
    const b = await crearEmpleado(env, sG, fijo({ cedula: 'V-20456789', nombre: 'José' }));
    const editado = await actualizarEmpleado(env, sG, a.id, { cargo: 'Gerente de tienda', salario_base: 350, estado: 'INACTIVO', tipo: 'INDEPENDIENTE' } as never);
    expect(editado).toMatchObject({ cargo: 'Gerente de tienda', salario_base: 350, estado: 'INACTIVO', tipo: 'FIJO', frecuencia_pago: 'QUINCENAL' });
    await rechazo(actualizarEmpleado(env, sG, b.id, { cedula: 'v-18234567' }), 409, /otro empleado con la cédula V-18234567/);
    await rechazo(actualizarEmpleado(env, sG, 'no-existe', { cargo: 'X' }), 404);
  });
});

describe('pago quincenal', () => {
  it('el pago base es la mitad del salario mensual; guardar pendiente y luego pagar', async () => {
    const e = await crearEmpleado(env, sG, fijo());
    const p = await guardarPagoQuincenal(env, sC, { empleadoId: e.id, periodo: Q1, bonos: 20, deducciones: 5.5, notas: ' puntual ', pagar: false });
    expect(p).toMatchObject({ pago_base: 150, bonos: 20, deducciones: 5.5, total_pagado: 164.5, estado_pago: 'PENDIENTE', pagado_en: null, notas: 'puntual', local_id: accesorios });
    const pagado = await guardarPagoQuincenal(env, sC, { empleadoId: e.id, periodo: Q1, bonos: 20, deducciones: 5.5, pagar: true });
    expect(pagado.id).toBe(p.id);
    expect(pagado.estado_pago).toBe('PAGADO');
    expect(pagado.pagado_en).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM nominas').first<{ n: number }>())?.n).toBe(1);
  });

  it('un pago PAGADO ya no se modifica', async () => {
    const e = await crearEmpleado(env, sG, fijo());
    await guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q1, bonos: 0, deducciones: 0, pagar: true });
    await rechazo(guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q1, bonos: 10, deducciones: 0, pagar: false }), 409, 'Ese pago ya está registrado como PAGADO y no se puede modificar.');
  });

  it('rechaza trabajadores independientes, períodos que no son quincena y ajustes imposibles', async () => {
    const f = await crearEmpleado(env, sG, fijo());
    const i = await crearEmpleado(env, sG, independiente());
    await rechazo(guardarPagoQuincenal(env, sG, { empleadoId: i.id, periodo: Q1, bonos: 0, deducciones: 0, pagar: false }), 400, 'Un trabajador independiente se paga por día: usa su lista del día.');
    await rechazo(guardarPagoQuincenal(env, sG, { empleadoId: f.id, periodo: { inicio: '2026-10-02', fin: '2026-10-16' }, bonos: 0, deducciones: 0, pagar: false }), 400, /quincena/i);
    await rechazo(guardarPagoQuincenal(env, sG, { empleadoId: f.id, periodo: Q1, bonos: 0, deducciones: 999, pagar: false }), 400);
    await rechazo(guardarPagoQuincenal(env, sG, { empleadoId: f.id, periodo: Q1, bonos: -5, deducciones: 0, pagar: false }), 400);
    await rechazo(guardarPagoQuincenal(env, sG, { empleadoId: 'no-existe', periodo: Q1, bonos: 0, deducciones: 0, pagar: false }), 404);
  });

  it('la captura del pago debe estar en la carpeta del local del empleado; se puede quitar mientras está pendiente', async () => {
    const e = await crearEmpleado(env, sG, fijo());
    await rechazo(guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q1, bonos: 0, deducciones: 0, comprobantePath: rutaComp(vidrios), pagar: false }), 400, /captura/i);
    const con = await guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q1, bonos: 0, deducciones: 0, comprobantePath: rutaComp(), pagar: false });
    expect(con.comprobante_path).toBe(rutaComp());
    const igual = await guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q1, bonos: 1, deducciones: 0, pagar: false });
    expect(igual.comprobante_path).toBe(rutaComp()); // no se pidió quitarla
    const sin = await guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q1, bonos: 1, deducciones: 0, quitarComprobante: true, pagar: false });
    expect(sin.comprobante_path).toBeNull();
  });

  it('generarPagosPendientes crea uno por empleado fijo activo sin pago, y no repite', async () => {
    const a = await crearEmpleado(env, sG, fijo());
    await crearEmpleado(env, sG, fijo({ cedula: 'V-20456789', nombre: 'José', salario_base: 280, local_id: vidrios }));
    const inactivo = await crearEmpleado(env, sG, fijo({ cedula: 'V-16789012', nombre: 'Luis' }));
    await actualizarEmpleado(env, sG, inactivo.id, { estado: 'INACTIVO' });
    await crearEmpleado(env, sG, independiente());
    await guardarPagoQuincenal(env, sG, { empleadoId: a.id, periodo: Q1, bonos: 0, deducciones: 0, pagar: false });

    expect((await generarPagosPendientes(env, sC, Q1)).creados).toBe(1); // solo José
    expect((await generarPagosPendientes(env, sC, Q1)).creados).toBe(0);
    expect((await generarPagosPendientes(env, sC, Q2)).creados).toBe(2); // María y José
    const pagos = await listarNominas(env, sC, Q2.inicio, Q2.fin);
    expect(pagos.map((p) => p.pago_base).sort()).toEqual([140, 150]);
    expect(pagos.every((p) => p.estado_pago === 'PENDIENTE')).toBe(true);
  });

  it('listarNominas filtra por período y por locales vigentes', async () => {
    const e = await crearEmpleado(env, sG, fijo());
    await guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q1, bonos: 0, deducciones: 0, pagar: false });
    await guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q2, bonos: 0, deducciones: 0, pagar: false });
    expect(await listarNominas(env, sG, Q1.inicio, Q1.fin)).toHaveLength(1);
    expect(await listarNominas(env, sG, Q1.inicio, Q2.fin)).toHaveLength(2);
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();
    expect(await listarNominas(env, sG, Q1.inicio, Q2.fin)).toHaveLength(0);
    expect(await listarNominas(env, sA, Q1.inicio, Q2.fin)).toHaveLength(2);
  });

  it('eliminarPagoPendiente: solo pendientes', async () => {
    const e = await crearEmpleado(env, sG, fijo());
    const pendiente = await guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q1, bonos: 0, deducciones: 0, pagar: false });
    const pagado = await guardarPagoQuincenal(env, sG, { empleadoId: e.id, periodo: Q2, bonos: 0, deducciones: 0, pagar: true });
    await eliminarPagoPendiente(env, sC, pendiente.id);
    await rechazo(eliminarPagoPendiente(env, sC, pagado.id), 409, /PAGADO/);
    await rechazo(eliminarPagoPendiente(env, sC, 'no-existe'), 404);
    expect((await obtenerNomina(env, sC, pagado.id)).estado_pago).toBe('PAGADO');
  });
});

describe('trabajador independiente: pago diario por reventa', () => {
  const DIA = '2026-10-20';

  it('la ganancia es Σ cantidad × (precio vendido − precio de lista), más bonos, menos deducciones', async () => {
    const e = await crearEmpleado(env, sG, independiente());
    const id = await guardarPagoIndependiente(env, sC, {
      empleadoId: e.id, dia: DIA, lineas: [linea('Cargador 20W', 3, 5, 7), linea('Cable USB-C', 2, 3, 3.5)], bonos: 2, deducciones: 1, notas: null, pagar: false,
    });
    const n = await obtenerNomina(env, sC, id);
    expect(n).toMatchObject({ pago_base: 7, bonos: 2, deducciones: 1, total_pagado: 8, estado_pago: 'PENDIENTE', periodo_inicio: DIA, periodo_fin: DIA });
    expect((await listarReventas(env, sC, [id]))[id].map((l) => l.producto_nombre)).toEqual(['Cargador 20W', 'Cable USB-C']);
  });

  it('volver a guardar un día pendiente reemplaza la lista; pagarlo lo congela', async () => {
    const e = await crearEmpleado(env, sG, independiente());
    const id = await guardarPagoIndependiente(env, sG, { empleadoId: e.id, dia: DIA, lineas: [linea('A', 1, 5, 6)], bonos: 0, deducciones: 0, notas: null, pagar: false });
    const id2 = await guardarPagoIndependiente(env, sG, { empleadoId: e.id, dia: DIA, lineas: [linea('B', 2, 5, 8)], bonos: 0, deducciones: 0, notas: null, pagar: true });
    expect(id2).toBe(id);
    const n = await obtenerNomina(env, sG, id);
    expect(n).toMatchObject({ pago_base: 6, total_pagado: 6, estado_pago: 'PAGADO' });
    expect(n.pagado_en).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((await listarReventas(env, sG, [id]))[id].map((l) => l.producto_nombre)).toEqual(['B']);
    await rechazo(guardarPagoIndependiente(env, sG, { empleadoId: e.id, dia: DIA, lineas: [linea('C', 1, 5, 9)], bonos: 0, deducciones: 0, notas: null, pagar: false }), 409, /ya está registrado como PAGADO/);
    expect((await listarReventas(env, sG, [id]))[id].map((l) => l.producto_nombre)).toEqual(['B']);
  });

  it('no se puede vender por debajo del precio, ni con cantidades o precios inválidos, ni con nombre vacío', async () => {
    const e = await crearEmpleado(env, sG, independiente());
    const base = { empleadoId: e.id, dia: DIA, bonos: 0, deducciones: 0, notas: null, pagar: false };
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, lineas: [linea('Cargador', 1, 5, 4)] }), 400, '"Cargador" no puede venderse por debajo de su precio ($4.00 < $5.00)');
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, lineas: [linea('Cargador', 0, 5, 6)] }), 400, 'La cantidad de "Cargador" debe ser mayor a 0');
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, lineas: [linea('Cargador', 1, -1, 6)] }), 400, 'Los precios de "Cargador" no son válidos');
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, lineas: [linea('  ', 1, 5, 6)] }), 400, 'Cada línea debe tener el nombre del producto');
  });

  it('las deducciones no pueden superar la ganancia más los bonos; pagar exige al menos un producto', async () => {
    const e = await crearEmpleado(env, sG, independiente());
    const base = { empleadoId: e.id, dia: DIA, notas: null };
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, lineas: [linea('A', 1, 5, 6)], bonos: 0, deducciones: 50, pagar: false }), 400, 'Las deducciones no pueden superar la ganancia más los bonos');
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, lineas: [], bonos: 0, deducciones: 0, pagar: true }), 400, 'Agrega al menos un producto a la lista antes de registrar el pago');
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, lineas: [], bonos: -1, deducciones: 0, pagar: false }), 400, 'Los bonos y las deducciones no pueden ser negativos');
  });

  it('solo trabajadores independientes y activos; el trabajador debe existir y su local ser accesible', async () => {
    const f = await crearEmpleado(env, sG, fijo());
    const i = await crearEmpleado(env, sG, independiente());
    const base = { dia: DIA, lineas: [linea('A', 1, 5, 6)], bonos: 0, deducciones: 0, notas: null, pagar: false };
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, empleadoId: f.id }), 400, 'Este trabajador es fijo: su pago es quincenal');
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, empleadoId: 'no-existe' }), 404, 'El trabajador no existe');
    await actualizarEmpleado(env, sG, i.id, { estado: 'INACTIVO' });
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, empleadoId: i.id }), 400, 'El trabajador está inactivo');
    await actualizarEmpleado(env, sG, i.id, { estado: 'ACTIVO' });
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();
    await rechazo(guardarPagoIndependiente(env, sG, { ...base, empleadoId: i.id }), 403);
    await rechazo(guardarPagoIndependiente(env, sE, { ...base, empleadoId: i.id }), 403);
  });

  it('un pago pendiente de un trabajador independiente se puede eliminar y se lleva su lista', async () => {
    const e = await crearEmpleado(env, sG, independiente());
    const id = await guardarPagoIndependiente(env, sG, { empleadoId: e.id, dia: DIA, lineas: [linea('A', 1, 5, 6)], bonos: 0, deducciones: 0, notas: null, pagar: false });
    await eliminarPagoPendiente(env, sG, id);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM nomina_reventas').first<{ n: number }>())?.n).toBe(0);
  });

  it('sube la versión de nominas en ese local', async () => {
    const e = await crearEmpleado(env, sG, independiente());
    await env.DB.prepare('DELETE FROM cambios').run();
    await guardarPagoIndependiente(env, sG, { empleadoId: e.id, dia: DIA, lineas: [linea('A', 1, 5, 6)], bonos: 0, deducciones: 0, notas: null, pagar: false });
    const tablas = (await env.DB.prepare('SELECT tabla, local_id FROM cambios ORDER BY tabla').all<{ tabla: string; local_id: string }>()).results;
    expect(tablas).toEqual([{ tabla: 'nomina_reventas', local_id: accesorios }, { tabla: 'nominas', local_id: accesorios }]);
  });
});

describe('catálogo para armar la lista de reventa (el contador no lee el catálogo)', () => {
  beforeEach(async () => {
    await crearProducto(env, sA, { codigo_barras: '2000000000015', nombre: 'Cargador rápido 20W', categoria: 'Cargadores', precio_compra: 3, precio_venta: 8 });
    await crearProducto(env, sA, { codigo_barras: '2000000000022', nombre: 'Cable USB-C', categoria: 'Cables', precio_compra: 1, precio_venta: 4 });
    await crearProducto(env, sA, { codigo_barras: '2000000000039', nombre: 'Forro iPhone', categoria: 'Forros', precio_venta: 6 });
  });

  it('busca por nombre, código o categoría y devuelve SOLO id, código, nombre, categoría y precio de venta', async () => {
    const porNombre = await catalogoReventa(env, sC, 'CARGADOR', 30);
    expect(porNombre).toHaveLength(1);
    expect(Object.keys(porNombre[0]).sort()).toEqual(['categoria', 'codigo_barras', 'id', 'nombre', 'precio_venta']);
    expect(porNombre[0]).toMatchObject({ nombre: 'Cargador rápido 20W', precio_venta: 8 });
    expect((await catalogoReventa(env, sG, 'cables', 30)).map((p) => p.nombre)).toEqual(['Cable USB-C']);
    expect((await catalogoReventa(env, sA, '2000000000039', 30)).map((p) => p.nombre)).toEqual(['Forro iPhone']);
  });

  it('un texto vacío no devuelve nada, el límite se respeta y el código exacto va primero', async () => {
    expect(await catalogoReventa(env, sC, '   ', 30)).toEqual([]);
    expect(await catalogoReventa(env, sC, 'c', 1)).toHaveLength(1);
    expect((await catalogoReventa(env, sC, '2000000000022', 30))[0].nombre).toBe('Cable USB-C');
  });

  it('los comodines del texto no se interpretan (%, _)', async () => {
    expect(await catalogoReventa(env, sC, '%', 30)).toEqual([]);
    expect(await catalogoReventa(env, sC, '_', 30)).toEqual([]);
  });
});
