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
