// Tipos manuales que reflejan supabase/schema.sql.
// Si usas la CLI de Supabase, reemplaza este archivo con:
//   npx supabase gen types typescript --local > src/types/database.types.ts

/** Los dos que se registran a mano (ingreso y venta/ajuste). */
export type TipoMovimientoManual = 'ENTRADA' | 'SALIDA';
/**
 * Todos los tipos de movimiento. Los traslados entre locales (TRASLADO_SALIDA al despachar, TRASLADO_ENTRADA al recibir o al devolver lo
 * que no llegó) y las BAJA de piezas mueven el stock de un local pero NO son ventas ni compras: los reportes no los cuentan.
 */
export type TipoMovimiento = TipoMovimientoManual | 'TRASLADO_SALIDA' | 'TRASLADO_ENTRADA' | 'BAJA';

/** ¿Este tipo suma al stock del local? (el resto lo resta) */
export const sumaStock = (tipo: TipoMovimiento): boolean => tipo === 'ENTRADA' || tipo === 'TRASLADO_ENTRADA';

/** Tipo de local: define qué módulos aplican (el de servicio técnico trabaja con órdenes de servicio). */
export type TipoLocal = 'accesorios' | 'vidrios' | 'servicio_tecnico' | 'controles';

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
  /** 2 a 4 letras (INF, TEC…) con las que empiezan los códigos de sus unidades: INF000001… */
  prefijo_codigo?: string;
  /** Referencia corta para personas: el prefijo y un número consecutivo (INF-001). Se asigna al crear el producto y no cambia. */
  referencia?: string | null;
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

/**
 * Cada unidad física tiene su propio código único (EAN-13, prefijo 21). Disponible = cuenta en el stock del local.
 * EN_TRANSITO: salió de un local en un traslado y aún no la recibe el otro. BAJA: retirada del inventario (dañada, usada, en garantía).
 */
export type EstadoUnidad = 'DISPONIBLE' | 'VENDIDA' | 'EN_TRANSITO' | 'BAJA';

export type MotivoBaja = 'DANADA' | 'USADA' | 'GARANTIA';
export const MOTIVOS_BAJA: { id: MotivoBaja; nombre: string; ayuda: string }[] = [
  { id: 'DANADA', nombre: 'Dañada', ayuda: 'Se rompió o no funciona.' },
  { id: 'USADA', nombre: 'Usada', ayuda: 'Se usó (de muestra, de prueba) y ya no se puede vender como nueva.' },
  { id: 'GARANTIA', nombre: 'En garantía', ayuda: 'Está en reclamo de garantía con el proveedor.' },
];

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
  /** Cuántas veces se volvió a imprimir su etiqueta después de la primera (se despegó, se perdió o salió mal) */
  reimpresiones?: number;
  ultima_reimpresion?: string | null;
  /** Solo cuando estado = BAJA */
  baja_motivo?: MotivoBaja | null;
  baja_nota?: string | null;
  baja_en?: string | null;
  baja_por?: string | null;
}

export type EstadoTraslado = 'EN_TRANSITO' | 'RECIBIDO' | 'ANULADO';

export interface TrasladoUnidad {
  codigo: string;
  producto_id: string;
  /** Nombre del producto tal como estaba al despachar */
  producto_nombre: string;
  recibida_en: string | null;
  /** Piezas que no llegaron y volvieron al local de origen al cerrar el traslado */
  devuelta_en: string | null;
}

/**
 * Un traslado de mercancía entre dos locales, en dos pasos: el origen DESPACHA (las piezas quedan EN_TRANSITO) y el destino RECIBE
 * (escaneando cada pieza). Lo que no llega se devuelve al origen al cerrar el traslado.
 */
export interface Traslado {
  id: string;
  folio: number;
  origen_local_id: string;
  destino_local_id: string;
  origen_nombre?: string | null;
  destino_nombre?: string | null;
  estado: EstadoTraslado;
  creado_en: string;
  enviado_por: string;
  recibido_en: string | null;
  recibido_por: string | null;
  cerrado_en: string | null;
  notas: string | null;
  unidades: TrasladoUnidad[];
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
  referencia?: string | null;
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
  /** Precio de catálogo al momento de la venta; solo se guarda en las ventas de promotor, donde `precio_unitario` (lo que pagó el cliente) es mayor */
  precio_lista?: number;
  /** Códigos de las unidades concretas que salieron (migración 0033); las ventas anteriores no lo traen */
  unidades?: string[];
  /** Solo al enviar la venta: cuáles de esas unidades se eligieron a mano (la etiqueta no se leía) y la autorización firmada de un supervisor */
  codigos_manuales?: string[];
  autorizacion_codigo?: string;
  /** Lo que queda guardado: los códigos elegidos a mano y quién lo autorizó (lo pone el servidor) */
  seleccion_manual?: { codigos: string[]; autorizado_por: string; autorizado_nombre: string };
}

export interface ClienteVenta {
  /** Con prefijo de nacionalidad, p. ej. "V-12345678" */
  cedula: string;
  nombre: string;
  /** Apellido por separado (para recordar al cliente); el nombre completo se guarda en la venta */
  apellido?: string;
  telefono: string;
}

/** Lo que el POS envía al registrar una venta (el folio lo asigna el sistema). */
/** Alta rápida de productos: lo mínimo de cada uno (el código de barras interno y el stock mínimo los pone el sistema). */
export interface FilaAltaRapida {
  nombre: string;
  categoria: string;
  precio_venta: number;
  /** Solo lo toman administrador y gerente; para el encargado queda en 0 */
  precio_compra?: number;
  /** 2 a 4 letras; vacío = el sistema lo sugiere por la marca o la categoría */
  prefijo_codigo?: string;
}

export interface ProductoCreadoRapido {
  id: string;
  nombre: string;
  codigo_barras: string;
  referencia?: string;
  prefijo_codigo?: string;
}

export interface NuevaVenta {
  fecha: string;
  /** Local donde se hizo la venta */
  local_id: string;
  cliente_cedula: string;
  cliente_nombre: string;
  /** Apellido por separado (para recordar al cliente: nombre y apellido en campos distintos); cliente_nombre sigue siendo el nombre completo */
  cliente_apellido?: string | null;
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
  /** Captura del comprobante del pago móvil (obligatoria si algún cobro es BS_PAGO_MOVIL): ruta en el almacenamiento privado, o una imagen data: en la demo */
  comprobante_path?: string | null;
  /** Referencia del pago móvil (exactamente 4 dígitos): respalda la venta en lugar de la captura, o además de ella (migración 0014) */
  referencia_pago_movil?: string | null;
  /** Venta con precio de promotor: los datos (opcionales) de quien la trajo. La comisión la calcula el servidor. */
  promotor?: DatosPromotor | null;
  /** Autorización firmada de un supervisor para vender a un precio distinto al del catálogo (se pide con `autorizarPrecio`) */
  autorizacion_precio?: string | null;
}

export interface Venta extends NuevaVenta {
  id: string;
  folio: number;
  vendedor_id?: string | null;
  /** Antes se elegía un empleado independiente; las ventas nuevas dejan esto en null */
  promotor_id?: string | null;
  /** Nombre y apellido del promotor, tal como los anotó quien vendió (opcional) */
  promotor_nombre?: string | null;
  promotor_cedula?: string | null;
  promotor_telefono?: string | null;
  /** Lo que se le paga al promotor: Σ cantidad × (precio cobrado − precio de lista). 0 si no hubo promotor. */
  comision?: number;
  precio_autorizado_por?: string | null;
  precio_autorizado_nombre?: string | null;
}

/** Respuesta de pedir la autorización de precio (supervisor + contraseña) */
export interface AutorizacionPrecio {
  token: string;
  /** Milisegundos desde 1970 en que deja de valer */
  vence_en: number;
  autorizado_por: string;
  promotor: string;
}

/** Respuesta de pedir la autorización para elegir a mano el código de las unidades de un producto */
export interface AutorizacionCodigo {
  token: string;
  vence_en: number;
  autorizado_por: string;
}

/** Lo que quien vende anota del promotor al cobrar con precio de promotor: todo es opcional (no es un usuario ni un empleado registrado) */
export interface DatosPromotor {
  cedula?: string | null;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
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

/** Lo que hizo (o haría, en una simulación) el reseteo de reportes: ventas, devoluciones y movimientos de compra/venta que se borran. */
export interface ResultadoReseteoReportes {
  ventas: number;
  devoluciones: number;
  movimientos: number;
  simulado: boolean;
}

/** Lo que hizo (o haría, en una simulación) el reseteo de ventas: cuántas se borran y cuántas piezas vuelven al stock. */
export interface ResultadoReseteoVentas {
  ventas: number;
  devoluciones: number;
  piezas: number;
  simulado: boolean;
}
