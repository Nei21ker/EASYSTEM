import { esquemaBajaPorCantidad } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { darDeBajaPorCantidad, listarMermas } from '../../../server/servicios/mermas';

export const prerender = false;

/** Pérdidas de productos por cantidad (más recientes primero). Administrador, gerente y encargado, dentro de su alcance. */
export const GET = conSesion(({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  return listarMermas(env, sesion, {
    desde: q.get('desde') ?? undefined,
    hasta: q.get('hasta') ?? undefined,
    localId: q.get('localId') ?? undefined,
    limite: q.get('limite') ? Number(q.get('limite')) : undefined,
  });
});

/** Bota piezas de un producto por cantidad sin venta (Mercancía → Descargo). */
export const POST = conSesion(async ({ env, sesion, request }) => darDeBajaPorCantidad(env, sesion, await leerJson(request, esquemaBajaPorCantidad)));
