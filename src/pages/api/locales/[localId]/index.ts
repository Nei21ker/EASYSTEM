import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { actualizarLocal } from '../../../../server/servicios/locales';

export const prerender = false;

const esquemaLocal = z.object({
  nombre: z.string().min(1).max(100),
  tipo: z.enum(['accesorios', 'vidrios', 'servicio_tecnico', 'controles']),
  sede: z.string().max(100).nullable().optional(),
  direccion: z.string().max(200).nullable().optional(),
  telefono: z.string().max(60).nullable().optional(),
});

/** Edita nombre, tipo, sede, dirección y teléfono de un local (solo administrador). */
export const PATCH = conSesion(async ({ env, sesion, request, params }) => actualizarLocal(env, sesion, params.localId as string, await leerJson(request, esquemaLocal)));
