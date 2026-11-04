import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { cambiarSuscripcionLocal } from '../../../../server/servicios/usuarios';

export const prerender = false;

const esquema = z.object({
  estado: z.enum(['ACTIVE', 'SUSPENDED', 'PAST_DUE']),
  vence: z.string().nullable().optional(),
  cambiarVencimiento: z.boolean().optional(),
});

/** Cambia el estado de la suscripción de un local (solo administrador). */
export const POST = conSesion(async ({ env, sesion, request, params }) => {
  const { estado, vence, cambiarVencimiento } = await leerJson(request, esquema);
  await cambiarSuscripcionLocal(env, sesion, params.localId as string, estado, vence ?? null, cambiarVencimiento ?? false);
  return { ok: true };
});
