import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { obtenerUltimaTasa, registrarTasa } from '../../../server/servicios/tasas';

export const prerender = false;

/** La tasa vigente (la última registrada); `{ tasa: null }` si todavía no hay ninguna. */
export const GET = conSesion(async ({ env, sesion }) => ({ tasa: await obtenerUltimaTasa(env, sesion) }));

export const POST = conSesion(async ({ env, sesion, request }) =>
  registrarTasa(env, sesion, await leerJson(request, z.object({ fecha: z.string(), tasa: z.number(), registrado_nombre: z.string().nullable().optional() })))
);
