import { conSesion } from '../../../server/http';
import { limpiarPresencia, registrarLatido, type DatosLatido } from '../../../server/servicios/presencia';

export const prerender = false;

/**
 * Latido de presencia (cada 30 s desde una pestaña visible, y un aviso `{ "salir": true }` al cerrar sesión o la pestaña).
 * Cualquier rol con sesión. Responde 204 SIN cuerpo (lo más liviano posible) y nunca falla por un cuerpo vacío o raro: el
 * navegador lo manda con `navigator.sendBeacon`, que no lee la respuesta. De vez en cuando (≈2 % de los latidos) aprovecha
 * para borrar las filas de sesiones muertas.
 */
export const POST = conSesion(async ({ env, sesion, request }) => {
  let datos: DatosLatido = {};
  try {
    const cuerpo: unknown = await request.json();
    if (cuerpo && typeof cuerpo === 'object') datos = cuerpo as DatosLatido;
  } catch {
    // sin cuerpo o no es JSON: es un latido sin detalles
  }
  await registrarLatido(env, sesion, datos, { ip: request.headers.get('cf-connecting-ip'), userAgent: request.headers.get('user-agent') });
  if (Math.random() < 0.02) await limpiarPresencia(env).catch(() => undefined);
  return new Response(null, { status: 204 });
});
