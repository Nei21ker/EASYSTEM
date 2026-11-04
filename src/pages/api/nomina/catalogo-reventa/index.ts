import { conSesion } from '../../../../server/http';
import { catalogoReventa } from '../../../../server/servicios/nomina';

export const prerender = false;

/** Búsqueda mínima de productos para armar la lista (sin costos ni stock). */
export const GET = conSesion(({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  return catalogoReventa(env, sesion, q.get('q') ?? '', q.get('limite') ? Number(q.get('limite')) : undefined);
});
