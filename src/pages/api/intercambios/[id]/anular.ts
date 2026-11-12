import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { anularIntercambio } from '../../../../server/servicios/intercambios';

export const prerender = false;

const esquema = z.object({ nota: z.string().max(300).nullable().optional() });

/** Revierte el cambio (devuelve lo entregado y saca lo recibido). Solo administrador y gerente. */
export const POST = conSesion(async ({ env, sesion, params, request }) => {
  const datos = await leerJson(request, esquema);
  return anularIntercambio(env, sesion, params.id as string, datos.nota);
});
