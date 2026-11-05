// Esquemas zod compartidos por varias rutas de /api.
import { z } from 'zod';

export const esquemaProducto = z.object({
  codigo_barras: z.string(),
  nombre: z.string(),
  categoria: z.string(),
  precio_compra: z.number().optional(),
  precio_venta: z.number().optional(),
  stock_minimo: z.number().optional(),
  imagen_url: z.string().nullable().optional(),
  prefijo_codigo: z.string().optional(),
});

export const esquemaMovimiento = z.object({
  productoId: z.string(),
  tipo: z.enum(['ENTRADA', 'SALIDA']),
  cantidad: z.number(),
  localId: z.string(),
  motivo: z.string().max(200).optional(),
  unidadCodigos: z.array(z.string()).optional(),
});

const metodo = z.enum(['BS_PAGO_MOVIL', 'BS_PUNTO_VENTA', 'BS_EFECTIVO', 'USD_EFECTIVO', 'BINANCE_USDT']);
export const esquemaItemVenta = z.object({
  producto_id: z.string(),
  nombre: z.string(),
  codigo_barras: z.string(),
  cantidad: z.number(),
  precio_unitario: z.number(),
  unidades: z.array(z.string()).optional(),
});
export const esquemaPago = z.object({ metodo, monto_usd: z.number(), monto_bs: z.number().nullable() });
export const esquemaDinero = z.object({ metodo, monto_usd: z.number(), monto_bs: z.number().nullable() });

export const esquemaVenta = z.object({
  fecha: z.string(),
  local_id: z.string(),
  cliente_cedula: z.string(),
  cliente_nombre: z.string(),
  cliente_apellido: z.string().nullable().optional(),
  cliente_telefono: z.string(),
  metodo_pago: z.string(),
  pagos: z.array(esquemaPago).nullable().optional(),
  vuelto: esquemaDinero.nullable().optional(),
  total: z.number(),
  items: z.array(esquemaItemVenta),
  vendedor_nombre: z.string().nullable().optional(),
  tasa_cambio: z.number().nullable().optional(),
  total_bs: z.number().nullable().optional(),
});

export const esquemaDevolucion = z.object({
  fecha: z.string(),
  local_id: z.string(),
  venta_id: z.string(),
  venta_folio: z.number(),
  motivo: z.string(),
  items_devueltos: z.array(esquemaItemVenta),
  items_nuevos: z.array(esquemaItemVenta),
  total_devuelto: z.number(),
  total_nuevo: z.number(),
  diferencia: z.number(),
  tasa_cambio: z.number().nullable().optional(),
  pagos: z.array(esquemaPago).nullable().optional(),
  vuelto: esquemaDinero.nullable().optional(),
  reembolso: esquemaDinero.nullable().optional(),
  registrado_nombre: z.string().nullable().optional(),
});
