import { conSesion, leerJson } from '../../../server/http';
import { esquemaIntercambio } from '../../../server/esquemas';
import { crearIntercambio, listarIntercambios } from '../../../server/servicios/intercambios';
import type { EstadoIntercambio } from '../../../types/database.types';

export const prerender = false;

/** Cambios de mercancía del local (administrador, gerente y encargado). Filtros: desde, hasta (aaaa-mm-dd), estado, local. */
export const GET = conSesion(({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  const estado = q.get('estado');
  return listarIntercambios(env, sesion, {
    desde: q.get('desde') || undefined,
    hasta: q.get('hasta') || undefined,
    localId: q.get('local') || undefined,
    estado: estado === 'COMPLETADO' || estado === 'EN_ESPERA' || estado === 'ANULADO' ? (estado as EstadoIntercambio) : undefined,
  });
});

/** Anota un cambio (Local Vidrios): mueve lo que sale y lo que entra, o deja uno de los dos lados en espera. */
export const POST = conSesion(async ({ env, sesion, request }) => crearIntercambio(env, sesion, await leerJson(request, esquemaIntercambio)));
