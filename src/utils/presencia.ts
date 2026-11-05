// Presencia ("Tiempo real"): quién está usando el sistema ahora. Reglas puras, compartidas por el servidor
// (src/server/servicios/presencia.ts), la pantalla del administrador y el modo demo (LocalStorage).
//
//   🟢 En línea       último latido hace menos de 45 s
//   🟡 Inactivo       entre 45 s y 2 min (normalmente una pestaña en segundo plano: no manda latidos)
//   🔴 Desconectado   más de 2 min, o salió (cerró sesión / cerró la pestaña) hace más de la gracia

/** Cada cuántos segundos manda un latido una pestaña visible (menos que el umbral "en línea" para no parpadear). */
export const INTERVALO_LATIDO_S = 30;
export const UMBRAL_EN_LINEA_S = 45;
export const UMBRAL_INACTIVO_S = 120;
/**
 * Al cambiar de pantalla el navegador "sale" de una página y entra en la siguiente: esa salida no cuenta hasta que pasan estos
 * segundos sin un latido nuevo (el latido de la pantalla siguiente borra la salida). Es lo que evita el parpadeo en rojo.
 */
export const GRACIA_SALIDA_S = 8;

export type EstadoPresencia = 'en_linea' | 'inactivo' | 'desconectado';

/** Una persona en la lista de "Tiempo real" (lo que responde GET /api/admin/active-users). */
export interface UsuarioPresencia {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  /** 'inactive' = cuenta desactivada */
  status: string;
  local_id: string | null;
  local_nombre: string | null;
  ip: string | null;
  dispositivo: string | null;
  ruta: string | null;
  /** Hora del último latido (ISO) */
  ultimo_latido: string;
  /** Segundos desde el último latido, al momento de la consulta */
  segundos: number;
  estado: EstadoPresencia;
}

export interface ListaPresencia {
  /** Hora del servidor al responder (ISO) */
  ahora: string;
  /** "Usuarios activos ahora": los que están En línea */
  usuarios_activos: number;
  resumen: Record<EstadoPresencia, number>;
  usuarios: UsuarioPresencia[];
}

/**
 * El estado de alguien a partir de cuántos segundos hace de su último latido y, si avisó que salía, de cuántos segundos hace
 * de ese aviso (null = no ha salido).
 */
export function calcularEstado(segundosDesdeLatido: number, segundosDesdeSalida: number | null = null): EstadoPresencia {
  if (segundosDesdeSalida !== null && segundosDesdeSalida >= GRACIA_SALIDA_S) return 'desconectado';
  if (segundosDesdeLatido < UMBRAL_EN_LINEA_S) return 'en_linea';
  if (segundosDesdeLatido <= UMBRAL_INACTIVO_S) return 'inactivo';
  return 'desconectado';
}

/** "ahora mismo", "hace 12 s", "hace 3 min", "hace 2 h", "hace 2 d". */
export function textoHace(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  if (s < 1) return 'ahora mismo';
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86_400)} d`;
}

/** Navegador y sistema en pocas palabras ("Chrome · Windows") a partir del User-Agent; "Desconocido" si no se reconoce. */
export function dispositivoDe(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const navegador = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua) && /Version\//.test(ua)
            ? 'Safari'
            : null;
  if (!navegador) return 'Desconocido';
  const sistema = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux|X11/.test(ua)
              ? 'Linux'
              : null;
  return sistema ? `${navegador} · ${sistema}` : navegador;
}
