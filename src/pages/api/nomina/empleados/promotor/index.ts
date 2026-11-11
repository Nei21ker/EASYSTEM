import { z } from 'zod';
import { conSesion, leerJson } from '../../../../../server/http';
import { asegurarEmpleadoPromotor } from '../../../../../server/servicios/nomina';

export const prerender = false;

const esquema = z.object({ promotorId: z.string().min(1), localId: z.string().min(1) });

/** La fila de nómina de un promotor del directorio (la crea si aún no existe) para poder armarle la lista y pagarle el día. */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { promotorId, localId } = await leerJson(request, esquema);
  return asegurarEmpleadoPromotor(env, sesion, promotorId, localId);
});
