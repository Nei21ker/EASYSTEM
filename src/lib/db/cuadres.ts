// Acceso al servidor del cuadre de caja diario. Solo lo usa inventoryService.ts.
// Las fotos van al almacenamiento PRIVADO: nunca hay URL pública; se piden por la API con la sesión del usuario.
import { api } from '../api';
import type { CuadreCaja, EsperadoCuadre, TipoFotoCuadre } from '../../types/database.types';

/** Los cuadres de un día (todos los locales que el usuario puede ver). */
export async function listarCuadresDelDia(fecha: string): Promise<CuadreCaja[]> {
  return api.get<CuadreCaja[]>('/api/cuadres', { fecha });
}

export async function obtenerCuadre(localId: string, fecha: string): Promise<CuadreCaja | null> {
  return (await api.get<{ cuadre: CuadreCaja | null }>(`/api/cuadres/${encodeURIComponent(localId)}/${fecha}`)).cuadre;
}

/** Lo que el sistema esperaba cobrar ese día en ese local: lo calcula el servidor con las ventas y devoluciones del día. */
export async function calcularEsperado(localId: string, fecha: string): Promise<EsperadoCuadre[]> {
  return api.get<EsperadoCuadre[]>(`/api/cuadres/${encodeURIComponent(localId)}/${fecha}/esperado`);
}

/** Guarda el borrador o cierra el cuadre (el servidor recalcula lo esperado y valida el cierre; uno cerrado no se toca). */
export async function guardarCuadre(
  localId: string,
  fecha: string,
  datos: { contado: CuadreCaja['contado']; fotos: CuadreCaja['fotos']; notas: string | null; cerrar: boolean }
): Promise<CuadreCaja> {
  return api.put<CuadreCaja>(`/api/cuadres/${encodeURIComponent(localId)}/${fecha}`, datos);
}

/** Reabre un cuadre cerrado (el servidor solo lo permite al administrador y al gerente). */
export async function reabrirCuadre(localId: string, fecha: string): Promise<CuadreCaja> {
  return api.post<CuadreCaja>(`/api/cuadres/${encodeURIComponent(localId)}/${fecha}/reabrir`);
}

/** Sube una foto ("cuadres-caja/<local>/<día>/<TIPO>-<hora>-<n>.jpg") y devuelve su ruta. */
export async function subirFoto(localId: string, fecha: string, tipo: TipoFotoCuadre, imagen: Blob): Promise<string> {
  const ruta = `cuadres-caja/${localId}/${fecha}/${tipo}-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;
  return api.subir(`/api/archivos/privado/${ruta}`, imagen, 'image/jpeg');
}

/** Borra fotos (best-effort: una foto huérfana no afecta al cuadre). */
export async function borrarFotos(rutas: string[]): Promise<void> {
  await Promise.allSettled(rutas.map((ruta) => api.delete(`/api/archivos/privado/${ruta}`)));
}

/** Dirección para ver una foto: pasa por la API, que exige la sesión y el acceso al cuadre de ese local. */
export async function urlFirmada(ruta: string): Promise<string> {
  return `/api/archivos/privado/${ruta}`;
}
