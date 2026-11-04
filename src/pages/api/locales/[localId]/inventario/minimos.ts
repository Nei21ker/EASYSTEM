import { z } from 'zod';
import { conSesion, leerJson } from '../../../../../server/http';
import { fijarMinimosLote } from '../../../../../server/servicios/catalogo';

export const prerender = false;

/** Fija el stock mínimo de varios productos en un local (el stock en sí nunca se escribe aquí). */
export const POST = conSesion(async ({ env, sesion, request, params }) => {
  const { filas } = await leerJson(request, z.object({ filas: z.array(z.object({ producto_id: z.string(), stock_minimo: z.number() })) }));
  await fijarMinimosLote(env, sesion, params.localId as string, filas);
  return { ok: true };
});
