// Presencia ("Tiempo real"), lado del navegador: avisa al servidor que esta pestaña sigue abierta y visible.
//
//   · Un latido al entrar y luego cada 30 s, SOLO con la pestaña visible (una pestaña oculta no manda nada; el servidor la
//     muestra como Inactivo y luego Desconectado). Al volver a verla manda uno enseguida.
//   · `navigator.sendBeacon` (sin esperar respuesta, no compite con las ventas del POS por la red); si no existe, `fetch`
//     con `keepalive`. Cuerpo mínimo: { ruta, local_id } (≈ 50 bytes); el servidor responde 204.
//   · Al cerrar sesión o cerrar la pestaña (`pagehide`) avisa `{ salir: true }`: el servidor la marca como desconectada si en
//     unos segundos no llega otro latido (cambiar de pantalla manda enseguida el de la página siguiente).
//   · Modo demo (sin servidor): la presencia vive en LocalStorage, así que se ven las demás PESTAÑAS del mismo navegador.
import { modoServidor } from './modo';
import { INTERVALO_LATIDO_S } from '../utils/presencia';

const URL_LATIDO = '/api/presence/heartbeat';
export const LS_PRESENCIA = 'easystem:presencia';
const LS_LOCAL_ACTIVO = 'easystem:local-activo';
const LS_SESION = 'easystem:sesion';

/** Fila de presencia del modo demo (la hora en milisegundos, como en la tabla del servidor). */
export interface PresenciaLocal {
  last_seen_at: number;
  salio_en: number | null;
  ruta: string | null;
  local_id: string | null;
}

export function leerPresenciaLocal(): Record<string, PresenciaLocal> {
  try {
    const raw = localStorage.getItem(LS_PRESENCIA);
    return raw ? (JSON.parse(raw) as Record<string, PresenciaLocal>) : {};
  } catch {
    return {};
  }
}

/** El local que el administrador/gerente está mirando en el selector de la cabecera (null = "Todos"). */
function localQueMira(): string | null {
  try {
    const guardado = localStorage.getItem(LS_LOCAL_ACTIVO);
    return guardado && guardado !== 'todos' ? guardado : null;
  } catch {
    return null;
  }
}

function enviarDemo(salir: boolean) {
  try {
    const id = (JSON.parse(localStorage.getItem(LS_SESION) ?? '{}') as { id?: string }).id;
    if (!id) return;
    const todas = leerPresenciaLocal();
    const ahora = Date.now();
    if (salir) {
      if (todas[id]) todas[id].salio_en = ahora;
    } else {
      todas[id] = { last_seen_at: ahora, salio_en: null, ruta: location.pathname, local_id: localQueMira() };
    }
    localStorage.setItem(LS_PRESENCIA, JSON.stringify(todas));
  } catch {
    // sin almacenamiento: no hay presencia que guardar
  }
}

function enviar(salir = false) {
  if (!modoServidor) return enviarDemo(salir);
  if (!salir && typeof navigator !== 'undefined' && navigator.onLine === false) return; // sin red no hay a quién avisar
  const cuerpo = JSON.stringify(salir ? { salir: true } : { ruta: location.pathname, local_id: localQueMira() });
  try {
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(URL_LATIDO, new Blob([cuerpo], { type: 'application/json' }))) return;
  } catch {
    // se intenta con fetch
  }
  void fetch(URL_LATIDO, { method: 'POST', body: cuerpo, headers: { 'content-type': 'application/json' }, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
}

let iniciado = false;

/** Empieza a mandar latidos (una sola vez por página). Se llama desde protegerPagina cuando ya hay sesión. */
export function iniciarLatidos(): void {
  if (iniciado || typeof document === 'undefined') return;
  iniciado = true;
  const visible = () => document.visibilityState === 'visible';
  if (visible()) enviar();
  setInterval(() => {
    if (visible()) enviar();
  }, INTERVALO_LATIDO_S * 1000);
  document.addEventListener('visibilitychange', () => {
    if (visible()) enviar();
  });
  window.addEventListener('online', () => {
    if (visible()) enviar();
  });
  window.addEventListener('pagehide', () => enviar(true));
}

/**
 * Avisa que la persona sale (cerrar sesión): el administrador la verá desconectada sin esperar los 2 minutos. Se ESPERA la respuesta
 * (a diferencia de los latidos) porque justo después se cierra la sesión y un aviso que llegara tarde ya no tendría con qué identificarse.
 */
export async function avisarSalida(): Promise<void> {
  if (!modoServidor) return enviarDemo(true);
  try {
    await fetch(URL_LATIDO, { method: 'POST', body: JSON.stringify({ salir: true }), headers: { 'content-type': 'application/json' }, keepalive: true, credentials: 'same-origin' });
  } catch {
    // sin conexión: de todos modos se cierra la sesión
  }
}
