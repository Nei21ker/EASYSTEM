import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { marcarUnidadesImpresas } from '../../../server/servicios/movimientos';

export const prerender = false;

/** Anota que ya se imprimieron las etiquetas de esas unidades. */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { codigos } = await leerJson(request, z.object({ codigos: z.array(z.string()).max(2000) }));
  return { marcadas: await marcarUnidadesImpresas(env, sesion, codigos) };
});
