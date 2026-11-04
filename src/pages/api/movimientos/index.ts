import { conSesion, leerJson } from '../../../server/http';
import { esquemaMovimiento } from '../../../server/esquemas';
import { listarMovimientos, registrarMovimiento } from '../../../server/servicios/movimientos';

export const prerender = false;

/** Movimientos recientes (más nuevos primero) de los locales a los que el usuario accede. */
export const GET = conSesion(({ env, sesion, request }) =>
  listarMovimientos(env, sesion, Number(new URL(request.url).searchParams.get('limite') ?? 100))
);

/** Registra UN movimiento; devuelve el movimiento y todos los códigos de unidad que movió. */
export const POST = conSesion(async ({ env, sesion, request }) => registrarMovimiento(env, sesion, await leerJson(request, esquemaMovimiento)));
