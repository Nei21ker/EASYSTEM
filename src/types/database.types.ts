// Tipos manuales que reflejan supabase/schema.sql.
// Si usas la CLI de Supabase, reemplaza este archivo con:
//   npx supabase gen types typescript --local > src/types/database.types.ts

export type TipoMovimiento = 'ENTRADA' | 'SALIDA';

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
  stock_actual: number;
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
}

/** Producto "enriquecido" con sus modelos compatibles, tal como lo consume el Dashboard */
export interface ProductoConRelaciones extends Producto {
  modelos_compatibles: ModeloTelefono[];
}

export interface ProductoStockBajo {
  id: string;
  codigo_barras: string;
  nombre: string;
  categoria: string;
  stock_actual: number;
  stock_minimo: number;
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
