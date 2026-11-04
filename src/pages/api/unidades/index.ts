import { conSesion } from '../../../server/http';
import { listarUnidades } from '../../../server/servicios/movimientos';

export const prerender = false;

/**
 * Unidades con código único de los locales a los que el usuario accede.
 * Filtros: productoId, estado (DISPONIBLE|VENDIDA|EN_TRANSITO|BAJA), sinImprimir=1, localId, codigos=a,b,c (hasta 90).
 */
export const GET = conSesion(({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  const estado = q.get('estado');
  return listarUnidades(env, sesion, {
    productoId: q.get('productoId') ?? undefined,
    estado: estado === 'DISPONIBLE' || estado === 'VENDIDA' || estado === 'EN_TRANSITO' || estado === 'BAJA' ? estado : undefined,
    sinImprimir: q.get('sinImprimir') === '1',
    localId: q.get('localId') ?? undefined,
    codigos: q.get('codigos') ? q.get('codigos')!.split(',').filter(Boolean) : undefined,
  });
});
