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
});
