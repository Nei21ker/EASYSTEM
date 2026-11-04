import { conSesion } from '../../../server/http';
import { listarStockBajo } from '../../../server/servicios/catalogo';

export const prerender = false;

/** Alertas de reabastecimiento (una fila por producto y local); `?localId=` restringe a un local. */
export const GET = conSesion(({ env, sesion, request }) =>
  listarStockBajo(env, sesion, new URL(request.url).searchParams.get('localId') ?? undefined)
);
