// Presencia ("Tiempo real"): quién está usando el sistema ahora.
//
// Esquema: tabla `presencia` (migración 0011), UNA fila por usuario con su último latido. Cada pestaña visible manda un
// latido cada 30 s (POST /api/presence/heartbeat, 204 sin cuerpo). Para no saturar D1 el latido es un upsert CONDICIONAL:
// solo escribe si pasaron más de 10 s desde el anterior (o si el usuario había avisado que salía); si no, la sentencia no
// cambia nada y D1 no cuenta una escritura. No toca la tabla `cambios` (nadie tiene que enterarse de cada latido).
// El estado (🟢/🟡/🔴) NO se guarda: se calcula al leer a partir de la hora (utils/presencia.ts).
import { alcanceDe, alcanceNomina, esSinLocal, exigirRol, type Sesion } from '../authz';
import type { Entorno } from '../entorno';
import { calcularEstado, dispositivoDe, type EstadoPresencia, type ListaPresencia, type UsuarioPresencia } from '../../utils/presencia';

/** Un latido más seguido que esto no vuelve a escribir en la base de datos. */
export const MIN_ENTRE_ESCRITURAS_MS = 10_000;
/** Cuánto tiempo se muestra a alguien después de su último latido (más viejo: ya no se lista; limpiarPresencia lo borra). */
export const VENTANA_LISTA_MS = 24 * 3_600_000;
/** Las filas no vistas desde hace más de esto se borran. */
export const VIDA_MAXIMA_MS = 7 * 86_400_000;

export interface DatosLatido {
  /** Pantalla actual (solo la ruta, sin parámetros) */
  ruta?: unknown;
  /** Local que mira (solo lo respetan los roles sin local fijo) */
  local_id?: unknown;
  /** true = avisa que sale (cerró sesión o cerró la pestaña) */
  salir?: unknown;
}

export interface OrigenLatido {
  ip: string | null;
  userAgent: string | null;
}

const RUTA_VALIDA = /^\/[A-Za-z0-9\-_./]*$/;

function rutaLimpia(valor: unknown): string | null {
  return typeof valor === 'string' && RUTA_VALIDA.test(valor) ? valor.slice(0, 80) : null;
}

export async function registrarLatido(env: Entorno, sesion: Sesion, datos: DatosLatido, origen: OrigenLatido, ahora: number = Date.now()): Promise<void> {
  // Como el resto de la API: una cuenta de un local suspendido o sin vigencia recibe 403 (y deja de figurar como conectada)
  // (el contador no tiene alcance de negocio: su comprobación es la de la nómina, la única parte del sistema que ve)
  await (sesion.rol === 'contador' ? alcanceNomina(env, sesion) : alcanceDe(env, sesion));
  if (datos.salir === true) {
    // Solo marca la salida de quien ya tenía fila (nunca crea una)
    await env.DB.prepare('UPDATE presencia SET salio_en = ? WHERE user_id = ?').bind(ahora, sesion.userId).run();
    return;
  }
  // El local de un vendedor/encargado/técnico es el de su perfil (no se puede declarar otro); los que ven todos los locales informan cuál miran
  const localId = esSinLocal(sesion.rol) ? (typeof datos.local_id === 'string' && datos.local_id.length <= 64 ? datos.local_id : null) : sesion.localId;
  await env.DB
    .prepare(
      `INSERT INTO presencia (user_id, last_seen_at, salio_en, ip, dispositivo, local_id, ruta) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)
       ON CONFLICT (user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, salio_en = NULL, ip = excluded.ip,
         dispositivo = excluded.dispositivo, local_id = excluded.local_id, ruta = excluded.ruta
       WHERE presencia.last_seen_at < excluded.last_seen_at - ?7 OR presencia.salio_en IS NOT NULL`
    )
    .bind(sesion.userId, ahora, origen.ip?.slice(0, 64) ?? null, dispositivoDe(origen.userAgent), localId, rutaLimpia(datos.ruta), MIN_ENTRE_ESCRITURAS_MS)
    .run();
}

const ORDEN_ESTADO: Record<EstadoPresencia, number> = { en_linea: 0, inactivo: 1, desconectado: 2 };

/** Quién está conectado y cómo (solo el administrador): En línea primero, luego Inactivo, luego Desconectado; dentro de cada uno, el más reciente. */
export async function listarUsuariosActivos(env: Entorno, sesion: Sesion, ahora: number = Date.now()): Promise<ListaPresencia> {
  exigirRol(sesion, ['administrador']);
  const [filas, locales] = await Promise.all([
    env.DB
      .prepare(
        `SELECT p.user_id, p.last_seen_at, p.salio_en, p.ip, p.dispositivo, p.local_id AS local_visto, p.ruta,
                f.nombre, f.email, f.rol, f.status, f.local_id AS local_perfil
         FROM presencia p JOIN perfiles f ON f.id = p.user_id
         WHERE p.last_seen_at >= ?`
      )
      .bind(ahora - VENTANA_LISTA_MS)
      .all<{
        user_id: string; last_seen_at: number; salio_en: number | null; ip: string | null; dispositivo: string | null; local_visto: string | null;
        ruta: string | null; nombre: string; email: string; rol: Sesion['rol']; status: string; local_perfil: string | null;
      }>(),
    env.DB.prepare('SELECT id, nombre FROM locales').all<{ id: string; nombre: string }>(),
  ]);
  const nombres = new Map(locales.results.map((l) => [l.id, l.nombre]));

  const usuarios: UsuarioPresencia[] = filas.results.map((f) => {
    const segundos = Math.max(0, Math.floor((ahora - f.last_seen_at) / 1000));
    const localId = esSinLocal(f.rol) ? f.local_visto : f.local_perfil;
    return {
      id: f.user_id,
      nombre: f.nombre,
      email: f.email,
      rol: f.rol,
      status: f.status,
      local_id: localId,
      // Quien ve todos los locales y no eligió uno está mirando "Todos"
      local_nombre: localId ? (nombres.get(localId) ?? null) : esSinLocal(f.rol) ? 'Todos los locales' : null,
      ip: f.ip,
      dispositivo: f.dispositivo,
      ruta: f.ruta,
      ultimo_latido: new Date(f.last_seen_at).toISOString(),
      segundos,
      estado: calcularEstado(segundos, f.salio_en === null ? null : Math.max(0, Math.floor((ahora - f.salio_en) / 1000))),
    };
  });
  usuarios.sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.segundos - b.segundos);

  const resumen: Record<EstadoPresencia, number> = { en_linea: 0, inactivo: 0, desconectado: 0 };
  for (const u of usuarios) resumen[u.estado] += 1;
  return { ahora: new Date(ahora).toISOString(), usuarios_activos: resumen.en_linea, resumen, usuarios };
}

/** Expira las sesiones muertas: borra lo no visto hace más de 7 días. Devuelve cuántas filas borró. */
export async function limpiarPresencia(env: Entorno, ahora: number = Date.now()): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM presencia WHERE last_seen_at < ?').bind(ahora - VIDA_MAXIMA_MS).run();
  return r.meta.changes ?? 0;
}
