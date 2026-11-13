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
  control_por_cantidad: z.number().int().min(0).max(1).optional(),
  moneda_precio: z.enum(['USD', 'BS']).optional(),
  precio_bs: z.number().nullable().optional(),
});

export const esquemaProductoRapido = z.object({
  nombre: z.string(),
  categoria: z.string(),
  precio_venta: z.number(),
  moneda_precio: z.enum(['USD', 'BS']).optional(),
  precio_bs: z.number().nullable().optional(),
  precio_compra: z.number().optional(),
  prefijo_codigo: z.string().optional(),
  control_por_cantidad: z.number().int().min(0).max(1).optional(),
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
  precio_lista: z.number().optional(),
  instalacion_por: z.enum(['LOCAL', 'PROMOTOR']).optional(),
  instalacion_usd: z.number().positive().max(100).optional(),
  unidades: z.array(z.string()).optional(),
  codigos_manuales: z.array(z.string()).max(500).optional(),
  autorizacion_codigo: z.string().max(2000).optional(),
  danados: z.number().int().min(0).max(500).optional(),
  danados_motivo: z.enum(['DEFECTO_FABRICA', 'DANADO_AL_COLOCAR', 'OTRO']).nullable().optional(),
  danados_nota: z.string().max(300).nullable().optional(),
  autorizacion_danados: z.string().max(2000).optional(),
  movimiento_id: z.string().max(100).optional(),
  movimiento_baja_id: z.string().max(100).optional(),
});

/** Pedido de autorización para elegir a mano el código de una unidad: un supervisor teclea su correo y contraseña */
export const esquemaAutorizarCodigo = z.object({
  email: z.string().min(3).max(200).optional(),
  clave: z.string().min(1).max(200),
  local_id: z.string(),
  producto_id: z.string(),
});
/** Datos opcionales del promotor (el formato se valida en `normalizarPromotor`) */
export const esquemaPromotor = z.object({
  cedula: z.string().max(30).nullable().optional(),
  nombre: z.string().max(80).nullable().optional(),
  apellido: z.string().max(80).nullable().optional(),
  telefono: z.string().max(30).nullable().optional(),
  banco: z.string().max(80).nullable().optional(),
});
/** Alta/edición de un promotor del directorio (cédula, nombre y apellido obligatorios; el formato se valida en `normalizarPromotor`) */
export const esquemaNuevoPromotor = z.object({
  cedula: z.string().min(1).max(30),
  nombre: z.string().min(1).max(80),
  apellido: z.string().min(1).max(80),
  telefono: z.string().max(30).nullable().optional(),
  banco: z.string().max(80).nullable().optional(),
  local_id: z.string().max(64).nullable().optional(),
});
export const esquemaPendienteMercancia = z.object({
  localId: z.string(),
  promotorId: z.string().min(1).max(100),
  descripcion: z.string().max(500),
  items: z.array(z.object({ producto_id: z.string().min(1).max(100), cantidad: z.number().int() })).max(50).optional(),
  monto_usd: z.number(),
});
/** Venta en espera (Local Vidrios): el carrito que se deja guardado mientras el promotor vuelve a pagar */
export const esquemaEspera = z.object({
  localId: z.string().min(1).max(100),
  items: z.array(z.object({ producto_id: z.string().min(1).max(100), cantidad: z.number().int() })).min(1).max(50),
  promotor_nombre: z.string().max(80).nullable().optional(),
  nota: z.string().max(200).nullable().optional(),
});
/** Cambio de mercancía con otro local (Local Vidrios): lo que sale, lo que entra y, si hace falta, el lado que queda en espera */
export const esquemaIntercambio = z.object({
  localId: z.string().min(1).max(100),
  contraparte: z.string().min(1).max(80),
  nota: z.string().max(300).nullable().optional(),
  salen: z.array(z.object({ producto_id: z.string().min(1).max(100), cantidad: z.number().int(), unidades: z.array(z.string().max(30)).max(500).optional() })).max(25),
  entran: z.array(z.object({ producto_id: z.string().min(1).max(100), cantidad: z.number().int() })).max(25),
  lado_pendiente: z.enum(['SALEN', 'ENTRAN']).nullable().optional(),
});
export const esquemaCerrarPendiente = z.object({
  /** "pagar" = el promotor pagó la mercancía / se le pagó la comisión; "anular" = se creó por error */
  accion: z.enum(['pagar', 'anular']),
  nota: z.string().max(300).nullable().optional(),
});
export const esquemaPagarComisiones = z.object({
  /** Las comisiones que la pantalla muestra en la tarjeta del promotor (así no se paga una que apareció después) */
  ids: z.array(z.string().min(1).max(100)).min(1).max(200),
  nota: z.string().max(300).nullable().optional(),
});
export const esquemaAsignarPromotor = z.object({ promotorId: z.string().min(1).max(100) });
export const esquemaPago = z.object({ metodo, monto_usd: z.number(), monto_bs: z.number().nullable(), monto_bs_debido: z.number().nullable().optional() });
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
  comprobante_path: z.string().max(300).nullable().optional(),
  referencia_pago_movil: z.string().regex(/^\d{4}$/, 'La referencia debe tener exactamente 4 dígitos.').nullable().optional(),
  promotor: esquemaPromotor.nullable().optional(),
  /** Venta en espera que esta venta cobra (se cierra en el mismo lote, sin mover el stock otra vez) */
  espera_id: z.string().max(100).nullable().optional(),
  autorizacion_precio: z.string().max(2000).nullable().optional(),
});

/** Pedido de autorización de precio: un supervisor teclea su correo y contraseña en el equipo de quien vende */
export const esquemaAutorizarPrecio = z.object({
  email: z.string().min(3).max(200).optional(),
  /** Obligatoria salvo en el precio de promotor con precios mayores al catálogo (ahí no se pide contraseña) */
  clave: z.string().max(200).optional(),
  local_id: z.string(),
  promotor: esquemaPromotor.nullable().optional(),
  /** "promotor" (por defecto, clientes anteriores) o "local": la tienda cambia el precio, sin promotor ni comisión */
  modo: z.enum(['promotor', 'local']).optional(),
  lineas: z.array(z.object({ producto_id: z.string(), precio: z.number() })).min(1).max(100),
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

const motivoMerma = z.enum(['DEFECTO_FABRICA', 'DANADO_AL_COLOCAR', 'OTRO']);
/** Pedido de autorización para botar 3 o más piezas defectuosas en una venta: un gerente o administrador teclea su contraseña */
export const esquemaAutorizarDanados = z.object({
  email: z.string().min(3).max(200).optional(),
  clave: z.string().min(1).max(200),
  local_id: z.string(),
  cantidad: z.number(),
});
/** Una línea de venta de un producto por cantidad con piezas defectuosas (salida + baja en un lote) */
export const esquemaSalidaConMerma = z.object({
  productoId: z.string(),
  localId: z.string(),
  cantidad: z.number(),
  danados: z.number(),
  danadosVenta: z.number().optional(),
  motivo: motivoMerma.nullable().optional(),
  nota: z.string().max(300).nullable().optional(),
  autorizacion: z.string().max(2000).optional(),
});
/** Bota piezas de un producto por cantidad (Descargo) */
export const esquemaBajaPorCantidad = z.object({
  productoId: z.string(),
  localId: z.string(),
  cantidad: z.number(),
  motivo: motivoMerma.nullable().optional(),
  nota: z.string().max(300).nullable().optional(),
});

// Módulo de Inversión (administrador y gerente): compras de mercancía nueva y pérdidas, anotadas a mano, y la lista de proveedores
export const esquemaInversion = z.object({
  localId: z.string().min(1).max(100),
  tipo: z.enum(['COMPRA', 'PERDIDA']),
  fecha: z.string().min(1).max(10),
  descripcion: z.string().min(1).max(300),
  proveedor: z.string().max(80).nullable().optional(),
  monto_usd: z.number(),
});
export const esquemaProveedor = z.object({
  nombre: z.string().min(1).max(80),
  telefono: z.string().max(30).nullable().optional(),
  nota: z.string().max(300).nullable().optional(),
});
