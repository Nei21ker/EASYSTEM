// Esquema Drizzle: espejo de migrations/0001_d1_schema.sql, SOLO para consultas con tipos.
// Las migraciones se escriben a mano en SQL (drizzle-kit no genera triggers ni CHECK complejos): si cambias una
// tabla, cambia las dos. Las propiedades se llaman igual que las columnas (snake_case) para que las filas ya
// tengan la forma de los tipos del cliente (src/types/database.types.ts).
import { sql } from 'drizzle-orm';
import { customType, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  ContadoCuadre, DineroEntregado, EsperadoCuadre, FotoCuadre, PagoVenta, RepuestoOrden, VentaItem,
} from '../../types/database.types';

/** Columna TEXT que guarda JSON y se lee como objeto. */
const json = <T>(nombre: string) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => 'text',
    toDriver: (valor) => JSON.stringify(valor),
    fromDriver: (valor) => JSON.parse(valor) as T,
  })(nombre);

// La base de datos pone la hora (UTC, ISO-8601) cuando no se indica
const ahora = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const marca = (nombre: string) => text(nombre).notNull().default(ahora);

// --- Better-Auth (fechas en milisegundos) ---------------------------------------------------------------------
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull(),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }),
});

// Limitador de intentos de Better-Auth (migración 0003)
export const rateLimit = sqliteTable('rateLimit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('lastRequest').notNull(),
});

// Clientes que ya compraron (migración 0004)
export const clientes = sqliteTable('clientes', {
  cedula: text('cedula').primaryKey(),
  nombre: text('nombre').notNull(),
  apellido: text('apellido').notNull().default(''),
  telefono: text('telefono').notNull(),
  updated_at: text('updated_at').notNull(),
});

// --- Locales y perfiles ---------------------------------------------------------------------------------------
export const locales = sqliteTable('locales', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull().unique(),
  tipo: text('tipo', { enum: ['accesorios', 'vidrios', 'servicio_tecnico', 'controles'] }).notNull(),
  direccion: text('direccion'),
  telefono: text('telefono'),
  activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  created_at: marca('created_at'),
  subscription_status: text('subscription_status', { enum: ['ACTIVE', 'SUSPENDED', 'PAST_DUE'] }).notNull().default('ACTIVE'),
  subscription_expires_at: text('subscription_expires_at'),
});

export const perfiles = sqliteTable('perfiles', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  nombre: text('nombre').notNull(),
  rol: text('rol', { enum: ['administrador', 'gerente', 'encargado', 'vendedor', 'tecnico', 'contador'] }).notNull().default('vendedor'),
  local_id: text('local_id'),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  last_force_logout_at: text('last_force_logout_at'),
  created_at: marca('created_at'),
});

export const suscripcion_eventos = sqliteTable('suscripcion_eventos', {
  id: text('id').primaryKey(),
  local_id: text('local_id').notNull(),
  estado_anterior: text('estado_anterior'),
  estado_nuevo: text('estado_nuevo').notNull(),
  vence_anterior: text('vence_anterior'),
  vence_nuevo: text('vence_nuevo'),
  cambiado_por: text('cambiado_por'),
  fecha: marca('fecha'),
});

// --- Catálogo -------------------------------------------------------------------------------------------------
export const modelos_telefono = sqliteTable('modelos_telefono', {
  id: text('id').primaryKey(),
  marca: text('marca').notNull(),
  modelo: text('modelo').notNull(),
  created_at: marca('created_at'),
});

export const productos = sqliteTable('productos', {
  id: text('id').primaryKey(),
  codigo_barras: text('codigo_barras').notNull().unique(),
  nombre: text('nombre').notNull(),
  categoria: text('categoria').notNull(),
  precio_compra: real('precio_compra').notNull().default(0),
  precio_venta: real('precio_venta').notNull().default(0),
  stock_actual: integer('stock_actual').notNull().default(0),
  stock_minimo: integer('stock_minimo').notNull().default(5),
  imagen_url: text('imagen_url'),
  created_at: marca('created_at'),
});

export const compatibilidades = sqliteTable('compatibilidades', {
  id: text('id').primaryKey(),
  producto_id: text('producto_id').notNull(),
  modelo_id: text('modelo_id').notNull(),
});

export const inventario_local = sqliteTable(
  'inventario_local',
  {
    local_id: text('local_id').notNull(),
    producto_id: text('producto_id').notNull(),
    stock_actual: integer('stock_actual').notNull().default(0),
    stock_minimo: integer('stock_minimo').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.local_id, t.producto_id] })]
);

export const movimientos_inventario = sqliteTable('movimientos_inventario', {
  id: text('id').primaryKey(),
  producto_id: text('producto_id').notNull(),
  tipo: text('tipo', { enum: ['ENTRADA', 'SALIDA'] }).notNull(),
  cantidad: integer('cantidad').notNull(),
  fecha: marca('fecha'),
  motivo: text('motivo'),
  local_id: text('local_id').notNull(),
  unidad_codigos: json<string[]>('unidad_codigos'),
});

export const unidades_producto = sqliteTable('unidades_producto', {
  id: text('id').primaryKey(),
  producto_id: text('producto_id').notNull(),
  local_id: text('local_id').notNull(),
  codigo: text('codigo').notNull().unique(),
  estado: text('estado', { enum: ['DISPONIBLE', 'VENDIDA'] }).notNull().default('DISPONIBLE'),
  created_at: marca('created_at'),
  vendida_en: text('vendida_en'),
  impresa_en: text('impresa_en'),
  reimpresiones: integer('reimpresiones').notNull().default(0),
  ultima_reimpresion: text('ultima_reimpresion'),
});

// --- Ventas, devoluciones y tasa -------------------------------------------------------------------------------
export const ventas = sqliteTable('ventas', {
  id: text('id').primaryKey(),
  folio: integer('folio').notNull().unique(),
  fecha: marca('fecha'),
  local_id: text('local_id').notNull(),
  cliente_cedula: text('cliente_cedula').notNull(),
  cliente_nombre: text('cliente_nombre').notNull(),
  cliente_telefono: text('cliente_telefono').notNull(),
  metodo_pago: text('metodo_pago', { enum: ['BS_PAGO_MOVIL', 'BS_PUNTO_VENTA', 'BS_EFECTIVO', 'USD_EFECTIVO', 'BINANCE_USDT', 'MIXTO'] }).notNull(),
  total: real('total').notNull(),
  items: json<VentaItem[]>('items').notNull(),
  pagos: json<PagoVenta[]>('pagos'),
  vuelto: json<DineroEntregado>('vuelto'),
  tasa_cambio: real('tasa_cambio'),
  total_bs: real('total_bs'),
  vendedor_id: text('vendedor_id'),
  vendedor_nombre: text('vendedor_nombre'),
});

export const devoluciones = sqliteTable('devoluciones', {
  id: text('id').primaryKey(),
  folio: integer('folio').notNull().unique(),
  fecha: marca('fecha'),
  local_id: text('local_id').notNull(),
  venta_id: text('venta_id').notNull(),
  venta_folio: integer('venta_folio').notNull(),
  motivo: text('motivo').notNull(),
  items_devueltos: json<VentaItem[]>('items_devueltos').notNull(),
  items_nuevos: json<VentaItem[]>('items_nuevos').notNull().default([] as never),
  total_devuelto: real('total_devuelto').notNull(),
  total_nuevo: real('total_nuevo').notNull().default(0),
  diferencia: real('diferencia').notNull(),
  tasa_cambio: real('tasa_cambio'),
  pagos: json<PagoVenta[]>('pagos'),
  vuelto: json<DineroEntregado>('vuelto'),
  reembolso: json<DineroEntregado>('reembolso'),
  registrado_por: text('registrado_por'),
  registrado_nombre: text('registrado_nombre'),
});

export const tasas_cambio = sqliteTable('tasas_cambio', {
  id: text('id').primaryKey(),
  fecha: text('fecha').notNull(),
  tasa: real('tasa').notNull(),
  created_at: marca('created_at'),
  registrado_por: text('registrado_por'),
  registrado_nombre: text('registrado_nombre'),
});

// --- Servicio técnico ------------------------------------------------------------------------------------------
export const ordenes_servicio = sqliteTable('ordenes_servicio', {
  id: text('id').primaryKey(),
  folio: integer('folio').notNull().unique(),
  local_id: text('local_id').notNull(),
  cliente_cedula: text('cliente_cedula').notNull(),
  cliente_nombre: text('cliente_nombre').notNull(),
  cliente_telefono: text('cliente_telefono').notNull(),
  equipo_marca: text('equipo_marca').notNull(),
  equipo_modelo: text('equipo_modelo').notNull(),
  equipo_imei: text('equipo_imei'),
  accesorios_recibidos: text('accesorios_recibidos'),
  falla_reportada: text('falla_reportada').notNull(),
  diagnostico: text('diagnostico'),
  estado: text('estado', { enum: ['pendiente', 'en_reparacion', 'listo', 'entregado'] }).notNull().default('pendiente'),
  tecnico_id: text('tecnico_id'),
  tecnico_nombre: text('tecnico_nombre'),
  repuestos: json<RepuestoOrden[]>('repuestos').notNull().default([] as never),
  mano_de_obra_usd: real('mano_de_obra_usd').notNull().default(0),
  total_usd: real('total_usd').notNull().default(0),
  recibida_en: marca('recibida_en'),
  actualizada_en: marca('actualizada_en'),
  listo_en: text('listo_en'),
  entregada_en: text('entregada_en'),
  registrado_por: text('registrado_por'),
  registrado_nombre: text('registrado_nombre'),
});

// --- Nómina ---------------------------------------------------------------------------------------------------
export const empleados = sqliteTable('empleados', {
  id: text('id').primaryKey(),
  local_id: text('local_id').notNull(),
  nombre: text('nombre').notNull(),
  apellido: text('apellido').notNull(),
  cedula: text('cedula').notNull().unique(),
  cargo: text('cargo').notNull(),
  salario_base: real('salario_base').notNull(),
  tipo: text('tipo', { enum: ['FIJO', 'INDEPENDIENTE'] }).notNull().default('FIJO'),
  frecuencia_pago: text('frecuencia_pago', { enum: ['QUINCENAL', 'DIARIO'] }).notNull().default('QUINCENAL'),
  estado: text('estado', { enum: ['ACTIVO', 'INACTIVO'] }).notNull().default('ACTIVO'),
  fecha_ingreso: text('fecha_ingreso').notNull(),
  created_at: marca('created_at'),
});

export const nominas = sqliteTable('nominas', {
  id: text('id').primaryKey(),
  empleado_id: text('empleado_id').notNull(),
  local_id: text('local_id').notNull(),
  periodo_inicio: text('periodo_inicio').notNull(),
  periodo_fin: text('periodo_fin').notNull(),
  pago_base: real('pago_base').notNull(),
  bonos: real('bonos').notNull().default(0),
  deducciones: real('deducciones').notNull().default(0),
  total_pagado: real('total_pagado').notNull(),
  estado_pago: text('estado_pago', { enum: ['PENDIENTE', 'PAGADO'] }).notNull().default('PENDIENTE'),
  pagado_en: text('pagado_en'),
  notas: text('notas'),
  comprobante_path: text('comprobante_path'),
  registrado_por: text('registrado_por'),
  created_at: marca('created_at'),
});

export const nomina_reventas = sqliteTable('nomina_reventas', {
  id: text('id').primaryKey(),
  nomina_id: text('nomina_id').notNull(),
  local_id: text('local_id').notNull(),
  producto_id: text('producto_id'),
  producto_nombre: text('producto_nombre').notNull(),
  producto_codigo: text('producto_codigo'),
  cantidad: integer('cantidad').notNull(),
  precio_lista: real('precio_lista').notNull(),
  precio_vendido: real('precio_vendido').notNull(),
  created_at: marca('created_at'),
});

// --- Cuadre de caja ---------------------------------------------------------------------------------------------
export const cuadres_caja = sqliteTable('cuadres_caja', {
  id: text('id').primaryKey(),
  local_id: text('local_id').notNull(),
  fecha: text('fecha').notNull(),
  estado: text('estado', { enum: ['ABIERTO', 'CERRADO'] }).notNull().default('ABIERTO'),
  esperado: json<EsperadoCuadre[]>('esperado').notNull().default([] as never),
  contado: json<ContadoCuadre[]>('contado').notNull().default([] as never),
  fotos: json<FotoCuadre[]>('fotos').notNull().default([] as never),
  notas: text('notas'),
  registrado_por: text('registrado_por'),
  registrado_nombre: text('registrado_nombre'),
  cerrado_en: text('cerrado_en'),
  cerrado_por: text('cerrado_por'),
  created_at: marca('created_at'),
  updated_at: marca('updated_at'),
});

// --- Contadores y versiones ----------------------------------------------------------------------------------------
export const contadores = sqliteTable('contadores', {
  nombre: text('nombre').primaryKey(),
  valor: integer('valor').notNull().default(0),
});

export const cambios = sqliteTable(
  'cambios',
  {
    tabla: text('tabla').notNull(),
    local_id: text('local_id').notNull().default(''),
    version: integer('version').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tabla, t.local_id] })]
);
