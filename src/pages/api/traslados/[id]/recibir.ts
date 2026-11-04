import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { recibirTraslado } from '../../../../server/servicios/traslados';

export const prerender = false;

/** El local de destino recibe las piezas escaneadas (todas o parte): pasan a DISPONIBLES en su stock. */
export const POST = conSesion(async ({ env, sesion, request, params }) => {
  const { codigos } = await leerJson(request, z.object({ codigos: z.array(z.string()).max(500) }));
  return recibirTraslado(env, sesion, decodeURIComponent(params.id as string), codigos);
});
