import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { marcarUnidadesImpresas } from '../../../server/servicios/movimientos';

export const prerender = false;

/** Anota que ya se imprimieron las etiquetas de esas unidades (o, con `reimpresion`, que se volvieron a imprimir). */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { codigos, reimpresion } = await leerJson(request, z.object({ codigos: z.array(z.string()).max(2000), reimpresion: z.boolean().optional() }));
  return { marcadas: await marcarUnidadesImpresas(env, sesion, codigos, { reimpresion }) };
});
