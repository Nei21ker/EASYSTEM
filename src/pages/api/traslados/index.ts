import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { despacharTraslado, listarTraslados } from '../../../server/servicios/traslados';

export const prerender = false;

const esquemaDespacho = z.object({
  origenLocalId: z.string(),
  destinoLocalId: z.string(),
  codigos: z.array(z.string()).max(500),
  notas: z.string().max(300).optional(),
});

/** Traslados donde el local del usuario es origen o destino (administrador y gerente: todos). Filtro: estado. */
export const GET = conSesion(({ env, sesion, request }) => {
  const estado = new URL(request.url).searchParams.get('estado');
  return listarTraslados(env, sesion, { estado: estado === 'EN_TRANSITO' || estado === 'RECIBIDO' || estado === 'ANULADO' ? estado : undefined });
});

/** El local de origen despacha: las piezas quedan EN_TRANSITO hasta que el destino las reciba. */
export const POST = conSesion(async ({ env, sesion, request }) => despacharTraslado(env, sesion, await leerJson(request, esquemaDespacho)));
