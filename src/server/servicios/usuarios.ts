// Usuarios, suscripciones y cierres de sesión forzados. Reemplaza las RPC de Postgres (eliminar_usuario,
// cambiar_clave_usuario, cerrar_sesion_forzada, cerrar_sesiones_local, cambiar_suscripcion_local, usuarios_sistema)
// y el trigger proteger_perfil. Las reglas de jerarquía son las de src/lib/auth.ts (rolesAsignables).
import { crearUsuarioInterno } from '../auth';
import { avisarCambio, sentenciasCambio } from '../cambios';
import {
  alcanceDe, alcanceNomina, esAdministrador, esGlobal, esSinLocal, puedeGestionarUsuario, rolesAsignables, type Rol, type Sesion,
} from '../authz';
import type { Entorno } from '../entorno';
import { ErrorApi } from '../errores';
import { hashearClave, verificarClave } from '../password';
import { ahoraISO, nuevoId } from '../util';

export interface PerfilUsuario {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  local_id: string | null;
  status: 'active' | 'inactive';
  created_at: string;
}

export interface UsuarioSistema {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  status: 'active' | 'inactive';
  local_id: string | null;
  local_nombre: string | null;
  subscription_status: string | null;
  last_sign_in_at: string | null;
  last_force_logout_at: string | null;
}

const sinPermiso = (mensaje: string) => new ErrorApi(403, mensaje, 'sin_permiso');

/** Administrador o gerente. El gerente solo opera mientras algún local tenga la suscripción vigente (catalogo_accesible). */
async function exigirGestion(env: Entorno, actor: Sesion, mensaje: string): Promise<void> {
  if (!esGlobal(actor.rol)) throw sinPermiso(mensaje);
  if (actor.rol === 'gerente') await alcanceDe(env, actor);
}

function exigirAdministrador(actor: Sesion, mensaje: string): void {
  if (!esAdministrador(actor.rol)) throw sinPermiso(mensaje);
}

async function perfilDe(env: Entorno, id: string): Promise<PerfilUsuario> {
  const perfil = await env.DB.prepare('SELECT id, email, nombre, rol, local_id, status, created_at FROM perfiles WHERE id = ?').bind(id).first<PerfilUsuario>();
  if (!perfil) throw new ErrorApi(404, 'El usuario no existe.', 'no_existe');
  return perfil;
}

async function exigirLocalExistente(env: Entorno, localId: string): Promise<void> {
  const fila = await env.DB.prepare('SELECT 1 AS ok FROM locales WHERE id = ?').bind(localId).first();
  if (!fila) throw new ErrorApi(400, 'El local no existe.', 'local_invalido');
}

export async function listarUsuarios(env: Entorno, actor: Sesion): Promise<PerfilUsuario[]> {
  await exigirGestion(env, actor, 'Solo un administrador o gerente puede ver los usuarios.');
  // El gerente no ve a los administradores (igual que la política de la tabla perfiles)
  const filtro = actor.rol === 'administrador' ? '' : "WHERE rol <> 'administrador'";
  const filas = await env.DB
    .prepare(`SELECT id, email, nombre, rol, local_id, status, created_at FROM perfiles ${filtro} ORDER BY created_at, nombre`)
    .all<PerfilUsuario>();
  return filas.results;
}

export async function crearUsuario(
  env: Entorno,
  actor: Sesion,
  datos: { email: string; nombre: string; clave: string; rol: Rol; localId: string | null }
): Promise<string> {
  await exigirGestion(env, actor, 'Solo un administrador o gerente puede crear usuarios.');
  if (!rolesAsignables(actor.rol).includes(datos.rol)) {
    throw sinPermiso(actor.rol === 'gerente' ? 'Un gerente solo puede crear encargados, vendedores, técnicos y contadores.' : 'No puedes crear usuarios con ese rol.');
  }
  const localId = esSinLocal(datos.rol) ? null : datos.localId;
  if (!esSinLocal(datos.rol)) {
    if (!localId) throw new ErrorApi(400, 'Elige el local al que pertenece el empleado.', 'local_requerido');
    await exigirLocalExistente(env, localId);
  }
  // La clave la elige quien crea la cuenta: es temporal y la persona debe cambiarla al entrar
  const id = await crearUsuarioInterno(env, { ...datos, localId, debeCambiarClave: true });
  await avisarCambio(env.DB, ['perfiles']);
  return id;
}

export async function actualizarUsuario(
  env: Entorno,
  actor: Sesion,
  id: string,
  cambios: { rol?: Rol; localId?: string | null; status?: 'active' | 'inactive' }
): Promise<void> {
  await exigirGestion(env, actor, 'Solo un administrador o gerente puede modificar usuarios.');
  const objetivo = await perfilDe(env, id);

  const cambiaRol = cambios.rol !== undefined && cambios.rol !== objetivo.rol;
  const cambiaEstado = cambios.status !== undefined && cambios.status !== objetivo.status;
  if (id === actor.userId && (cambiaRol || cambiaEstado)) throw sinPermiso('No puedes cambiar tu propio rol ni tu propio estado.');
  if (!puedeGestionarUsuario(actor.rol, objetivo.rol)) throw sinPermiso('No tienes permiso para modificar a este usuario.');
  if (cambios.rol && !rolesAsignables(actor.rol).includes(cambios.rol)) throw sinPermiso('No puedes asignar ese rol.');
  if (cambios.status && cambios.status !== 'active' && cambios.status !== 'inactive') throw new ErrorApi(400, 'Estado de usuario inválido.');

  const rolFinal = cambios.rol ?? objetivo.rol;
  let localFinal: string | null;
  if (esSinLocal(rolFinal)) {
    localFinal = null;
  } else {
    localFinal = cambios.localId !== undefined ? cambios.localId : objetivo.local_id;
    if (!localFinal) throw new ErrorApi(400, 'Elige el local al que pertenece el empleado.', 'local_requerido');
    if (localFinal !== objetivo.local_id) await exigirLocalExistente(env, localFinal);
  }

  await env.DB
    .prepare('UPDATE perfiles SET rol = ?, local_id = ?, status = ? WHERE id = ?')
    .bind(rolFinal, localFinal, cambios.status ?? objetivo.status, id)
    .run();
  await avisarCambio(env.DB, ['perfiles']);
}

export async function eliminarUsuario(env: Entorno, actor: Sesion, id: string): Promise<void> {
  // Primero el permiso y después la existencia: quien no puede eliminar no debe poder averiguar qué ids existen
  await exigirGestion(env, actor, 'No tienes permiso para eliminar a este usuario.');
  const objetivo = await perfilDe(env, id);
  if (id === actor.userId) throw sinPermiso('No puedes eliminar tu propio usuario.');
  if (!puedeGestionarUsuario(actor.rol, objetivo.rol)) throw sinPermiso('No tienes permiso para eliminar a este usuario.');
  // El borrado en cascada quita cuenta, sesiones y perfil; las ventas y órdenes conservan el nombre y pierden el vínculo
  await env.DB.prepare('DELETE FROM user WHERE id = ?').bind(id).run();
  await avisarCambio(env.DB, ['perfiles']);
}

export async function cambiarClaveUsuario(env: Entorno, actor: Sesion, id: string, clave: string): Promise<void> {
  // Primero el permiso y después la existencia: quien no puede cambiar contraseñas no debe poder averiguar qué ids existen
  if (!esAdministrador(actor.rol)) await exigirGestion(env, actor, 'No tienes permiso para cambiar la contraseña de este usuario.');
  const objetivo = await perfilDe(env, id);
  if (!esAdministrador(actor.rol)) {
    if (id !== actor.userId && !puedeGestionarUsuario(actor.rol, objetivo.rol)) {
      throw sinPermiso('No tienes permiso para cambiar la contraseña de este usuario.');
    }
  }
  if (!clave || clave.length < 8) throw new ErrorApi(400, 'La contraseña debe tener al menos 8 caracteres.', 'clave_corta');

  const hash = await hashearClave(clave);
  const lote = [
    env.DB.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").bind(hash, Date.now(), id),
    // La clave que fija otra persona es temporal (hay que cambiarla al entrar); la que uno se fija a sí mismo ya es la suya
    env.DB.prepare('UPDATE perfiles SET debe_cambiar_clave = ? WHERE id = ?').bind(id === actor.userId ? 0 : 1, id),
  ];
  // A otro usuario se le cierran las sesiones abiertas: debe entrar con la contraseña nueva
  if (id !== actor.userId) lote.push(env.DB.prepare('DELETE FROM session WHERE userId = ?').bind(id));
  await env.DB.batch(lote);
}

// --- Cambiar la propia contraseña ---------------------------------------------------------------------------
// Cualquier rol puede. Pide la clave actual (quien deje una sesión abierta no debe poder cambiarla) y, como adivinarla a ciegas
// sería lo único que le quedaría a quien tenga la sesión, se cuentan los fallos: 5 seguidos bloquean 15 minutos.
const MAX_FALLOS_CLAVE = 5;
const VENTANA_FALLOS_CLAVE_MS = 15 * 60 * 1000;
const claveIntentosPropia = (userId: string) => `clave-propia:${userId}`;

export async function cambiarMiClave(env: Entorno, sesion: Sesion, actual: string, nueva: string): Promise<void> {
  // Como el resto de la API, una cuenta de un local suspendido o sin vigencia recibe 403 (el contador, que no tiene alcance de
  // negocio, se comprueba con el de la nómina, lo único que ve)
  await (sesion.rol === 'contador' ? alcanceNomina(env, sesion) : alcanceDe(env, sesion));
  const llave = claveIntentosPropia(sesion.userId);
  const fila = await env.DB.prepare('SELECT count, lastRequest FROM rateLimit WHERE key = ?').bind(llave).first<{ count: number; lastRequest: number }>();
  if (fila && fila.count >= MAX_FALLOS_CLAVE && Date.now() - fila.lastRequest < VENTANA_FALLOS_CLAVE_MS) {
    throw new ErrorApi(429, 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.', 'demasiados_intentos');
  }

  const cuenta = await env.DB
    .prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'")
    .bind(sesion.userId)
    .first<{ password: string | null }>();
  // Sin cuenta se hace igual el cálculo del hash, para no variar el tiempo de respuesta
  const correcta = cuenta?.password ? await verificarClave(actual, cuenta.password) : (await hashearClave(actual), false);
  if (!correcta) {
    const ahora = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?, ?, 1, ?)
         ON CONFLICT (key) DO UPDATE SET count = CASE WHEN ? - lastRequest < ? THEN count + 1 ELSE 1 END, lastRequest = ?`
      )
      .bind(llave, llave, ahora, ahora, VENTANA_FALLOS_CLAVE_MS, ahora)
      .run();
    throw new ErrorApi(400, 'La contraseña actual no es correcta.', 'clave_actual_incorrecta');
  }

  if (!nueva || nueva.length < 8) throw new ErrorApi(400, 'La contraseña nueva debe tener al menos 8 caracteres.', 'clave_corta');
  if (nueva === actual) throw new ErrorApi(400, 'La contraseña nueva debe ser distinta de la actual.', 'clave_igual');

  const hash = await hashearClave(nueva);
  const lote = [
    env.DB.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").bind(hash, Date.now(), sesion.userId),
    env.DB.prepare('UPDATE perfiles SET debe_cambiar_clave = 0 WHERE id = ?').bind(sesion.userId),
    env.DB.prepare('DELETE FROM rateLimit WHERE key = ?').bind(llave),
  ];
  // Las demás sesiones de esta cuenta (otros equipos, o quien la tuviera abierta) se cierran; esta sigue
  if (sesion.sesionId) lote.push(env.DB.prepare('DELETE FROM session WHERE userId = ? AND id <> ?').bind(sesion.userId, sesion.sesionId));
  await env.DB.batch(lote);
}

export async function cerrarSesionForzada(env: Entorno, actor: Sesion, usuarioId: string): Promise<void> {
  exigirAdministrador(actor, 'Solo el administrador puede cerrar sesiones.');
  if (usuarioId === actor.userId) throw sinPermiso('No puedes cerrar tu propia sesión desde aquí');
  await perfilDe(env, usuarioId);
  await env.DB.batch([
    env.DB.prepare('UPDATE perfiles SET last_force_logout_at = ? WHERE id = ?').bind(ahoraISO(), usuarioId),
    env.DB.prepare('DELETE FROM session WHERE userId = ?').bind(usuarioId),
    ...sentenciasCambio(env.DB, ['perfiles'], null),
  ]);
}

/** Cierra las sesiones de todos los usuarios de un local (menos administradores). Devuelve cuántos usuarios. */
export async function cerrarSesionesLocal(env: Entorno, actor: Sesion, localId: string): Promise<number> {
  exigirAdministrador(actor, 'Solo el administrador puede cerrar sesiones.');
  const filas = await env.DB.prepare("SELECT id FROM perfiles WHERE local_id = ? AND rol <> 'administrador'").bind(localId).all<{ id: string }>();
  const ids = filas.results.map((f) => f.id);
  if (ids.length === 0) return 0;
  const marcas = ids.map(() => '?').join(', ');
  await env.DB.batch([
    env.DB.prepare(`UPDATE perfiles SET last_force_logout_at = ? WHERE id IN (${marcas})`).bind(ahoraISO(), ...ids),
    env.DB.prepare(`DELETE FROM session WHERE userId IN (${marcas})`).bind(...ids),
    ...sentenciasCambio(env.DB, ['perfiles'], null),
  ]);
  return ids.length;
}

export async function cambiarSuscripcionLocal(
  env: Entorno,
  actor: Sesion,
  localId: string,
  estado: 'ACTIVE' | 'SUSPENDED' | 'PAST_DUE',
  vence: string | null,
  cambiarVencimiento: boolean
): Promise<void> {
  exigirAdministrador(actor, 'Solo el administrador puede cambiar suscripciones.');
  if (!['ACTIVE', 'SUSPENDED', 'PAST_DUE'].includes(estado)) throw new ErrorApi(400, `Estado de suscripción inválido: ${estado}`, 'estado_invalido');
  const anterior = await env.DB
    .prepare('SELECT subscription_status, subscription_expires_at FROM locales WHERE id = ?')
    .bind(localId)
    .first<{ subscription_status: string; subscription_expires_at: string | null }>();
  if (!anterior) throw new ErrorApi(404, 'El local no existe', 'no_existe');

  const venceNuevo = cambiarVencimiento ? vence : anterior.subscription_expires_at;
  await env.DB.batch([
    env.DB.prepare('UPDATE locales SET subscription_status = ?, subscription_expires_at = ? WHERE id = ?').bind(estado, venceNuevo, localId),
    env.DB
      .prepare('INSERT INTO suscripcion_eventos (id, local_id, estado_anterior, estado_nuevo, vence_anterior, vence_nuevo, cambiado_por, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(nuevoId(), localId, anterior.subscription_status, estado, anterior.subscription_expires_at, venceNuevo, actor.userId, ahoraISO()),
    ...sentenciasCambio(env.DB, ['locales'], null),
  ]);
}

/** Todos los usuarios con su local y suscripción (panel de suscripciones, solo administrador). */
export async function listarUsuariosSistema(env: Entorno, actor: Sesion): Promise<UsuarioSistema[]> {
  exigirAdministrador(actor, 'Solo el administrador puede ver esta lista.');
  const filas = await env.DB
    .prepare(
      `SELECT p.id, p.email, p.nombre, p.rol, p.status, p.local_id, l.nombre AS local_nombre, l.subscription_status,
              (SELECT max(s.createdAt) FROM session s WHERE s.userId = p.id) AS ultimo_ingreso_ms, p.last_force_logout_at
       FROM perfiles p LEFT JOIN locales l ON l.id = p.local_id
       ORDER BY (p.rol = 'administrador') DESC, (p.rol = 'gerente') DESC, l.nombre, p.nombre`
    )
    .all<Omit<UsuarioSistema, 'last_sign_in_at'> & { ultimo_ingreso_ms: number | null }>();
  return filas.results.map(({ ultimo_ingreso_ms, ...resto }) => ({
    ...resto,
    last_sign_in_at: ultimo_ingreso_ms ? new Date(ultimo_ingreso_ms).toISOString() : null,
  }));
}
