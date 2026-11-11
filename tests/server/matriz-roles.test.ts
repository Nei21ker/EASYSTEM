/// <reference types="vite/client" />
// Matriz de permisos de TODA la API: cada endpoint contra cada rol y contra "sin sesión".
//  · permitido  → la petición pasa la autorización (nunca 401/403; puede dar 400/404/409 por los datos de prueba).
//  · prohibido  → 403 con sesión, 401 sin sesión. Un rol sin permiso no debe poder ni "tantear" si algo existe.
// Es la red de seguridad que reemplaza a las políticas RLS de Postgres: si alguien agrega una ruta o cambia un permiso,
// esta tabla es lo que hay que actualizar a propósito.
import { beforeAll, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba, crearUsuarioDePrueba, IDS_LOCALES, peticionComo, reiniciarBase, sembrarLocales, type UsuarioDePrueba } from './ayudas';
import type { Rol } from '../../src/server/authz';

const env = crearEntornoDePrueba();
// El local de servicio técnico no tiene usuarios en esta prueba: las rutas que suspenden un local o cierran sesiones apuntan a él
const { accesorios, vidrios, servicio } = IDS_LOCALES;

const modulos = import.meta.glob('../../src/pages/api/**/*.ts') as Record<string, () => Promise<Record<string, (c: unknown) => Promise<Response>>>>;
const cargar = (archivo: string) => {
  const clave = `../../src/pages/api/${archivo}`;
  if (!modulos[clave]) throw new Error(`No existe la ruta ${archivo}`);
  return modulos[clave]();
};

const TODOS: Rol[] = ['administrador', 'gerente', 'encargado', 'vendedor', 'tecnico', 'contador'];
const NEGOCIO: Rol[] = ['administrador', 'gerente', 'encargado', 'vendedor', 'tecnico']; // todo menos contador
const GERENCIA: Rol[] = ['administrador', 'gerente', 'encargado'];
const GLOBAL: Rol[] = ['administrador', 'gerente'];
const NOMINA: Rol[] = ['administrador', 'gerente', 'contador'];
const PENDIENTES: Rol[] = ['administrador', 'gerente', 'encargado', 'contador']; // directorio de promotores y pendientes: gerencia + nómina
const CAJERO: Rol[] = ['administrador', 'gerente', 'encargado', 'vendedor']; // quienes cobran en el POS

interface Caso {
  /** Archivo de la ruta dentro de src/pages/api */
  archivo: string;
  metodo: string;
  /** URL con parámetros ya resueltos */
  url: string;
  params?: Record<string, string>;
  cuerpo?: unknown;
  permitidos: Rol[];
  /** Cabecera Content-Type distinta de JSON (subidas) */
  tipo?: string;
}

let ids: { producto: string; modelo: string; orden: string; nomina: string; empleado: string };
const FOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const dia = '2026-10-20';

function casos(): Caso[] {
  const p = ids.producto;
  const producto = { codigo_barras: '2000000000099', nombre: 'Matriz', categoria: 'Forros', precio_venta: 5 };
  const item = { producto_id: p, nombre: 'Forro matriz', codigo_barras: '2000000000015', cantidad: 1, precio_unitario: 6, unidades: [] };
  const venta = { fecha: dia + 'T15:00:00.000Z', local_id: accesorios, cliente_cedula: 'V-12345678', cliente_nombre: 'Ana', cliente_telefono: '0414-1234567', metodo_pago: 'USD_EFECTIVO', pagos: [{ metodo: 'USD_EFECTIVO', monto_usd: 6, monto_bs: null }], vuelto: null, total: 6, items: [item], tasa_cambio: 36.5, total_bs: null };
  const devolucion = { fecha: dia + 'T16:00:00.000Z', local_id: accesorios, venta_id: 'no-existe', venta_folio: 1, motivo: 'Matriz', items_devueltos: [item], items_nuevos: [], total_devuelto: 6, total_nuevo: 0, diferencia: -6, tasa_cambio: 36.5, pagos: null, vuelto: null, reembolso: { metodo: 'USD_EFECTIVO', monto_usd: 6, monto_bs: null } };
  const orden = { local_id: accesorios, cliente_cedula: 'V-1234567', cliente_nombre: 'Ana', cliente_telefono: '0414', equipo_marca: 'Marca', equipo_modelo: 'M', falla_reportada: 'No enciende' };
  const movimiento = (tipo: string) => ({ productoId: p, tipo, cantidad: 1, localId: accesorios, motivo: 'Matriz' });
  return [
    // Catálogo y locales
    { archivo: 'locales/index.ts', metodo: 'GET', url: '/api/locales', permitidos: TODOS },
    { archivo: 'locales/[localId]/inventario/alta.ts', metodo: 'POST', url: `/api/locales/${accesorios}/inventario/alta`, params: { localId: accesorios }, cuerpo: { productoIds: [p] }, permitidos: GERENCIA },
    { archivo: 'locales/[localId]/inventario/minimos.ts', metodo: 'POST', url: `/api/locales/${accesorios}/inventario/minimos`, params: { localId: accesorios }, cuerpo: { filas: [{ producto_id: p, stock_minimo: 2 }] }, permitidos: GERENCIA },
    { archivo: 'modelos/index.ts', metodo: 'GET', url: '/api/modelos', permitidos: NEGOCIO },
    { archivo: 'modelos/index.ts', metodo: 'POST', url: '/api/modelos', cuerpo: { marca: 'Matriz', modelo: 'M1' }, permitidos: GLOBAL },
    { archivo: 'modelos/[id].ts', metodo: 'DELETE', url: `/api/modelos/${ids.modelo}`, params: { id: ids.modelo }, permitidos: GLOBAL },
    { archivo: 'productos/index.ts', metodo: 'GET', url: '/api/productos', permitidos: NEGOCIO },
    { archivo: 'productos/index.ts', metodo: 'POST', url: '/api/productos', cuerpo: producto, permitidos: GERENCIA },
    { archivo: 'productos/[id]/index.ts', metodo: 'GET', url: `/api/productos/${p}`, params: { id: p }, permitidos: NEGOCIO },
    { archivo: 'productos/[id]/index.ts', metodo: 'PATCH', url: `/api/productos/${p}`, params: { id: p }, cuerpo: { nombre: 'Matriz 2' }, permitidos: GERENCIA },
    { archivo: 'productos/[id]/index.ts', metodo: 'DELETE', url: '/api/productos/no-existe', params: { id: 'no-existe' }, permitidos: GLOBAL },
    { archivo: 'productos/[id]/compatibilidades.ts', metodo: 'PUT', url: `/api/productos/${p}/compatibilidades`, params: { id: p }, cuerpo: { modeloIds: [] }, permitidos: GERENCIA },
    { archivo: 'productos/eliminar-lote.ts', metodo: 'POST', url: '/api/productos/eliminar-lote', cuerpo: { ids: [] }, permitidos: GLOBAL },
    { archivo: 'productos/precios-lote.ts', metodo: 'POST', url: '/api/productos/precios-lote', cuerpo: { ids: [], moneda: 'BS', precio: 1100 }, permitidos: GLOBAL },
    { archivo: 'productos/lote.ts', metodo: 'POST', url: '/api/productos/lote', cuerpo: { filas: [] }, permitidos: GLOBAL },
    { archivo: 'productos/rapido.ts', metodo: 'POST', url: '/api/productos/rapido', cuerpo: { filas: [] }, permitidos: GERENCIA },
    { archivo: 'productos/compatibilidades-lote.ts', metodo: 'POST', url: '/api/productos/compatibilidades-lote', cuerpo: { pares: [], productoIds: [] }, permitidos: GLOBAL },
    { archivo: 'productos/por-codigo/[codigo].ts', metodo: 'GET', url: '/api/productos/por-codigo/2000000000015', params: { codigo: '2000000000015' }, permitidos: NEGOCIO },
    { archivo: 'productos/stock-bajo.ts', metodo: 'GET', url: '/api/productos/stock-bajo', permitidos: NEGOCIO },
    { archivo: 'tasas/index.ts', metodo: 'GET', url: '/api/tasas', permitidos: NEGOCIO },
    { archivo: 'tasas/index.ts', metodo: 'POST', url: '/api/tasas', cuerpo: { fecha: dia, tasa: 36.5 }, permitidos: NEGOCIO },
    // Inventario y unidades
    { archivo: 'movimientos/index.ts', metodo: 'GET', url: '/api/movimientos', permitidos: NEGOCIO },
    { archivo: 'movimientos/index.ts', metodo: 'POST', url: '/api/movimientos', cuerpo: movimiento('ENTRADA'), permitidos: GERENCIA },
    { archivo: 'movimientos/lote.ts', metodo: 'POST', url: '/api/movimientos/lote', cuerpo: { movimientos: [movimiento('ENTRADA')] }, permitidos: GERENCIA },
    { archivo: 'unidades/index.ts', metodo: 'GET', url: '/api/unidades', permitidos: NEGOCIO },
    { archivo: 'unidades/[codigo].ts', metodo: 'GET', url: '/api/unidades/2100000000012', params: { codigo: '2100000000012' }, permitidos: NEGOCIO },
    { archivo: 'unidades/impresas.ts', metodo: 'POST', url: '/api/unidades/impresas', cuerpo: { codigos: [] }, permitidos: GERENCIA },
    // Traslados entre locales y bajas de piezas
    { archivo: 'traslados/index.ts', metodo: 'GET', url: '/api/traslados', permitidos: GERENCIA },
    { archivo: 'traslados/destinos.ts', metodo: 'GET', url: '/api/traslados/destinos', permitidos: GERENCIA },
    { archivo: 'traslados/index.ts', metodo: 'POST', url: '/api/traslados', cuerpo: { origenLocalId: accesorios, destinoLocalId: vidrios, codigos: ['2100000000012'] }, permitidos: GERENCIA },
    { archivo: 'traslados/[id]/recibir.ts', metodo: 'POST', url: '/api/traslados/no-existe/recibir', params: { id: 'no-existe' }, cuerpo: { codigos: ['2100000000012'] }, permitidos: GERENCIA },
    { archivo: 'traslados/[id]/cerrar.ts', metodo: 'POST', url: '/api/traslados/no-existe/cerrar', params: { id: 'no-existe' }, permitidos: GERENCIA },
    { archivo: 'bajas/index.ts', metodo: 'POST', url: '/api/bajas', cuerpo: { localId: accesorios, codigos: ['2100000000012'], motivo: 'DANADA' }, permitidos: GERENCIA },
    { archivo: 'bajas/revertir.ts', metodo: 'POST', url: '/api/bajas/revertir', cuerpo: { codigos: ['2100000000012'] }, permitidos: GLOBAL },
    // Productos por cantidad: piezas defectuosas al vender (con cantidad 0 / en un producto con código los roles con permiso reciben 400 antes de tocar nada)
    { archivo: 'movimientos/con-merma.ts', metodo: 'POST', url: '/api/movimientos/con-merma', cuerpo: { productoId: p, localId: accesorios, cantidad: 1, danados: 1 }, permitidos: GERENCIA },
    { archivo: 'mermas/index.ts', metodo: 'GET', url: '/api/mermas', permitidos: GERENCIA },
    // Promotores y pendientes (lo que el vendedor y el técnico no ven; el POS busca al promotor por cédula)
    { archivo: 'promotores/index.ts', metodo: 'GET', url: '/api/promotores', permitidos: PENDIENTES },
    { archivo: 'promotores/index.ts', metodo: 'GET', url: '/api/promotores?cedula=V-12345678', permitidos: CAJERO },
    { archivo: 'promotores/index.ts', metodo: 'POST', url: '/api/promotores', cuerpo: { cedula: 'V-12345678', nombre: 'Luis', apellido: 'Mora' }, permitidos: PENDIENTES },
    { archivo: 'promotores/[id].ts', metodo: 'PUT', url: '/api/promotores/no-existe', params: { id: 'no-existe' }, cuerpo: { cedula: 'V-12345678', nombre: 'Luis', apellido: 'Mora' }, permitidos: PENDIENTES },
    { archivo: 'pendientes/index.ts', metodo: 'GET', url: '/api/pendientes', permitidos: PENDIENTES },
    { archivo: 'pendientes/index.ts', metodo: 'POST', url: '/api/pendientes', cuerpo: { localId: accesorios, promotorId: 'no-existe', descripcion: 'Vidrios', monto_usd: 5 }, permitidos: GERENCIA },
    { archivo: 'pendientes/[id]/cerrar.ts', metodo: 'POST', url: '/api/pendientes/no-existe/cerrar', params: { id: 'no-existe' }, cuerpo: { accion: 'pagar' }, permitidos: PENDIENTES },
    { archivo: 'pendientes/[id]/promotor.ts', metodo: 'PUT', url: '/api/pendientes/no-existe/promotor', params: { id: 'no-existe' }, cuerpo: { promotorId: 'x' }, permitidos: PENDIENTES },
    { archivo: 'mermas/index.ts', metodo: 'POST', url: '/api/mermas', cuerpo: { productoId: p, localId: accesorios, cantidad: 1 }, permitidos: GERENCIA },
    // Ventas, devoluciones y órdenes
    { archivo: 'ventas/index.ts', metodo: 'GET', url: '/api/ventas', permitidos: NEGOCIO },
    { archivo: 'ventas/index.ts', metodo: 'POST', url: '/api/ventas', cuerpo: venta, permitidos: NEGOCIO },
    // (con un precio inválido: los roles con permiso reciben 400 antes de tocar contraseñas; el resto, 403)
    { archivo: 'ventas/autorizar-precio.ts', metodo: 'POST', url: '/api/ventas/autorizar-precio', cuerpo: { email: 'nadie@prueba.com', clave: 'x', local_id: accesorios, lineas: [{ producto_id: p, precio: 0 }] }, permitidos: NEGOCIO },
    { archivo: 'ventas/autorizar-danados.ts', metodo: 'POST', url: '/api/ventas/autorizar-danados', cuerpo: { email: 'nadie@prueba.com', clave: 'x', local_id: accesorios, cantidad: 0 }, permitidos: NEGOCIO },
    { archivo: 'ventas/autorizar-codigo.ts', metodo: 'POST', url: '/api/ventas/autorizar-codigo', cuerpo: { email: 'nadie@prueba.com', clave: 'x', local_id: accesorios, producto_id: 'no-existe' }, permitidos: NEGOCIO },
    { archivo: 'ventas/resetear.ts', metodo: 'POST', url: '/api/ventas/resetear', cuerpo: { simular: true }, permitidos: ['administrador'] },
    { archivo: 'ventas/eliminar.ts', metodo: 'POST', url: '/api/ventas/eliminar', cuerpo: { ids: ['no-existe'], simular: true }, permitidos: ['administrador', 'gerente'] },
    { archivo: 'reportes/resetear.ts', metodo: 'POST', url: '/api/reportes/resetear', cuerpo: { simular: true }, permitidos: ['administrador'] },
    { archivo: 'ordenes/index.ts', metodo: 'POST', url: '/api/ordenes', cuerpo: orden, permitidos: NEGOCIO },
    { archivo: 'devoluciones/index.ts', metodo: 'GET', url: '/api/devoluciones', permitidos: NEGOCIO },
    { archivo: 'devoluciones/index.ts', metodo: 'POST', url: '/api/devoluciones', cuerpo: devolucion, permitidos: GERENCIA },
    { archivo: 'ordenes/index.ts', metodo: 'GET', url: '/api/ordenes', permitidos: NEGOCIO },
    { archivo: 'ordenes/[id].ts', metodo: 'GET', url: `/api/ordenes/${ids.orden}`, params: { id: ids.orden }, permitidos: NEGOCIO },
    { archivo: 'ordenes/[id].ts', metodo: 'PATCH', url: `/api/ordenes/${ids.orden}`, params: { id: ids.orden }, cuerpo: { diagnostico: 'Matriz' }, permitidos: NEGOCIO },
    // Cuadre de caja
    { archivo: 'cuadres/index.ts', metodo: 'GET', url: `/api/cuadres?fecha=${dia}`, permitidos: GERENCIA },
    { archivo: 'cuadres/[localId]/[fecha]/index.ts', metodo: 'GET', url: `/api/cuadres/${accesorios}/${dia}`, params: { localId: accesorios, fecha: dia }, permitidos: GERENCIA },
    { archivo: 'cuadres/[localId]/[fecha]/index.ts', metodo: 'PUT', url: `/api/cuadres/${accesorios}/${dia}`, params: { localId: accesorios, fecha: dia }, cuerpo: { contado: [], fotos: [], notas: null, cerrar: false }, permitidos: GERENCIA },
    { archivo: 'cuadres/[localId]/[fecha]/esperado.ts', metodo: 'GET', url: `/api/cuadres/${accesorios}/${dia}/esperado`, params: { localId: accesorios, fecha: dia }, permitidos: GERENCIA },
    { archivo: 'cuadres/[localId]/[fecha]/reabrir.ts', metodo: 'POST', url: `/api/cuadres/${accesorios}/${dia}/reabrir`, params: { localId: accesorios, fecha: dia }, permitidos: GLOBAL },
    // Archivos
    { archivo: 'archivos/producto/[id].ts', metodo: 'PUT', url: `/api/archivos/producto/${p}`, params: { id: p }, cuerpo: FOTO, tipo: 'image/jpeg', permitidos: GERENCIA },
    { archivo: 'archivos/producto/[id].ts', metodo: 'DELETE', url: '/api/archivos/producto/foto?url=otra', params: { id: 'foto' }, permitidos: GERENCIA },
    { archivo: 'archivos/privado/[...ruta].ts', metodo: 'GET', url: `/api/archivos/privado/cuadres-caja/${accesorios}/${dia}/EFECTIVO-1-1.jpg`, params: { ruta: `cuadres-caja/${accesorios}/${dia}/EFECTIVO-1-1.jpg` }, permitidos: GERENCIA },
    { archivo: 'archivos/privado/[...ruta].ts', metodo: 'GET', url: `/api/archivos/privado/comprobantes-nomina/${accesorios}/x.jpg`, params: { ruta: `comprobantes-nomina/${accesorios}/x.jpg` }, permitidos: NOMINA },
    { archivo: 'archivos/privado/[...ruta].ts', metodo: 'PUT', url: '/api/archivos/privado/x', params: { ruta: `cuadres-caja/${accesorios}/${dia}/EFECTIVO-1-1.jpg` }, cuerpo: FOTO, tipo: 'image/jpeg', permitidos: GERENCIA },
    { archivo: 'archivos/privado/[...ruta].ts', metodo: 'DELETE', url: '/api/archivos/privado/x', params: { ruta: `cuadres-caja/${accesorios}/${dia}/EFECTIVO-1-1.jpg` }, permitidos: GERENCIA },
    // Usuarios y suscripciones
    { archivo: 'usuarios/index.ts', metodo: 'GET', url: '/api/usuarios', permitidos: GLOBAL },
    { archivo: 'usuarios/index.ts', metodo: 'POST', url: '/api/usuarios', cuerpo: { email: 'matriz@x.com', nombre: 'Matriz', clave: 'clave-segura-1', rol: 'vendedor', localId: accesorios }, permitidos: GLOBAL },
    { archivo: 'usuarios/[id]/index.ts', metodo: 'PATCH', url: '/api/usuarios/no-existe', params: { id: 'no-existe' }, cuerpo: { status: 'inactive' }, permitidos: GLOBAL },
    { archivo: 'usuarios/[id]/index.ts', metodo: 'DELETE', url: '/api/usuarios/no-existe', params: { id: 'no-existe' }, permitidos: GLOBAL },
    { archivo: 'usuarios/[id]/clave.ts', metodo: 'POST', url: '/api/usuarios/no-existe/clave', params: { id: 'no-existe' }, cuerpo: { clave: 'clave-segura-1' }, permitidos: GLOBAL },
    // Cambiar la PROPIA clave: cualquier rol (con la actual equivocada responde 400, no 403)
    { archivo: 'cuenta/clave.ts', metodo: 'POST', url: '/api/cuenta/clave', cuerpo: { actual: 'no-es-la-actual', nueva: 'clave-segura-1' }, permitidos: TODOS },
    { archivo: 'usuarios/[id]/cerrar-sesion.ts', metodo: 'POST', url: '/api/usuarios/no-existe/cerrar-sesion', params: { id: 'no-existe' }, permitidos: ['administrador'] },
    { archivo: 'suscripciones/usuarios.ts', metodo: 'GET', url: '/api/suscripciones/usuarios', permitidos: ['administrador'] },
    { archivo: 'suscripciones/[localId]/index.ts', metodo: 'POST', url: `/api/suscripciones/${servicio}`, params: { localId: servicio }, cuerpo: { estado: 'SUSPENDED' }, permitidos: ['administrador'] },
    { archivo: 'suscripciones/[localId]/cerrar-sesiones.ts', metodo: 'POST', url: `/api/suscripciones/${servicio}/cerrar-sesiones`, params: { localId: servicio }, permitidos: ['administrador'] },
    // Presencia ("Tiempo real"): todos mandan latidos; solo el administrador ve quién está conectado
    { archivo: 'presence/heartbeat.ts', metodo: 'POST', url: '/api/presence/heartbeat', cuerpo: { ruta: '/' }, permitidos: TODOS },
    { archivo: 'admin/active-users.ts', metodo: 'GET', url: '/api/admin/active-users', permitidos: ['administrador'] },
    // Nómina
    { archivo: 'nomina/empleados/index.ts', metodo: 'GET', url: '/api/nomina/empleados', permitidos: NOMINA },
    { archivo: 'nomina/empleados/index.ts', metodo: 'POST', url: '/api/nomina/empleados', cuerpo: { local_id: accesorios, nombre: 'Mat', apellido: 'Riz', cedula: 'V-7000001', cargo: 'Cajero', salario_base: 100 }, permitidos: NOMINA },
    { archivo: 'nomina/empleados/[id]/index.ts', metodo: 'PATCH', url: `/api/nomina/empleados/${ids.empleado}`, params: { id: ids.empleado }, cuerpo: { cargo: 'Jefe' }, permitidos: NOMINA },
    { archivo: 'nomina/nominas/index.ts', metodo: 'GET', url: `/api/nomina/nominas?desde=${dia}&hasta=${dia}`, permitidos: NOMINA },
    { archivo: 'nomina/nominas/[id]/index.ts', metodo: 'GET', url: `/api/nomina/nominas/${ids.nomina}`, params: { id: ids.nomina }, permitidos: NOMINA },
    { archivo: 'nomina/nominas/[id]/index.ts', metodo: 'DELETE', url: `/api/nomina/nominas/${ids.nomina}`, params: { id: ids.nomina }, permitidos: NOMINA },
    { archivo: 'nomina/pagos-quincenales/index.ts', metodo: 'POST', url: '/api/nomina/pagos-quincenales', cuerpo: { empleadoId: ids.empleado, periodo: { inicio: '2026-10-01', fin: '2026-10-15' }, bonos: 0, deducciones: 0, pagar: false }, permitidos: NOMINA },
    { archivo: 'nomina/generar/index.ts', metodo: 'POST', url: '/api/nomina/generar', cuerpo: { periodo: { inicio: '2026-10-16', fin: '2026-10-31' } }, permitidos: NOMINA },
    { archivo: 'nomina/independientes/index.ts', metodo: 'POST', url: '/api/nomina/independientes', cuerpo: { empleadoId: ids.empleado, dia, lineas: [], bonos: 0, deducciones: 0, notas: null, pagar: false }, permitidos: NOMINA },
    { archivo: 'nomina/reventas/index.ts', metodo: 'POST', url: '/api/nomina/reventas', cuerpo: { nominaIds: [ids.nomina] }, permitidos: NOMINA },
    { archivo: 'nomina/catalogo-reventa/index.ts', metodo: 'GET', url: '/api/nomina/catalogo-reventa?q=forro', permitidos: NOMINA },
    { archivo: 'clientes/[cedula].ts', metodo: 'GET', url: '/api/clientes/V-12345678', params: { cedula: 'V-12345678' }, permitidos: NEGOCIO },
    // Cualquier usuario con sesión
    { archivo: 'cambios.ts', metodo: 'GET', url: '/api/cambios', permitidos: TODOS },
  ];
}

const usuarios = {} as Record<Rol, UsuarioDePrueba>;
let otroLocal: UsuarioDePrueba;

beforeAll(async () => {
  await reiniciarBase(env.DB);
  await sembrarLocales(env.DB);
  usuarios.administrador = await crearUsuarioDePrueba(env, { rol: 'administrador', localId: null });
  usuarios.gerente = await crearUsuarioDePrueba(env, { rol: 'gerente', localId: null });
  usuarios.encargado = await crearUsuarioDePrueba(env, { rol: 'encargado', localId: accesorios });
  usuarios.vendedor = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: accesorios });
  usuarios.tecnico = await crearUsuarioDePrueba(env, { rol: 'tecnico', localId: accesorios });
  usuarios.contador = await crearUsuarioDePrueba(env, { rol: 'contador', localId: null });
  otroLocal = await crearUsuarioDePrueba(env, { rol: 'vendedor', localId: vidrios });

  // Datos de prueba: un producto, un modelo, una orden, un empleado y un pago
  const ahora = new Date().toISOString();
  ids = { producto: crypto.randomUUID(), modelo: crypto.randomUUID(), orden: crypto.randomUUID(), nomina: crypto.randomUUID(), empleado: crypto.randomUUID() };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO productos (id, codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_minimo, created_at) VALUES (?, ?, ?, ?, 1, 6, 0, ?)').bind(ids.producto, '2000000000015', 'Forro matriz', 'Forros', ahora),
    env.DB.prepare('INSERT INTO modelos_telefono (id, marca, modelo, created_at) VALUES (?, ?, ?, ?)').bind(ids.modelo, 'Marca', 'Borrable', ahora),
    env.DB.prepare('INSERT INTO empleados (id, local_id, nombre, apellido, cedula, cargo, salario_base, tipo, frecuencia_pago, estado, fecha_ingreso, created_at) VALUES (?, ?, ?, ?, ?, ?, 200, ?, ?, ?, ?, ?)').bind(ids.empleado, accesorios, 'Eva', 'Mora', 'V-6000001', 'Cajera', 'FIJO', 'QUINCENAL', 'ACTIVO', '2026-01-01', ahora),
  ]);
}, 60_000);

async function llamar(caso: Caso, usuario: UsuarioDePrueba | null): Promise<number> {
  const modulo = await cargar(caso.archivo);
  const manejador = modulo[caso.metodo];
  if (!manejador) throw new Error(`${caso.archivo} no exporta ${caso.metodo}`);
  const esJson = caso.tipo === undefined;
  const init: RequestInit = { method: caso.metodo };
  if (caso.cuerpo !== undefined) {
    init.body = esJson ? JSON.stringify(caso.cuerpo) : (caso.cuerpo as BodyInit);
    init.headers = { 'content-type': caso.tipo ?? 'application/json' };
  }
  const respuesta = await manejador({ request: peticionComo(usuario, caso.url, init), params: caso.params ?? {} });
  return respuesta.status;
}

describe('matriz de roles: cada endpoint contra cada rol', () => {
  const lista = (() => {
    // `casos()` necesita los ids de prueba: se construye perezosamente dentro de cada prueba
    return null;
  })();
  void lista;

  it('cada endpoint responde según su tabla de permisos (sin sesión: 401; sin permiso: 403; con permiso: nunca 401/403)', async () => {
    const fallos: string[] = [];
    for (const caso of casos()) {
      const etiqueta = `${caso.metodo} ${caso.archivo}`;
      const sinSesion = await llamar(caso, null);
      if (sinSesion !== 401) fallos.push(`${etiqueta}: sin sesión → ${sinSesion} (debía ser 401)`);
      for (const rol of TODOS) {
        const estado = await llamar(caso, usuarios[rol]);
        const permitido = caso.permitidos.includes(rol);
        if (permitido && (estado === 401 || estado === 403 || estado >= 500)) fallos.push(`${etiqueta}: ${rol} debía poder pero respondió ${estado}`);
        if (!permitido && estado !== 403) fallos.push(`${etiqueta}: ${rol} NO debía poder y respondió ${estado} (debía ser 403)`);
      }
    }
    expect(fallos).toEqual([]);
  }, 180_000);

  it('toda ruta con método está en la tabla (si se agrega una ruta nueva, esta prueba obliga a decidir sus permisos)', async () => {
    const SIN_TABLA = new Set(['salud.ts', 'auth/[...todo].ts', 'archivos/publico/[...ruta].ts', 'cuenta/estado.ts']);
    const cubiertos = new Set(casos().map((c) => `${c.metodo} ${c.archivo}`));
    const faltan: string[] = [];
    for (const clave of Object.keys(modulos)) {
      const archivo = clave.replace('../../src/pages/api/', '');
      if (SIN_TABLA.has(archivo)) continue;
      const modulo = await modulos[clave]();
      for (const metodo of Object.keys(modulo).filter((m) => m !== 'prerender')) {
        if (!cubiertos.has(`${metodo} ${archivo}`)) faltan.push(`${metodo} ${archivo}`);
      }
    }
    expect(faltan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Review Focus 1 y 5: el bloqueo vale para TODAS las rutas, no solo para las que se probaron una por una
// ---------------------------------------------------------------------------------------------------------------------
describe('bloqueos de cuenta y de suscripción en toda la API', () => {
  // Rutas que a propósito responden aunque no haya acceso a ningún local (devuelven vacío o el propio estado)
  const SIEMPRE_RESPONDEN = new Set(['locales/index.ts', 'cambios.ts']);
  const productosGet: Caso = { archivo: 'productos/index.ts', metodo: 'GET', url: '/api/productos', permitidos: NEGOCIO };

  it('usuario desactivado o con la sesión cerrada a la fuerza: TODA ruta responde 401 aunque conserve una cookie válida', async () => {
    const fallos: string[] = [];
    for (const [modo, sql] of [
      ['desactivado', "UPDATE perfiles SET status = 'inactive' WHERE id = ?"],
      ['sesión cerrada', "UPDATE perfiles SET last_force_logout_at = '2999-01-01T00:00:00.000Z' WHERE id = ?"],
    ] as const) {
      const victima = usuarios.vendedor;
      await env.DB.prepare(sql).bind(victima.id).run();
      try {
        for (const caso of casos()) {
          const estado = await llamar(caso, victima);
          if (estado !== 401) fallos.push(`${caso.metodo} ${caso.archivo} (${modo}) → ${estado}`);
        }
      } finally {
        await env.DB.prepare("UPDATE perfiles SET status = 'active', last_force_logout_at = NULL WHERE id = ?").bind(victima.id).run();
      }
    }
    expect(fallos).toEqual([]);
  }, 120_000);

  it('el administrador desactivado tampoco entra (la cuenta manda sobre el rol)', async () => {
    await env.DB.prepare("UPDATE perfiles SET status = 'inactive' WHERE id = ?").bind(usuarios.administrador.id).run();
    try {
      expect(await llamar(productosGet, usuarios.administrador)).toBe(401);
    } finally {
      await env.DB.prepare("UPDATE perfiles SET status = 'active' WHERE id = ?").bind(usuarios.administrador.id).run();
    }
  });

  it('local suspendido: sus empleados reciben 403 en toda ruta de negocio; el administrador nunca se bloquea y los de otro local siguen', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'SUSPENDED' WHERE id = ?").bind(accesorios).run();
    try {
      const fallos: string[] = [];
      for (const caso of casos()) {
        const etiqueta = `${caso.metodo} ${caso.archivo}`;
        if (SIEMPRE_RESPONDEN.has(caso.archivo)) continue;
        for (const rol of ['encargado', 'vendedor', 'tecnico'] as const) {
          if (!caso.permitidos.includes(rol)) continue;
          const estado = await llamar(caso, usuarios[rol]);
          if (estado !== 403) fallos.push(`${etiqueta}: ${rol} del local suspendido → ${estado} (debía ser 403)`);
        }
        const admin = await llamar(caso, usuarios.administrador);
        if (admin === 401 || admin === 403) fallos.push(`${etiqueta}: el administrador respondió ${admin}`);
      }
      expect(fallos).toEqual([]);
      expect(await llamar(productosGet, otroLocal)).toBe(200);
    } finally {
      await env.DB.prepare("UPDATE locales SET subscription_status = 'ACTIVE' WHERE id = ?").bind(accesorios).run();
    }
  }, 120_000);

  it('local vencido (suscripción activa pero con fecha pasada) se trata igual que suspendido', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").bind(accesorios).run();
    try {
      expect(await llamar(productosGet, usuarios.vendedor)).toBe(403);
      expect(await llamar(productosGet, usuarios.administrador)).toBe(200);
    } finally {
      await env.DB.prepare('UPDATE locales SET subscription_expires_at = NULL WHERE id = ?').bind(accesorios).run();
    }
  });

  it('si TODOS los locales están bloqueados, también el gerente y el contador reciben 403 en toda ruta; el administrador nunca', async () => {
    await env.DB.prepare("UPDATE locales SET subscription_status = 'PAST_DUE'").run();
    try {
      const fallos: string[] = [];
      for (const caso of casos()) {
        if (SIEMPRE_RESPONDEN.has(caso.archivo)) continue;
        const etiqueta = `${caso.metodo} ${caso.archivo}`;
        for (const rol of ['gerente', 'contador'] as const) {
          if (!caso.permitidos.includes(rol)) continue;
          const estado = await llamar(caso, usuarios[rol]);
          if (estado !== 403) fallos.push(`${etiqueta}: ${rol} con todos los locales bloqueados → ${estado} (debía ser 403)`);
        }
        const admin = await llamar(caso, usuarios.administrador);
        if (admin === 401 || admin === 403) fallos.push(`${etiqueta}: el administrador respondió ${admin}`);
      }
      expect(fallos).toEqual([]);
    } finally {
      await env.DB.prepare("UPDATE locales SET subscription_status = 'ACTIVE'").run();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Review Focus 2: un empleado que pide directamente datos de OTRO local no recibe nada ajeno
// ---------------------------------------------------------------------------------------------------------------------
describe('aislamiento entre locales', () => {
  it('pedir otro local con ?localId= o por la ruta responde 403 para vendedor, técnico y encargado', async () => {
    const ajenos: Caso[] = [
      { archivo: 'ventas/index.ts', metodo: 'GET', url: `/api/ventas?localId=${vidrios}`, permitidos: [] },
      { archivo: 'devoluciones/index.ts', metodo: 'GET', url: `/api/devoluciones?localId=${vidrios}`, permitidos: [] },
      { archivo: 'ordenes/index.ts', metodo: 'GET', url: `/api/ordenes?localId=${vidrios}`, permitidos: [] },
      { archivo: 'movimientos/index.ts', metodo: 'GET', url: `/api/movimientos?localId=${vidrios}`, permitidos: [] },
      { archivo: 'unidades/index.ts', metodo: 'GET', url: `/api/unidades?localId=${vidrios}`, permitidos: [] },
      { archivo: 'productos/stock-bajo.ts', metodo: 'GET', url: `/api/productos/stock-bajo?localId=${vidrios}`, permitidos: [] },
      { archivo: 'cuadres/[localId]/[fecha]/index.ts', metodo: 'GET', url: `/api/cuadres/${vidrios}/${dia}`, params: { localId: vidrios, fecha: dia }, permitidos: [] },
      { archivo: 'cuadres/[localId]/[fecha]/esperado.ts', metodo: 'GET', url: `/api/cuadres/${vidrios}/${dia}/esperado`, params: { localId: vidrios, fecha: dia }, permitidos: [] },
      { archivo: 'archivos/privado/[...ruta].ts', metodo: 'GET', url: '/api/archivos/privado/x', params: { ruta: `cuadres-caja/${vidrios}/${dia}/EFECTIVO-1-1.jpg` }, permitidos: [] },
      { archivo: 'movimientos/index.ts', metodo: 'POST', url: '/api/movimientos', cuerpo: { productoId: ids.producto, tipo: 'SALIDA', cantidad: 1, localId: vidrios }, permitidos: [] },
    ];
    const fallos: string[] = [];
    for (const caso of ajenos) {
      for (const rol of ['vendedor', 'tecnico', 'encargado'] as const) {
        const estado = await llamar(caso, usuarios[rol]);
        if (estado !== 403) fallos.push(`${caso.metodo} ${caso.url} como ${rol} → ${estado} (debía ser 403)`);
      }
    }
    expect(fallos).toEqual([]);
  });

  it('el empleado de otro local no ve el stock del local 1 en la lista de productos', async () => {
    await env.DB.prepare('INSERT INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo) VALUES (?, ?, 7, 0) ON CONFLICT (local_id, producto_id) DO UPDATE SET stock_actual = 7').bind(accesorios, ids.producto).run();
    const modulo = await cargar('productos/index.ts');
    const respuesta = await modulo.GET({ request: peticionComo(otroLocal, '/api/productos'), params: {} });
    const productos = (await respuesta.json()) as { id: string; inventario: { local_id: string }[] }[];
    expect(productos.length).toBeGreaterThan(0);
    expect(productos.flatMap((p) => p.inventario).every((i) => i.local_id === vidrios)).toBe(true);
  });
});
