import { esquemaDevolucion } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { guardarDevolucion, listarDevoluciones } from '../../../server/servicios/ventas';

export const prerender = false;

/** Devoluciones: `?ventaId=`, `?limite=`, `?localId=`. */
export const GET = conSesion(({ env, sesion, request }) => {
  const q = new URL(request.url).searchParams;
  return listarDevoluciones(env, sesion, {
    ventaId: q.get('ventaId') ?? undefined,
    limite: q.get('limite') ? Number(q.get('limite')) : undefined,
    localId: q.get('localId') ?? undefined,
  });
});

/** Registra una devolución o cambio (solo administrador, gerente y encargado). */
export const POST = conSesion(async ({ env, sesion, request }) => guardarDevolucion(env, sesion, (await leerJson(request, esquemaDevolucion)) as never));
