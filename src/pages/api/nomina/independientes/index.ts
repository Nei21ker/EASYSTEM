import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { guardarPagoIndependiente } from '../../../../server/servicios/nomina';

export const prerender = false;

const esquema = z.object({
  empleadoId: z.string(),
  dia: z.string(),
  lineas: z.array(
    z.object({
      producto_id: z.string().nullable(),
      producto_nombre: z.string(),
      producto_codigo: z.string().nullable(),
      cantidad: z.number(),
      precio_lista: z.number(),
      precio_vendido: z.number(),
    })
  ),
  bonos: z.number(),
  deducciones: z.number(),
  notas: z.string().nullable(),
  comprobantePath: z.string().nullable().optional(),
  quitarComprobante: z.boolean().optional(),
  pagar: z.boolean(),
});

/** Guarda el día de un trabajador independiente (lista de reventa + pago). Devuelve el id del pago. */
export const POST = conSesion(async ({ env, sesion, request }) => ({ id: await guardarPagoIndependiente(env, sesion, await leerJson(request, esquema)) }));
