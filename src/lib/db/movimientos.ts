import { supabase } from '../supabase';
import type { MovimientoInventario, TipoMovimiento } from '../../types/database.types';

export type MovimientoConProducto = MovimientoInventario & {
  producto?: { nombre: string; codigo_barras: string } | null;
};

export async function listarMovimientosRecientes(limite = 20): Promise<MovimientoConProducto[]> {
  const { data, error } = await supabase
    .from('movimientos_inventario')
    .select('*, producto:productos(nombre, codigo_barras)')
    .order('fecha', { ascending: false })
    .limit(limite)
    .overrideTypes<MovimientoConProducto[], { merge: false }>();

  if (error) throw error;
  return data ?? [];
}

export async function registrarMovimiento(input: {
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo?: string;
}): Promise<MovimientoInventario> {
  // productos.stock_actual lo actualiza el trigger aplicar_movimiento_inventario
  const { data, error } = await supabase
    .from('movimientos_inventario')
    .insert(input)
    .select()
    .single()
    .overrideTypes<MovimientoInventario, { merge: false }>();

  if (error) throw error;
  return data as MovimientoInventario;
}

/** Suscripción realtime: notifica cambios de stock para refrescar el Dashboard */
export function suscribirseAMovimientos(onCambio: (payload: unknown) => void) {
  const canal = supabase
    .channel('movimientos_inventario-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'movimientos_inventario' }, onCambio)
    .subscribe();

  return () => {
    supabase.removeChannel(canal);
  };
}
