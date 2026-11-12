// Cambio de mercancía con otro local (Local Vidrios): reglas puras compartidas por el servidor, la demo y la pantalla.
import type { Intercambio, IntercambioItem, LadoPendienteIntercambio } from '../types/database.types';

export const MAX_ITEMS_INTERCAMBIO = 25;
export const MAX_CANTIDAD_ITEM_INTERCAMBIO = 5000;
/** Si lo que entra vale menos que esta parte de lo que sale, se advierte (0,85 = más de 15 % de diferencia). */
export const UMBRAL_ADVERTENCIA_VALOR = 0.85;

const redondear = (n: number) => Math.round(n * 100) / 100;

export interface LineaIntercambio {
  producto_id: string;
  cantidad: number;
  unidades?: string[];
}

/**
 * Junta los productos repetidos (suma cantidades y piezas escaneadas) y valida la lista. Lanza Error con el mensaje en español.
 * Las piezas escaneadas no pueden ser más que la cantidad ni repetirse.
 */
export function normalizarLineasIntercambio(lineas: LineaIntercambio[] | null | undefined, lado: string): LineaIntercambio[] {
  const mapa = new Map<string, LineaIntercambio>();
  for (const l of lineas ?? []) {
    if (!l.producto_id) throw new Error(`Un producto de lo que ${lado} no es válido.`);
    if (!Number.isInteger(l.cantidad) || l.cantidad < 1) throw new Error('La cantidad de cada producto debe ser un número entero mayor a 0.');
    const previa = mapa.get(l.producto_id) ?? { producto_id: l.producto_id, cantidad: 0, unidades: [] };
    previa.cantidad += l.cantidad;
    previa.unidades = [...(previa.unidades ?? []), ...(l.unidades ?? [])];
    mapa.set(l.producto_id, previa);
  }
  if (mapa.size > MAX_ITEMS_INTERCAMBIO) throw new Error(`Máximo ${MAX_ITEMS_INTERCAMBIO} productos distintos por lado.`);
  const lista = [...mapa.values()];
  for (const l of lista) {
    if (l.cantidad > MAX_CANTIDAD_ITEM_INTERCAMBIO) throw new Error(`Máximo ${MAX_CANTIDAD_ITEM_INTERCAMBIO} unidades de un mismo producto.`);
    if ((l.unidades?.length ?? 0) > l.cantidad) throw new Error('Hay más piezas escaneadas que la cantidad indicada.');
    if (new Set(l.unidades).size !== (l.unidades?.length ?? 0)) throw new Error('Hay piezas repetidas en la lista.');
    if (!l.unidades?.length) delete l.unidades;
  }
  return lista;
}

export const totalPiezas = (items: Pick<IntercambioItem, 'cantidad'>[]): number => items.reduce((s, i) => s + i.cantidad, 0);

/** Lo que valen los productos al precio de catálogo (dólares, a centavos). */
export const valorDeItems = (items: Pick<IntercambioItem, 'cantidad' | 'precio_unitario'>[]): number => redondear(items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0));

/** Limpia el nombre de con quién se cambia (espacios de más); null si no sirve. */
export function normalizarContraparte(texto: string | null | undefined): string | null {
  const limpio = (texto ?? '').trim().replace(/\s+/g, ' ');
  return limpio.length >= 2 && limpio.length <= 80 ? limpio : null;
}

/** Clave para agrupar a una contraparte sin importar mayúsculas, acentos ni espacios de más. */
export const claveContraparte = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface AdvertenciaValor {
  /** Dólares que valen de menos lo que entra frente a lo que sale (positivo) */
  falta_usd: number;
  /** Lo que entra, como parte de lo que sale (0,6 = 60 %) */
  proporcion: number;
}

/** Aviso cuando lo que entra vale MUCHO menos que lo que sale (más de 15 % menos); null si no hay nada que advertir. */
export function advertenciaDeValor(valorSale: number, valorEntra: number): AdvertenciaValor | null {
  if (!(valorSale > 0)) return null;
  const proporcion = valorEntra / valorSale;
  if (proporcion >= UMBRAL_ADVERTENCIA_VALOR) return null;
  return { falta_usd: redondear(valorSale - valorEntra), proporcion };
}

/** Qué lados del cambio ya se movieron en el inventario según su estado. */
export function ladosMovidos(estado: Intercambio['estado'], pendiente: LadoPendienteIntercambio | null): { salen: boolean; entran: boolean } {
  if (estado === 'COMPLETADO') return { salen: true, entran: true };
  if (estado === 'EN_ESPERA') return { salen: pendiente !== 'SALEN', entran: pendiente !== 'ENTRAN' };
  return { salen: false, entran: false };
}

/** El texto de un lado: «5 × Vidrio A, 2 × Vidrio B». */
export const textoDeItems = (items: Pick<IntercambioItem, 'nombre' | 'cantidad'>[]): string => items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ');

export interface ResumenContraparte {
  clave: string;
  nombre: string;
  cambios: number;
  piezas_salen: number;
  piezas_entran: number;
  valor_sale_usd: number;
  valor_entra_usd: number;
  /** Lo que entró menos lo que salió, a precio de catálogo (negativo = se dio más de lo que se recibió) */
  neto_usd: number;
}

export interface ResumenCambios {
  cambios: number;
  en_espera: number;
  piezas_salen: number;
  piezas_entran: number;
  valor_sale_usd: number;
  valor_entra_usd: number;
  neto_usd: number;
  porContraparte: ResumenContraparte[];
}

/**
 * Resumen de los cambios de un período (el mes): cuánto se entregó y se recibió, en piezas y en dólares a precio de catálogo, y con quién.
 * Los anulados no cuentan. En un cambio en espera solo cuenta el lado que ya se movió (lo otro todavía no pasó); se avisa cuántos hay en espera.
 */
export function resumirCambios(lista: Intercambio[]): ResumenCambios {
  const grupos = new Map<string, ResumenContraparte>();
  const total: ResumenCambios = { cambios: 0, en_espera: 0, piezas_salen: 0, piezas_entran: 0, valor_sale_usd: 0, valor_entra_usd: 0, neto_usd: 0, porContraparte: [] };
  for (const c of lista) {
    if (c.estado === 'ANULADO') continue;
    const movidos = ladosMovidos(c.estado, c.lado_pendiente);
    const piezasSalen = movidos.salen ? totalPiezas(c.salen) : 0;
    const piezasEntran = movidos.entran ? totalPiezas(c.entran) : 0;
    const valorSale = movidos.salen ? c.valor_sale_usd : 0;
    const valorEntra = movidos.entran ? c.valor_entra_usd : 0;
    const clave = claveContraparte(c.contraparte);
    const g = grupos.get(clave) ?? { clave, nombre: c.contraparte, cambios: 0, piezas_salen: 0, piezas_entran: 0, valor_sale_usd: 0, valor_entra_usd: 0, neto_usd: 0 };
    g.cambios += 1;
    g.piezas_salen += piezasSalen;
    g.piezas_entran += piezasEntran;
    g.valor_sale_usd = redondear(g.valor_sale_usd + valorSale);
    g.valor_entra_usd = redondear(g.valor_entra_usd + valorEntra);
    g.neto_usd = redondear(g.valor_entra_usd - g.valor_sale_usd);
    grupos.set(clave, g);
    total.cambios += 1;
    if (c.estado === 'EN_ESPERA') total.en_espera += 1;
    total.piezas_salen += piezasSalen;
    total.piezas_entran += piezasEntran;
    total.valor_sale_usd = redondear(total.valor_sale_usd + valorSale);
    total.valor_entra_usd = redondear(total.valor_entra_usd + valorEntra);
  }
  total.neto_usd = redondear(total.valor_entra_usd - total.valor_sale_usd);
  total.porContraparte = [...grupos.values()].sort((a, b) => b.cambios - a.cambios || b.piezas_salen + b.piezas_entran - (a.piezas_salen + a.piezas_entran) || a.nombre.localeCompare(b.nombre));
  return total;
}

/** Primer y último día (aaaa-mm-dd) del mes de una fecha «aaaa-mm-dd». */
export function limitesDelMes(fechaISO: string): { desde: string; hasta: string } {
  const [a, m] = fechaISO.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-${String(ultimo).padStart(2, '0')}` };
}
