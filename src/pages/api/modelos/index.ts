import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { crearModelo, listarModelos } from '../../../server/servicios/catalogo';

export const prerender = false;

export const GET = conSesion(({ env, sesion }) => listarModelos(env, sesion));

export const POST = conSesion(async ({ env, sesion, request }) =>
  crearModelo(env, sesion, await leerJson(request, z.object({ marca: z.string(), modelo: z.string() })))
);
