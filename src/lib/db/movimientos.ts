import { api } from '../api';
import type { MovimientoInventario, TipoMovimiento } from '../../types/database.types';

export type MovimientoConProducto = MovimientoInventario & {
  producto?: { nombre: string; codigo_barras: string } | null;
  /** Nombre del local donde se movió el stock */
  local?: { nombre: string } | null;
};

// Topes del servidor por lote atómico: 50 movimientos y 500 unidades creadas (una unidad por cada una de una ENTRADA)
const MAX_MOVIMIENTOS_LOTE = 50;
const MAX_UNIDADES_LOTE = 500;

export async function listarMovimientosRecientes(limite = 20, localId?: string | null): Promise<MovimientoConProducto[]> {
  return api.get<MovimientoConProducto[]>('/api/movimientos', { limite, localId });
}

interface ResultadoMovimiento {
  movimiento: MovimientoInventario;
  unidadCodigos: string[];
}

export async function registrarMovimiento(input: {
  producto_id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  local_id: string;
  motivo?: string;
  /** Unidades concretas que se mueven (las escaneadas en una venta, las devueltas); el resto lo decide el servidor */
  unidad_codigos?: string[];
}): Promise<MovimientoInventario> {
  // El stock del local y el total los actualiza la base de datos en el mismo lote atómico del movimiento
  const r = await api.post<ResultadoMovimiento>('/api/movimientos', {
    productoId: input.producto_id,
    tipo: input.tipo,
    cantidad: input.cantidad,
    localId: input.local_id,
    motivo: input.motivo,
    unidadCodigos: input.unidad_codigos,
  });
  return { ...r.movimiento, unidad_codigos: r.unidadCodigos };
}

type FilaLote = { producto_id: string; tipo: TipoMovimiento; cantidad: number; local_id: string; motivo?: string };

/**
 * Registra varios movimientos en lotes atómicos (todo o nada dentro de cada lote). Un movimiento muy grande se parte
 * en varios de la misma suma, para respetar el tope de unidades por lote.
 */
export async function registrarMovimientosLote(filas: FilaLote[]): Promise<void> {
  const partidas: FilaLote[] = [];
  for (const fila of filas) {
    for (let restante = fila.cantidad; restante > 0; restante -= MAX_UNIDADES_LOTE) {
      partidas.push({ ...fila, cantidad: Math.min(restante, MAX_UNIDADES_LOTE) });
    }
  }

  let lote: FilaLote[] = [];
  let unidades = 0;
  const enviar = async () => {
    if (lote.length === 0) return;
    await api.post('/api/movimientos/lote', {
      movimientos: lote.map((f) => ({ productoId: f.producto_id, tipo: f.tipo, cantidad: f.cantidad, localId: f.local_id, motivo: f.motivo })),
    });
    lote = [];
    unidades = 0;
  };
  for (const partida of partidas) {
    if (lote.length >= MAX_MOVIMIENTOS_LOTE || unidades + partida.cantidad > MAX_UNIDADES_LOTE) await enviar();
    lote.push(partida);
    unidades += partida.cantidad;
  }
  await enviar();
}
