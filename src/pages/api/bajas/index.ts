import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { darDeBaja } from '../../../server/servicios/traslados';

export const prerender = false;

const esquemaBaja = z.object({
  localId: z.string(),
  codigos: z.array(z.string()).max(500),
  motivo: z.enum(['DANADA', 'USADA', 'GARANTIA']),
  nota: z.string().max(300).optional(),
});

/** Retira piezas disponibles del local: salen del stock y quedan en BAJA (dañada, usada o en garantía). */
export const POST = conSesion(async ({ env, sesion, request }) => darDeBaja(env, sesion, await leerJson(request, esquemaBaja)));
