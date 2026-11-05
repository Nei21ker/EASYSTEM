import { conSesion } from '../../../server/http';
import { listarUsuariosActivos } from '../../../server/servicios/presencia';

export const prerender = false;

/** Quién está conectado ahora y cómo (pantalla "Tiempo real"; SOLO el administrador: cualquier otro rol recibe 403). */
export const GET = conSesion(({ env, sesion }) => listarUsuariosActivos(env, sesion));
