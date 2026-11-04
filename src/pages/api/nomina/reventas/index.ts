import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { listarReventas } from '../../../../server/servicios/nomina';

export const prerender = false;

const esquema = z.object({ nominaIds: z.array(z.string()).max(500) });

/** Listas de reventa de varios pagos (POST porque son muchos ids). */
export const POST = conSesion(async ({ env, sesion, request }) => listarReventas(env, sesion, (await leerJson(request, esquema)).nominaIds));
