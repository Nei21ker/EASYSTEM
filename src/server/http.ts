// Envoltorio de las rutas de /api: carga la sesión, ejecuta el manejador y responde JSON.
// TODA ruta (salvo la lista blanca de la tarea 23) debe construirse con `conSesion`.
import type { APIRoute } from 'astro';
import type { z } from 'zod';
import { env } from 'cloudflare:workers';
import { cargarSesion, type Sesion } from './authz';
import type { Entorno } from './entorno';
import { ErrorApi } from './errores';

export interface Contexto {
  env: Entorno;
  sesion: Sesion;
  request: Request;
  params: Record<string, string | undefined>;
}

/** Convierte cualquier error en la respuesta JSON `{ error, codigo }`; los inesperados no filtran detalles internos. */
export function respuestaError(err: unknown): Response {
  if (err instanceof ErrorApi) return Response.json({ error: err.message, codigo: err.codigo }, { status: err.status });
  console.error('[EASYSTEM] Error inesperado en la API:', err);
  return Response.json({ error: 'Ocurrió un error inesperado. Inténtalo de nuevo.', codigo: 'error_interno' }, { status: 500 });
}

export function conSesion(manejador: (contexto: Contexto) => Promise<unknown>): APIRoute {
  return async ({ request, params }) => {
    try {
      const entorno = env as unknown as Entorno;
      const sesion = await cargarSesion(entorno, request);
      const resultado = await manejador({ env: entorno, sesion, request, params });
      return resultado instanceof Response ? resultado : Response.json(resultado ?? { ok: true });
    } catch (err) {
      return respuestaError(err);
    }
  };
}

/** Lee el cuerpo JSON de la petición y lo valida con zod (400 con el campo que falló). */
export async function leerJson<T extends z.ZodType>(request: Request, esquema: T): Promise<z.infer<T>> {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    throw new ErrorApi(400, 'La petición no trae datos válidos.', 'json_invalido');
  }
  const resultado = esquema.safeParse(cuerpo);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`).join('; ');
    throw new ErrorApi(400, `Datos inválidos: ${detalle}`, 'datos_invalidos');
  }
  return resultado.data;
}
