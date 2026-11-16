// Actualización automática de la tasa del dólar oficial (BCV): la corre el cron del Worker (`src/worker.ts`) cada mañana.
// bcv.org.ve tiene la cadena de certificados rota (un Worker no puede leerla), así que se usa la API pública dolarapi.com,
// que publica el dólar oficial del BCV. Si la fuente falla no pasa nada: la tasa se sigue pudiendo anotar a mano al entrar.
import type { Entorno } from '../entorno';
import { nuevoId, ahoraISO } from '../util';
import { guardarTasa } from './tasas';
import { hoyDelNegocio } from './inversion';
import type { TasaCambio } from '../../types/database.types';

export const URL_TASA_BCV = 'https://ve.dolarapi.com/v1/dolares/oficial';
export const NOMBRE_TASA_AUTOMATICA = 'BCV (automático)';
/** Una tasa que se aleja más de esto de la anterior se considera un dato dañado y no se registra (el diálogo manual usa el mismo tope). */
export const VARIACION_MAXIMA_AUTOMATICA = 0.25;

export interface TasaLeida {
  tasa: number;
  /** Fecha desde la que rige según la fuente («aaaa-mm-dd»), o null si no la trae */
  vigenteDesde: string | null;
}

/** Valida la respuesta de la fuente: devuelve la tasa y su fecha, o null si no parece una tasa. */
export function leerRespuestaBcv(json: unknown): TasaLeida | null {
  if (!json || typeof json !== 'object') return null;
  const dato = json as { promedio?: unknown; fechaActualizacion?: unknown };
  const tasa = typeof dato.promedio === 'number' ? dato.promedio : NaN;
  if (!Number.isFinite(tasa) || !(tasa > 0) || tasa >= 10_000_000) return null;
  const fecha = typeof dato.fechaActualizacion === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(dato.fechaActualizacion)?.[1] ?? null : null;
  return { tasa: Math.round(tasa * 10_000) / 10_000, vigenteDesde: fecha };
}

export type ResultadoTasaBcv =
  | { resultado: 'registrada'; tasa: number; fecha: string }
  | { resultado: 'ya_registrada'; tasa: number; fecha: string }
  | { resultado: 'error'; motivo: string };

interface Opciones {
  /** Momento actual (para las pruebas) */
  ahora?: Date;
  /** Cómo traer el JSON de la fuente (para las pruebas) */
  traer?: () => Promise<unknown>;
}

async function traerDeInternet(): Promise<unknown> {
  const respuesta = await fetch(URL_TASA_BCV, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!respuesta.ok) throw new Error(`La fuente respondió ${respuesta.status}`);
  return respuesta.json();
}

/**
 * Registra la tasa del BCV con la fecha de HOY (también sábado y domingo: la tasa que rige es la última publicada, y el lunes
 * se publica el viernes, así que el fin de semana toma la del lunes en cuanto la fuente la tenga).
 * No hace nada si hoy ya hay una tasa escrita a mano, ni si la automática de hoy ya tiene este mismo valor. Nunca lanza.
 */
export async function actualizarTasaDesdeBcv(env: Entorno, opciones: Opciones = {}): Promise<ResultadoTasaBcv> {
  try {
    const leida = leerRespuestaBcv(await (opciones.traer ?? traerDeInternet)());
    if (!leida) return { resultado: 'error', motivo: 'La fuente no devolvió una tasa válida.' };

    const hoy = hoyDelNegocio(env, opciones.ahora);
    const ultima = await env.DB
      .prepare('SELECT fecha, tasa, registrado_por, registrado_nombre FROM tasas_cambio ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .first<{ fecha: string; tasa: number; registrado_por: string | null; registrado_nombre: string | null }>();

    if (ultima && ultima.fecha === hoy) {
      const esAutomatica = ultima.registrado_por === null && ultima.registrado_nombre === NOMBRE_TASA_AUTOMATICA;
      // Escrita a mano hoy: manda lo que escribió una persona. Automática con el mismo valor: ya está.
      if (!esAutomatica || Math.abs(ultima.tasa - leida.tasa) < 0.00005) return { resultado: 'ya_registrada', tasa: ultima.tasa, fecha: hoy };
    }
    if (ultima && ultima.tasa > 0 && Math.abs(leida.tasa - ultima.tasa) / ultima.tasa > VARIACION_MAXIMA_AUTOMATICA) {
      return { resultado: 'error', motivo: `La tasa de la fuente (${leida.tasa}) se aleja más de ${VARIACION_MAXIMA_AUTOMATICA * 100} % de la anterior (${ultima.tasa}); no se registró.` };
    }

    const fila: TasaCambio & { registrado_por: string | null } = {
      id: nuevoId(),
      fecha: hoy,
      tasa: leida.tasa,
      created_at: (opciones.ahora ?? new Date(ahoraISO())).toISOString(),
      registrado_nombre: NOMBRE_TASA_AUTOMATICA,
      registrado_por: null,
    };
    await guardarTasa(env, fila);
    return { resultado: 'registrada', tasa: leida.tasa, fecha: hoy };
  } catch (e) {
    return { resultado: 'error', motivo: e instanceof Error ? e.message : 'Error desconocido.' };
  }
}
