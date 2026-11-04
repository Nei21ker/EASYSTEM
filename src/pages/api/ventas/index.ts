import { esquemaVenta } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { guardarVenta, listarVentas } from '../../../server/servicios/ventas';

export const prerender = false;

/** Historial de ventas: `?desde=&hasta=` (ISO), `?limite=`, `?localId=`. El vendedor solo recibe las suyas. */
export const GET = conSesion(({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  return listarVentas(env, sesion, {
    desde: q.get('desde') ?? undefined,
    hasta: q.get('hasta') ?? undefined,
    limite: q.get('limite') ? Number(q.get('limite')) : undefined,
    localId: q.get('localId') ?? undefined,
  });
});

/** Guarda el registro de una venta (el folio y el vendedor los pone el servidor). */
export const POST = conSesion(async ({ env, sesion, request }) => guardarVenta(env, sesion, (await leerJson(request, esquemaVenta)) as never));
