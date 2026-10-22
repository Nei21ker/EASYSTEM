// Tipos manuales que reflejan supabase/schema.sql.
// Si usas la CLI de Supabase, reemplaza este archivo con:
//   npx supabase gen types typescript --local > src/types/database.types.ts

export type TipoMovimiento = 'ENTRADA' | 'SALIDA';

/** Tipo de local: define qué módulos aplican (el de servicio técnico trabaja con órdenes de servicio). */
export type TipoLocal = 'accesorios' | 'vidrios' | 'servicio_tecnico';

/** Estado de la suscripción SaaS de un local. Solo ACTIVE (y no vencida) deja operar a sus empleados. */
export type EstadoSuscripcion = 'ACTIVE' | 'SUSPENDED' | 'PAST_DUE';

/** Local (sucursal) del negocio: tiene inventario, ventas y empleados propios. */
export interface Local {
  id: string;
  nombre: string;
  tipo: TipoLocal;
  direccion?: string | null;
  telefono?: string | null;
  activo: boolean;
  created_at: string;
  /** Suscripción (migración 0021). Si falta (datos o servidor anteriores) se asume ACTIVE */
  subscription_status?: EstadoSuscripcion;
  subscription_expires_at?: string | null;
}

/** Stock y mínimo de un producto en un local (tabla pivote). stock_minimo = 0 → sin control de reabastecimiento. */
export interface InventarioLocal {
  local_id: string;
  producto_id: string;
  stock_actual: number;
  stock_minimo: number;
}

export interface ModeloTelefono {
  id: string;
  marca: string;
  modelo: string;
  created_at: string;
}

export interface Producto {
  id: string;
  codigo_barras: string;
  nombre: string;
  categoria: string;
  precio_compra: number;
  precio_venta: number;
  /** Stock en el alcance activo: el del local elegido, o el total entre locales en la vista "Todos" */
  stock_actual: number;
  /** Mínimo del local elegido (en la vista "Todos", la suma de los mínimos de los locales que lo controlan) */
  stock_minimo: number;
  /** URL pública (Supabase Storage) o data URL (modo LocalStorage); opcional */
  imagen_url?: string | null;
  created_at: string;
}

export interface Compatibilidad {
  id: string;
  producto_id: string;
  modelo_id: string;
}

export interface MovimientoInventario {
  id: string;
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  fecha: string;
  motivo: string | null;
  /** Local donde se movió el stock */
  local_id: string;
  /** Códigos de las unidades que se movieron (migración 0033): las creadas en una entrada, las vendidas en una salida */
  unidad_codigos?: string[] | null;
}

/** Cada unidad física tiene su propio código único (EAN-13, prefijo 21). Disponible = cuenta en el stock del local. */
export type EstadoUnidad = 'DISPONIBLE' | 'VENDIDA';

export interface UnidadProducto {
  id: string;
  producto_id: string;
  local_id: string;
  codigo: string;
  estado: EstadoUnidad;
  created_at: string;
  vendida_en?: string | null;
  /** Cuándo se imprimió su etiqueta; null = todavía no tiene etiqueta pegada */
  impresa_en?: string | null;
}

/** Producto "enriquecido" con sus modelos compatibles, tal como lo consume el Dashboard */
export interface ProductoConRelaciones extends Producto {
  modelos_compatibles: ModeloTelefono[];
  /** Solo en la vista "Todos los locales" (administrador): stock de cada local, por id de local */
  stock_por_local?: Record<string, number>;
}

export interface ProductoStockBajo {
  id: string;
  codigo_barras: string;
  nombre: string;
  categoria: string;
  stock_actual: number;
  stock_minimo: number;
  /** Local al que corresponde la alerta (cada local tiene su propio stock y mínimo) */
  local_id?: string;
  local_nombre?: string;
}

export type MetodoPago = 'BS_PAGO_MOVIL' | 'BS_PUNTO_VENTA' | 'BS_EFECTIVO' | 'USD_EFECTIVO' | 'BINANCE_USDT';

/** Lo que se cobró con un tipo de cobro dentro de una venta (una venta puede tener varios). */
export interface PagoVenta {
  metodo: MetodoPago;
  /** Valor en dólares de este pago; la suma de todos los pagos es el total de la venta */
  monto_usd: number;
  /** Bolívares recibidos (solo en los tipos de cobro en Bs; null en dólares/USDT) */
  monto_bs: number | null;
}

/** Dinero que sale hacia el cliente: vuelto de una venta o reembolso de una devolución. */
export interface DineroEntregado {
  metodo: MetodoPago;
  monto_usd: number;
  /** Bolívares entregados (solo en los tipos de cobro en Bs) */
  monto_bs: number | null;
}

/** En la venta, 'MIXTO' = se usaron varios tipos de cobro (el detalle está en `pagos`). */
export type MetodoPagoVenta = MetodoPago | 'MIXTO';

export interface VentaItem {
  producto_id: string;
  nombre: string;
  codigo_barras: string;
  cantidad: number;
  /** Precio de venta vigente al momento de la venta */
  precio_unitario: number;
  /** Códigos de las unidades concretas que salieron (migración 0033); las ventas anteriores no lo traen */
  unidades?: string[];
}

export interface ClienteVenta {
  /** Con prefijo de nacionalidad, p. ej. "V-12345678" */
  cedula: string;
  nombre: string;
  telefono: string;
}

/** Lo que el POS envía al registrar una venta (el folio lo asigna el sistema). */
export interface NuevaVenta {
  fecha: string;
  /** Local donde se hizo la venta */
  local_id: string;
  cliente_cedula: string;
  cliente_nombre: string;
  cliente_telefono: string;
  metodo_pago: MetodoPagoVenta;
  /** Detalle de cobros por tipo; las ventas anteriores a las migraciones 0013 pueden no traerlo (ver pagosDeVenta) */
  pagos?: PagoVenta[] | null;
  /** Vuelto entregado si el cliente pagó de más: suma de pagos − vuelto = total */
  vuelto?: DineroEntregado | null;
  /** Total en dólares (los precios del catálogo están en $) */
  total: number;
  items: VentaItem[];
  vendedor_nombre?: string | null;
  /** Bs por $ vigente al momento de la venta */
  tasa_cambio?: number | null;
  /** Bolívares cobrados (suma de los pagos en Bs); null si no se cobró nada en Bs */
  total_bs?: number | null;
}

export interface Venta extends NuevaVenta {
  id: string;
  folio: number;
  vendedor_id?: string | null;
}

/** Tasa del dólar: bolívares por 1 USD. Cada cambio es una fila (historial); la vigente es la última. */
export interface TasaCambio {
  id: string;
  /** Día al que corresponde (YYYY-MM-DD, hora local del negocio) */
  fecha: string;
  tasa: number;
  created_at: string;
  registrado_nombre?: string | null;
}

export interface NuevaTasa {
  fecha: string;
  tasa: number;
  registrado_nombre?: string | null;
}

/** Devolución o cambio de producto sobre una venta (ver migración 0014). */
export interface NuevaDevolucion {
  fecha: string;
  /** Local de la venta devuelta (ahí vuelve el stock) */
  local_id: string;
  venta_id: string;
  venta_folio: number;
  motivo: string;
  items_devueltos: VentaItem[];
  /** Productos entregados a cambio (vacío en una devolución simple) */
  items_nuevos: VentaItem[];
  total_devuelto: number;
  total_nuevo: number;
  /** total_nuevo − total_devuelto: > 0 el cliente paga la diferencia, < 0 se le reembolsa */
  diferencia: number;
  tasa_cambio?: number | null;
  /** Cobro de la diferencia (cuando el cliente paga más) */
  pagos?: PagoVenta[] | null;
  vuelto?: DineroEntregado | null;
  /** Dinero devuelto al cliente (cuando la diferencia es a su favor) */
  reembolso?: DineroEntregado | null;
  registrado_nombre?: string | null;
}

export interface Devolucion extends NuevaDevolucion {
  id: string;
  folio: number;
}

// --- Servicio técnico -----------------------------------------------------------------------------
export type EstadoOrdenServicio = 'pendiente' | 'en_reparacion' | 'listo' | 'entregado';

/** Repuesto consumido del stock del local en una orden de servicio (con el precio del momento). */
export type RepuestoOrden = VentaItem;

export interface NuevaOrdenServicio {
  local_id: string;
  cliente_cedula: string;
  cliente_nombre: string;
  cliente_telefono: string;
  equipo_marca: string;
  equipo_modelo: string;
  /** IMEI o número de serie, si se tiene */
  equipo_imei?: string | null;
  /** Qué se recibió junto al equipo (cargador, funda, SIM...) */
  accesorios_recibidos?: string | null;
  falla_reportada: string;
  registrado_nombre?: string | null;
}

export interface OrdenServicio extends NuevaOrdenServicio {
  id: string;
  folio: number;
  diagnostico: string | null;
  estado: EstadoOrdenServicio;
  tecnico_id?: string | null;
  tecnico_nombre?: string | null;
  repuestos: RepuestoOrden[];
  mano_de_obra_usd: number;
  /** Repuestos + mano de obra, en dólares */
  total_usd: number;
  recibida_en: string;
  actualizada_en: string;
  listo_en?: string | null;
  entregada_en?: string | null;
}

// ----------------------------------------------------------------------------
// Nómina (migración 0027): personal que cobra sueldo en cada local y sus pagos quincenales
// ----------------------------------------------------------------------------
export type EstadoEmpleado = 'ACTIVO' | 'INACTIVO';
/** FIJO cobra por quincena; INDEPENDIENTE cobra por día según lo que revendió (migración 0032). */
export type TipoTrabajador = 'FIJO' | 'INDEPENDIENTE';
export type EstadoPago = 'PENDIENTE' | 'PAGADO';

/** Empleado de un local (no es lo mismo que una cuenta de acceso: ver `perfiles`). */
export interface Empleado {
  id: string;
  local_id: string;
  nombre: string;
  apellido: string;
  cedula: string;
  cargo: string;
  /** Salario MENSUAL en dólares; cada quincena se paga la mitad (0 en un trabajador independiente) */
  salario_base: number;
  tipo: TipoTrabajador;
  frecuencia_pago: 'QUINCENAL' | 'DIARIO';
  estado: EstadoEmpleado;
  /** "aaaa-mm-dd" */
  fecha_ingreso: string;
  created_at: string;
}

export type NuevoEmpleado = Pick<Empleado, 'local_id' | 'nombre' | 'apellido' | 'cedula' | 'cargo' | 'salario_base'> &
  Partial<Pick<Empleado, 'estado' | 'fecha_ingreso' | 'tipo' | 'frecuencia_pago'>>;

/**
 * Producto que un trabajador INDEPENDIENTE revendió en el día. Su ganancia es cantidad × (precio_vendido − precio_lista);
 * la lista NO descuenta stock (solo sirve para calcular el pago). Se guarda con los datos del producto de ese momento.
 */
export interface LineaReventa {
  producto_id: string | null;
  producto_nombre: string;
  producto_codigo: string | null;
  cantidad: number;
  /** Precio de venta del catálogo al armar la lista */
  precio_lista: number;
  /** Precio al que el trabajador lo vendió (nunca menor al de lista) */
  precio_vendido: number;
}

/** Producto del catálogo tal como se ofrece para armar la lista de reventa (sin costos ni existencias). */
export interface ProductoReventa {
  id: string;
  codigo_barras: string;
  nombre: string;
  categoria: string;
  precio_venta: number;
}

/** Pago quincenal de un empleado: pago_base + bonos - deducciones = total_pagado (en dólares). */
export interface Nomina {
  id: string;
  empleado_id: string;
  local_id: string;
  /** "aaaa-mm-dd" */
  periodo_inicio: string;
  periodo_fin: string;
  pago_base: number;
  bonos: number;
  deducciones: number;
  total_pagado: number;
  estado_pago: EstadoPago;
  pagado_en: string | null;
  notas: string | null;
  /** Captura del pago (opcional): ruta en el bucket privado comprobantes-nomina; en LocalStorage, la imagen como data URL */
  comprobante_path: string | null;
  created_at: string;
}

// ----------------------------------------------------------------------------
// Cuadre de caja diario (migración 0034)
// ----------------------------------------------------------------------------
export type EstadoCuadre = 'ABIERTO' | 'CERRADO';
/** Qué muestra cada foto de respaldo del cuadre */
export type TipoFotoCuadre = 'PAGO_MOVIL' | 'BINANCE' | 'EFECTIVO' | 'CIERRE_PUNTO';

/** Lo que el sistema esperaba haber cobrado con un tipo de cobro ese día (neto de vuelto y reembolsos). */
export interface EsperadoCuadre {
  metodo: MetodoPago;
  /** Ventas en las que se usó ese tipo de cobro */
  ventas: number;
  usd: number;
  bs: number;
}

/** Lo que se declaró tener, en la moneda del tipo de cobro (Bs en los BS_*, $ en los demás). */
export interface ContadoCuadre {
  metodo: MetodoPago;
  monto: number;
}

/** Foto de respaldo: ruta en el bucket privado cuadres-caja (en LocalStorage, la imagen como data URL). */
export interface FotoCuadre {
  tipo: TipoFotoCuadre;
  path: string;
}

export interface CuadreCaja {
  id: string;
  local_id: string;
  /** Día cuadrado, "aaaa-mm-dd" */
  fecha: string;
  estado: EstadoCuadre;
  esperado: EsperadoCuadre[];
  contado: ContadoCuadre[];
  fotos: FotoCuadre[];
  notas: string | null;
  registrado_nombre: string | null;
  cerrado_en: string | null;
  cerrado_por: string | null;
  created_at: string;
  updated_at: string;
}
