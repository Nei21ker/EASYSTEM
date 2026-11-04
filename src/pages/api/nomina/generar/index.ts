import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { generarPagosPendientes } from '../../../../server/servicios/nomina';

export const prerender = false;

const esquema = z.object({ periodo: z.object({ inicio: z.string(), fin: z.string() }), localId: z.string().optional() });

/** Crea el pago pendiente de la quincena de cada empleado fijo activo que aún no lo tiene. */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { periodo, localId } = await leerJson(request, esquema);
  return generarPagosPendientes(env, sesion, periodo, localId);
});
