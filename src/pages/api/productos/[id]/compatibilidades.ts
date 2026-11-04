import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { establecerCompatibilidades } from '../../../../server/servicios/catalogo';

export const prerender = false;

/** Reemplaza los modelos compatibles de un producto. */
export const PUT = conSesion(async ({ env, sesion, request, params }) => {
  const { modeloIds } = await leerJson(request, z.object({ modeloIds: z.array(z.string()) }));
  await establecerCompatibilidades(env, sesion, params.id as string, modeloIds);
  return { ok: true };
});
