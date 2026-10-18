import { supabase } from '../supabase';
import type { MovimientoInventario, TipoMovimiento } from '../../types/database.types';

export type MovimientoConProducto = MovimientoInventario & {
  producto?: { nombre: string; codigo_barras: string } | null;
  /** Nombre del local donde se movió el stock */
  local?: { nombre: string } | null;
};

export async function listarMovimientosRecientes(limite = 20, localId?: string | null): Promise<MovimientoConProducto[]> {
  let consulta = supabase
    .from('movimientos_inventario')
    .select('*, producto:productos(nombre, codigo_barras), local:locales(nombre)')
    .order('fecha', { ascending: false })
    .limit(limite);
  if (localId) consulta = consulta.eq('local_id', localId);

  const { data, error } = await consulta.overrideTypes<MovimientoConProducto[], { merge: false }>();
  if (error) throw error;
  return data ?? [];
}

export async function registrarMovimiento(input: {
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  local_id: string;
  motivo?: string;
}): Promise<MovimientoInventario> {
  // El stock del local (inventario_local) y el total (productos.stock_actual) los actualiza el trigger aplicar_movimiento_inventario
  const { data, error } = await supabase
    .from('movimientos_inventario')
    .insert(input)
    .select()
    .single()
    .overrideTypes<MovimientoInventario, { merge: false }>();

  if (error) throw error;
  return data as MovimientoInventario;
}

/** Inserta varios movimientos en lote (el trigger actualiza el stock fila por fila). */
export async function registrarMovimientosLote(
  filas: { producto_id: string; tipo: TipoMovimiento; cantidad: number; local_id: string; motivo?: string }[]
): Promise<void> {
  for (let i = 0; i < filas.length; i += 200) {
    const { error } = await supabase.from('movimientos_inventario').insert(filas.slice(i, i + 200));
    if (error) throw error;
  }
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
