// Resumen de lo que se manda de un local a otro (traslados, sin dinero de por medio): por ruta «origen → destino» y por mes.
// Reglas puras, probadas en tests/cliente/envios.test.ts. El valor es a precio de catálogo de hoy (no hay un precio guardado en el traslado).
import type { Traslado } from '../types/database.types';

export interface RutaEnvio {
  origen_id: string;
  destino_id: string;
  origen: string;
  destino: string;
  traslados: number;
  /** Piezas despachadas que NO volvieron al origen (llegaron o siguen en camino) */
  piezas: number;
  /** De esas, las que ya recibió el destino */
  recibidas: number;
  /** Piezas todavía en camino */
  en_camino: number;
  valor_usd: number;
}

export interface ResumenEnvios {
  traslados: number;
  piezas: number;
  valor_usd: number;
  en_camino: number;
  rutas: RutaEnvio[];
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Mes «aaaa-mm» (hora local del navegador) de un instante ISO. */
export function mesDe(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Días enteros que lleva un instante en el pasado (0 si es de hoy). */
export function diasDesde(iso: string, ahora: Date = new Date()): number {
  return Math.max(0, Math.floor((ahora.getTime() - new Date(iso).getTime()) / 86_400_000));
}

/** Un traslado en tránsito que lleva este número de días o más se marca como atrasado. */
export const DIAS_TRANSITO_ATRASADO = 2;

/**
 * Suma los traslados del mes por ruta. No cuenta los anulados; las piezas que volvieron al origen (no llegaron y se cerró el traslado)
 * no cuentan como enviadas. `precios`: precio de catálogo por producto (sin precio vale 0).
 */
export function resumirEnvios(traslados: Traslado[], precios: ReadonlyMap<string, number>, mes: string): ResumenEnvios {
  const rutas = new Map<string, RutaEnvio>();
  let cuenta = 0;
  for (const t of traslados) {
    if (t.estado === 'ANULADO' || mesDe(t.creado_en) !== mes) continue;
    const clave = `${t.origen_local_id}>${t.destino_local_id}`;
    const ruta =
      rutas.get(clave) ??
      rutas
        .set(clave, { origen_id: t.origen_local_id, destino_id: t.destino_local_id, origen: t.origen_nombre ?? 'Origen', destino: t.destino_nombre ?? 'Destino', traslados: 0, piezas: 0, recibidas: 0, en_camino: 0, valor_usd: 0 })
        .get(clave)!;
    ruta.traslados += 1;
    cuenta += 1;
    for (const u of t.unidades) {
      if (u.devuelta_en) continue;
      ruta.piezas += 1;
      ruta.valor_usd += precios.get(u.producto_id) ?? 0;
      if (u.recibida_en) ruta.recibidas += 1;
      else ruta.en_camino += 1;
    }
    // Productos por cantidad: cuentan lo despachado menos lo que volvió al origen
    for (const c of t.cantidades ?? []) {
      const enviadas = c.cantidad - c.devuelta;
      if (enviadas <= 0) continue;
      ruta.piezas += enviadas;
      ruta.valor_usd += enviadas * (precios.get(c.producto_id) ?? 0);
      ruta.recibidas += c.recibida;
      ruta.en_camino += Math.max(0, c.cantidad - c.recibida - c.devuelta);
    }
  }
  const lista = [...rutas.values()].map((r) => ({ ...r, valor_usd: redondear(r.valor_usd) })).sort((a, b) => b.valor_usd - a.valor_usd || a.destino.localeCompare(b.destino));
  return {
    traslados: cuenta,
    piezas: lista.reduce((s, r) => s + r.piezas, 0),
    valor_usd: redondear(lista.reduce((s, r) => s + r.valor_usd, 0)),
    en_camino: lista.reduce((s, r) => s + r.en_camino, 0),
    rutas: lista,
  };
}
