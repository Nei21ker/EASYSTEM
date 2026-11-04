// Acceso al servidor de las unidades con código único. Solo lo usa inventoryService.ts.
// Las unidades se LEEN según el local de cada usuario y NUNCA se escriben desde aquí: cambian por los movimientos
// de inventario. Lo único que se llama aparte es marcar etiquetas impresas.
import { api } from '../api';
import type { EstadoUnidad, UnidadProducto } from '../../types/database.types';

// Topes del servidor: 90 códigos por consulta y 2000 por aviso de impresión
const CODIGOS_POR_CONSULTA = 90;
const CODIGOS_POR_AVISO = 2000;

export interface FiltroUnidades {
  productoId?: string;
  localId?: string | null;
  estado?: EstadoUnidad;
  sinImprimir?: boolean;
  codigos?: string[];
}

/** Unidades que cumplen el filtro (más antiguas primero). Si se piden códigos concretos se consultan por tandas de 90. */
export async function listarUnidades(filtro: FiltroUnidades = {}): Promise<UnidadProducto[]> {
  const consulta = (codigos?: string[]) =>
    api.get<UnidadProducto[]>('/api/unidades', {
      productoId: filtro.productoId,
      localId: filtro.localId,
      estado: filtro.estado,
      sinImprimir: filtro.sinImprimir ? 1 : undefined,
      codigos: codigos?.join(','),
    });

  if (!filtro.codigos) return consulta();
  const todas: UnidadProducto[] = [];
  for (let i = 0; i < filtro.codigos.length; i += CODIGOS_POR_CONSULTA) {
    todas.push(...(await consulta(filtro.codigos.slice(i, i + CODIGOS_POR_CONSULTA))));
  }
  return todas;
}

export async function obtenerUnidadPorCodigo(codigo: string): Promise<UnidadProducto | null> {
  return (await api.get<{ unidad: UnidadProducto | null }>(`/api/unidades/${encodeURIComponent(codigo)}`)).unidad;
}

/** Anota que ya se imprimió la etiqueta de esas unidades (o, con `reimpresion`, que se volvió a imprimir). */
export async function marcarImpresas(codigos: string[], reimpresion = false): Promise<void> {
  for (let i = 0; i < codigos.length; i += CODIGOS_POR_AVISO) {
    await api.post('/api/unidades/impresas', { codigos: codigos.slice(i, i + CODIGOS_POR_AVISO), ...(reimpresion ? { reimpresion: true } : {}) });
  }
}
