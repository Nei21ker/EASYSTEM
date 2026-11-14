// Autorización: reemplaza las políticas RLS y las funciones de acceso de Postgres
// (es_administrador, es_global, es_gerencia, usuario_habilitado, local_vigente, local_accesible, nomina_accesible).
//
// Regla de diseño anti-olvidos: los repositorios reciben un `Alcance` (los locales que el usuario puede ver) que SOLO
// producen alcanceDe / alcanceNomina; no existe forma de consultar datos de un local sin pasar por ahí.
import { localVigente } from '../lib/constantes-locales';
import { crearAuth } from './auth';
import type { Entorno } from './entorno';
import { ErrorApi } from './errores';
import { cargarLocales } from './repos/locales';

export type Rol = 'administrador' | 'gerente' | 'supervisor' | 'encargado' | 'vendedor' | 'tecnico' | 'contador';

export interface Sesion {
  userId: string;
  email: string;
  nombre: string;
  rol: Rol;
  localId: string | null;
  status: 'active' | 'inactive';
  /** Segundos desde 1970 en que se inició la sesión */
  emitidaEn: number;
  /** Id de la fila de la sesión (para cerrar las demás al cambiar la clave) */
  sesionId?: string;
  /** La clave actual es temporal (la puso otra persona): hasta cambiarla solo funciona /api/cuenta/clave */
  debeCambiarClave?: boolean;
}

export type Alcance = { tipo: 'todos' } | { tipo: 'locales'; ids: string[] };

export const esAdministrador = (rol: Rol): boolean => rol === 'administrador';
/** Administrador y gerente: ven todos los locales y el catálogo. */
export const esGlobal = (rol: Rol): boolean => rol === 'administrador' || rol === 'gerente';
/** Supervisor: tiene los permisos y los módulos del encargado, pero en TODOS los locales (sin local propio). */
export const esSupervisor = (rol: Rol): boolean => rol === 'supervisor';
/** Administrador, gerente, supervisor y encargado (el nivel «encargado» o superior). */
export const esGerencia = (rol: Rol): boolean => rol === 'administrador' || rol === 'gerente' || rol === 'supervisor' || rol === 'encargado';
/** Quienes tienen los límites del encargado (no ven ni fijan el precio de compra, no autorizan descuentos): encargado y supervisor. */
export const conLimitesDeEncargado = (rol: Rol): boolean => rol === 'encargado' || rol === 'supervisor';
/** Quienes trabajan en cualquier local (no tienen uno propio): administrador, gerente y supervisor. */
export const veTodosLosLocales = (rol: Rol): boolean => rol === 'administrador' || rol === 'gerente' || rol === 'supervisor';

export function exigirRol(sesion: Pick<Sesion, 'rol'>, roles: Rol[]): void {
  if (!roles.includes(sesion.rol)) throw new ErrorApi(403, 'Tu rol no tiene permiso para hacer esto.', 'sin_permiso');
}

interface FilaPerfil {
  email: string;
  nombre: string;
  rol: Rol;
  local_id: string | null;
  status: 'active' | 'inactive';
  last_force_logout_at: string | null;
  created_at: string;
  debe_cambiar_clave: number;
}

export const ROLES: Rol[] = ['administrador', 'gerente', 'supervisor', 'encargado', 'vendedor', 'tecnico', 'contador'];
/** Roles que no pertenecen a un local concreto. */
export const esSinLocal = (rol: Rol): boolean => rol === 'administrador' || rol === 'gerente' || rol === 'supervisor' || rol === 'contador';

/** Roles que cada quien puede asignar al crear o editar usuarios (mismas reglas que el cliente: rolesAsignables). */
export function rolesAsignables(rol: Rol): Rol[] {
  if (rol === 'administrador') return ROLES;
  if (rol === 'gerente') return ['supervisor', 'encargado', 'vendedor', 'tecnico', 'contador'];
  return [];
}

/** ¿El actor puede editar o eliminar a alguien con el rol `objetivo`? (Nadie se gestiona a sí mismo: eso se valida aparte.) */
export const puedeGestionarUsuario = (actor: Rol, objetivo: Rol): boolean => rolesAsignables(actor).includes(objetivo);

/** La sesión de Better-Auth y el perfil de la petición, sin juzgar si el usuario puede operar. 401 si no hay sesión. */
export async function leerSesionYPerfil(env: Entorno, request: Request) {
  const datos = await crearAuth(env, new URL(request.url).origin).api.getSession({ headers: request.headers });
  if (!datos) throw new ErrorApi(401, 'Tu sesión expiró. Inicia sesión de nuevo.', 'sin_sesion');
  const perfil = await env.DB
    .prepare('SELECT email, nombre, rol, local_id, status, last_force_logout_at, created_at, debe_cambiar_clave FROM perfiles WHERE id = ?')
    .bind(datos.user.id)
    .first<FilaPerfil>();
  return { userId: datos.user.id, sesionId: datos.session.id, emitidaMs: new Date(datos.session.createdAt).getTime(), perfil };
}

/** La sesión de la petición (cookie de Better-Auth + perfil). Equivale a usuario_habilitado(): 401 si no puede operar. */
export async function cargarSesion(env: Entorno, request: Request): Promise<Sesion> {
  const { userId, sesionId, emitidaMs, perfil } = await leerSesionYPerfil(env, request);
  if (!perfil) throw new ErrorApi(401, 'Tu cuenta no tiene un perfil asociado. Comunícate con el administrador.', 'sin_perfil');
  if (perfil.status !== 'active') {
    throw new ErrorApi(401, 'Tu cuenta está desactivada. Comunícate con el administrador de tu negocio.', 'usuario_inactivo');
  }
  if (perfil.last_force_logout_at && emitidaMs < Date.parse(perfil.last_force_logout_at)) {
    throw new ErrorApi(401, 'Tu sesión fue cerrada por el administrador del sistema. Inicia sesión de nuevo.', 'sesion_cerrada');
  }
  return {
    userId,
    email: perfil.email,
    nombre: perfil.nombre,
    rol: perfil.rol,
    localId: perfil.local_id,
    status: perfil.status,
    emitidaEn: Math.floor(emitidaMs / 1000),
    sesionId,
    debeCambiarClave: perfil.debe_cambiar_clave === 1,
  };
}

const sinLocalesVigentes = () =>
  new ErrorApi(403, 'La suscripción de tu local está suspendida. Comunícate con el administrador del sistema.', 'local_suspendido');

/**
 * Locales de negocio que la sesión puede usar. administrador: todos (aunque estén suspendidos); gerente y supervisor: los vigentes;
 * encargado/vendedor/técnico: solo el suyo si está vigente; contador: ninguno (no ve datos del negocio).
 * `localSolicitado` restringe el resultado a ese local (403 si no es accesible).
 */
export async function alcanceDe(env: Entorno, sesion: Sesion, localSolicitado?: string): Promise<Alcance> {
  if (sesion.rol === 'contador') throw new ErrorApi(403, 'Tu rol no tiene permiso para hacer esto.', 'sin_permiso');

  if (sesion.rol === 'administrador') {
    return localSolicitado ? { tipo: 'locales', ids: [localSolicitado] } : { tipo: 'todos' };
  }

  const locales = await cargarLocales(env);
  if (sesion.rol === 'gerente' || sesion.rol === 'supervisor') {
    const ids = locales.filter(localVigente).map((l) => l.id);
    if (ids.length === 0) throw sinLocalesVigentes();
    if (localSolicitado) {
      if (!ids.includes(localSolicitado)) throw sinLocalesVigentes();
      return { tipo: 'locales', ids: [localSolicitado] };
    }
    return { tipo: 'locales', ids };
  }

  // encargado, vendedor y técnico: un solo local
  if (!sesion.localId) throw new ErrorApi(403, 'Tu usuario no tiene un local asignado. Pídele al administrador que te asigne uno.', 'sin_local');
  if (localSolicitado && localSolicitado !== sesion.localId) throw new ErrorApi(403, 'No tienes acceso a ese local.', 'sin_permiso');
  const propio = locales.find((l) => l.id === sesion.localId);
  if (!propio || !localVigente(propio)) throw sinLocalesVigentes();
  return { tipo: 'locales', ids: [sesion.localId] };
}

/** Alcance de la nómina (nomina_accesible): administrador siempre; gerente y contador, los locales vigentes. */
export async function alcanceNomina(env: Entorno, sesion: Sesion, localSolicitado?: string): Promise<Alcance> {
  if (sesion.rol === 'administrador') return localSolicitado ? { tipo: 'locales', ids: [localSolicitado] } : { tipo: 'todos' };
  if (sesion.rol !== 'gerente' && sesion.rol !== 'contador') throw new ErrorApi(403, 'Tu rol no tiene acceso a la nómina.', 'sin_permiso');

  const ids = (await cargarLocales(env)).filter(localVigente).map((l) => l.id);
  if (ids.length === 0) throw sinLocalesVigentes();
  if (localSolicitado) {
    if (!ids.includes(localSolicitado)) throw sinLocalesVigentes();
    return { tipo: 'locales', ids: [localSolicitado] };
  }
  return { tipo: 'locales', ids };
}

/** ¿Puede esta sesión usar ese local de negocio? (local_accesible) */
export async function localAccesible(env: Entorno, sesion: Sesion, localId: string): Promise<boolean> {
  try {
    const alcance = await alcanceDe(env, sesion, localId);
    return alcance.tipo === 'todos' || alcance.ids.includes(localId);
  } catch (err) {
    if (err instanceof ErrorApi && err.status === 403) return false;
    throw err;
  }
}

/** Fragmento SQL (con `?`) para filtrar una columna de local por el alcance. */
export function condicionAlcance(alcance: Alcance, columna = 'local_id'): { sql: string; valores: string[] } {
  if (alcance.tipo === 'todos') return { sql: '1 = 1', valores: [] };
  if (alcance.ids.length === 0) return { sql: '0 = 1', valores: [] };
  return { sql: `${columna} IN (${alcance.ids.map(() => '?').join(', ')})`, valores: alcance.ids };
}
