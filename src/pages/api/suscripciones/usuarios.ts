import { conSesion } from '../../../server/http';
import { listarUsuariosSistema } from '../../../server/servicios/usuarios';

export const prerender = false;

/** Todos los usuarios con su local y suscripción (panel de suscripciones, solo administrador). */
export const GET = conSesion(({ env, sesion }) => listarUsuariosSistema(env, sesion));
