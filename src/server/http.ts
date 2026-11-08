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

/** Huella corta del contenido (SHA-256 en base64url, 22 caracteres) para usarla de ETag. */
async function huella(texto: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}

/** ¿El If-None-Match de la petición incluye este ETag? (acepta varios valores y el prefijo débil W/) */
function coincideEtag(peticion: Request, etag: string): boolean {
  const pedido = peticion.headers.get('if-none-match');
  if (!pedido) return false;
  return pedido.split(',').some((v) => v.trim().replace(/^W\//, '') === etag);
}

/**
 * Lectura (GET) con ETag: el navegador guarda la respuesta y la revalida en cada uso (`no-cache`); si nada cambió el servidor
 * contesta 304 SIN cuerpo. En una red lenta, una lista que no cambió no se vuelve a descargar entera. La caché es `private`
 * (los datos dependen de la sesión) y `Vary: Cookie` evita mezclar usuarios.
 */
async function respuestaLectura(peticion: Request, datos: unknown): Promise<Response> {
  const cuerpo = JSON.stringify(datos ?? { ok: true });
  const etag = `"${await huella(cuerpo)}"`;
  const cabeceras = { etag, 'cache-control': 'private, no-cache', vary: 'Cookie' };
  if (coincideEtag(peticion, etag)) return new Response(null, { status: 304, headers: cabeceras });
  return new Response(cuerpo, { headers: { ...cabeceras, 'content-type': 'application/json' } });
}

export function conSesion(manejador: (contexto: Contexto) => Promise<unknown>): APIRoute {
  return async ({ request, params }) => {
    try {
      const entorno = env as unknown as Entorno;
      const sesion = await cargarSesion(entorno, request);
      // Clave temporal (la puso otra persona): hasta cambiarla no se atiende nada más que el cambio de clave
      if (sesion.debeCambiarClave && new URL(request.url).pathname !== '/api/cuenta/clave') {
        throw new ErrorApi(403, 'Debes cambiar tu contraseña temporal antes de continuar.', 'debe_cambiar_clave');
      }
      const resultado = await manejador({ env: entorno, sesion, request, params });
      if (resultado instanceof Response) return resultado;
      return request.method === 'GET' ? await respuestaLectura(request, resultado) : Response.json(resultado ?? { ok: true });
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
