import { esquemaEspera } from '../../../server/esquemas';
import { conSesion, leerJson } from '../../../server/http';
import { crearEspera, listarEspera } from '../../../server/servicios/espera';

export const prerender = false;

/** Ventas en espera abiertas del local (con sus productos): el POS las muestra y reserva su stock. */
export const GET = conSesion(({ env, sesion, request }) => listarEspera(env, sesion, new URL(request.url).searchParams.get('localId') ?? undefined));

/** Deja el carrito en espera (Local Vidrios): queda como mercancía pendiente con sus productos, sin tocar el stock. */
export const POST = conSesion(async ({ env, sesion, request }) => crearEspera(env, sesion, await leerJson(request, esquemaEspera)));
