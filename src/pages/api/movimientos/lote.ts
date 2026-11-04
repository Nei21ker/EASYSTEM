import { z } from 'zod';
import { conSesion, leerJson } from '../../../server/http';
import { esquemaMovimiento } from '../../../server/esquemas';
import { registrarMovimientos } from '../../../server/servicios/movimientos';

export const prerender = false;

/** Registra hasta 50 movimientos en un lote atómico (todo o nada). */
export const POST = conSesion(async ({ env, sesion, request }) => {
  const { movimientos } = await leerJson(request, z.object({ movimientos: z.array(esquemaMovimiento) }));
  return registrarMovimientos(env, sesion, movimientos);
});
