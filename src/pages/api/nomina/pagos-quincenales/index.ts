import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { guardarPagoQuincenal } from '../../../../server/servicios/nomina';

export const prerender = false;

const esquema = z.object({
  empleadoId: z.string(),
  periodo: z.object({ inicio: z.string(), fin: z.string() }),
  bonos: z.number(),
  deducciones: z.number(),
  notas: z.string().nullable().optional(),
  comprobantePath: z.string().nullable().optional(),
  quitarComprobante: z.boolean().optional(),
  pagar: z.boolean(),
});

/** Guarda el pago de una quincena (pendiente o pagado). */
export const POST = conSesion(async ({ env, sesion, request }) => guardarPagoQuincenal(env, sesion, await leerJson(request, esquema)));
