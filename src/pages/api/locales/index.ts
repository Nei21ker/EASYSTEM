import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { listarLocalesVisibles } from '../../../server/servicios/catalogo';
import { crearLocal } from '../../../server/servicios/locales';

export const prerender = false;

const esquemaLocal = z.object({
  nombre: z.string().min(1).max(100),
  tipo: z.enum(['accesorios', 'vidrios', 'servicio_tecnico', 'controles']),
  sede: z.string().max(100).nullable().optional(),
  direccion: z.string().max(200).nullable().optional(),
  telefono: z.string().max(60).nullable().optional(),
});

/** Locales que el usuario puede ver (administrador, gerente y contador: todos; el resto, el suyo). */
export const GET = conSesion(({ env, sesion }) => listarLocalesVisibles(env, sesion));

/** Agrega un local nuevo (solo administrador). */
export const POST = conSesion(async ({ env, sesion, request }) => crearLocal(env, sesion, await leerJson(request, esquemaLocal)));
