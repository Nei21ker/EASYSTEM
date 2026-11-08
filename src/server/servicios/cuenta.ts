// Estado de la cuenta de quien pregunta (equivale a la función estado_cuenta() de Postgres).
// A diferencia del resto de la API NO lanza cuando el usuario está bloqueado: responde el motivo para que la
// pantalla pueda llevarlo a /subscription-suspended o al inicio de sesión con el mensaje correcto.
import { localVigente } from '../../lib/constantes-locales';
import { leerSesionYPerfil } from '../authz';
import type { Entorno } from '../entorno';
import { cargarLocales } from '../repos/locales';

export type MotivoBloqueo = 'ok' | 'local_suspendido' | 'usuario_inactivo' | 'sesion_cerrada' | 'sin_perfil';

export interface EstadoCuenta {
  acceso: boolean;
  motivo: MotivoBloqueo;
  /** Datos del usuario (la interfaz arma la sesión con esto) */
  usuario?: {
    id: string; email: string; nombre: string; rol: string; local_id: string | null; status: string;
    /** La clave actual es temporal: la interfaz obliga a cambiarla antes de seguir */
    debe_cambiar_clave: boolean;
    /** Cuándo empezó esta sesión (ISO) y cuándo se creó la cuenta: se muestran en el perfil */
    sesion_iniciada_en: string;
    creado_en: string;
  };
  rol?: string;
  local_id?: string | null;
  local_nombre?: string;
  subscription_status?: string;
  subscription_expires_at?: string | null;
}

export async function estadoCuenta(env: Entorno, request: Request): Promise<EstadoCuenta> {
  const { userId, emitidaMs, perfil } = await leerSesionYPerfil(env, request);
  if (!perfil) return { acceso: false, motivo: 'sin_perfil' };

  const locales = await cargarLocales(env);
  const local = perfil.local_id ? locales.find((l) => l.id === perfil.local_id) : undefined;

  let motivo: MotivoBloqueo = 'ok';
  if (perfil.status !== 'active') {
    motivo = 'usuario_inactivo';
  } else if (perfil.last_force_logout_at && emitidaMs < Date.parse(perfil.last_force_logout_at)) {
    motivo = 'sesion_cerrada';
  } else if (perfil.rol === 'administrador') {
    motivo = 'ok'; // el administrador nunca queda bloqueado por una suscripción
  } else if (perfil.rol === 'gerente' || perfil.rol === 'contador') {
    if (!locales.some(localVigente)) motivo = 'local_suspendido';
  } else if (!local || !localVigente(local)) {
    motivo = 'local_suspendido';
  }

  return {
    acceso: motivo === 'ok',
    motivo,
    usuario: {
      id: userId, email: perfil.email, nombre: perfil.nombre, rol: perfil.rol, local_id: perfil.local_id, status: perfil.status,
      debe_cambiar_clave: perfil.debe_cambiar_clave === 1,
      sesion_iniciada_en: new Date(emitidaMs).toISOString(),
      creado_en: perfil.created_at,
    },
    rol: perfil.rol,
    local_id: perfil.local_id,
    local_nombre: local?.nombre,
    subscription_status: local?.subscription_status,
    subscription_expires_at: local?.subscription_expires_at ?? null,
  };
}
