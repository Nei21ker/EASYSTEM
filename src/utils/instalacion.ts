// Instalación de vidrios (Local Vidrios): un servicio opcional que se cobra junto con el producto, por unidad.
//   · «LOCAL»: la instala el encargado/la tienda; el dinero es ingreso de la tienda.
//   · «PROMOTOR»: la instala el promotor; el cliente paga todo a la tienda y la tienda le entrega esa parte al promotor (queda como pendiente).
// Va en la línea de la venta (`instalacion_por` + `instalacion_usd` = precio por unidad) y SUMA al total de la venta. Reglas puras,
// compartidas por el POS, el modo demo y el servidor.
import type { VentaItem } from '../types/database.types';

export type QuienInstala = 'LOCAL' | 'PROMOTOR';

/** Lo más común: la instalación de un vidrio cuesta $3 (se puede cambiar por vidrio). */
export const INSTALACION_PREDETERMINADA_USD = 3;
export const INSTALACION_MAXIMA_USD = 100;

export const QUIEN_INSTALA: { valor: QuienInstala; nombre: string }[] = [
  { valor: 'LOCAL', nombre: 'La instala el local (encargado)' },
  { valor: 'PROMOTOR', nombre: 'La instala el promotor' },
];

type LineaInstalable = Pick<VentaItem, 'cantidad' | 'precio_unitario' | 'instalacion_por' | 'instalacion_usd'>;

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Lo que se cobra por instalar toda esa línea (precio por unidad × cantidad); 0 si no lleva instalación. */
export function montoInstalacion(linea: Pick<VentaItem, 'cantidad' | 'instalacion_por' | 'instalacion_usd'>): number {
  if (!linea.instalacion_por || !(linea.instalacion_usd && linea.instalacion_usd > 0)) return 0;
  return redondear(linea.cantidad * linea.instalacion_usd);
}

/** Lo que paga el cliente por la línea: producto + instalación. */
export const totalLinea = (linea: LineaInstalable): number => redondear(linea.cantidad * linea.precio_unitario + montoInstalacion(linea));

/** Total de la venta: Σ de las líneas con su instalación. */
export const totalDeItems = (items: LineaInstalable[]): number => redondear(items.reduce((s, i) => s + totalLinea(i), 0));

/** Instalaciones hechas por el promotor: es dinero que la tienda le entrega (se suma a lo que se le debe). */
export const instalacionDelPromotor = (items: LineaInstalable[]): number =>
  redondear(items.reduce((s, i) => s + (i.instalacion_por === 'PROMOTOR' ? montoInstalacion(i) : 0), 0));

/** Instalaciones hechas por el local: ingreso de la tienda por servicio. */
export const instalacionDelLocal = (items: LineaInstalable[]): number =>
  redondear(items.reduce((s, i) => s + (i.instalacion_por === 'LOCAL' ? montoInstalacion(i) : 0), 0));

/** ¿Alguna línea la instala el promotor? (entonces hay que saber quién es) */
export const hayInstalacionDelPromotor = (items: Pick<VentaItem, 'instalacion_por' | 'instalacion_usd'>[]): boolean =>
  items.some((i) => i.instalacion_por === 'PROMOTOR' && (i.instalacion_usd ?? 0) > 0);

/** Mensaje si el precio de la instalación no sirve; null si está bien. */
export function errorPrecioInstalacion(usd: number): string | null {
  if (!Number.isFinite(usd) || usd <= 0) return 'El precio de la instalación debe ser mayor a 0.';
  if (usd > INSTALACION_MAXIMA_USD) return `El precio de la instalación no puede pasar de $${INSTALACION_MAXIMA_USD}.`;
  return null;
}

export const nombreQuienInstala = (por: QuienInstala | undefined): string => (por === 'LOCAL' ? 'la instala el local' : por === 'PROMOTOR' ? 'la instala el promotor' : '');

/** Descripción de las instalaciones del promotor para el pendiente: «2 × Vidrio X ($3 c/u)». */
export function descripcionInstalacionPromotor(items: Pick<VentaItem, 'nombre' | 'cantidad' | 'instalacion_por' | 'instalacion_usd'>[]): string {
  const lineas = items.filter((i) => i.instalacion_por === 'PROMOTOR' && (i.instalacion_usd ?? 0) > 0).map((i) => `${i.cantidad} × ${i.nombre} ($${i.instalacion_usd} c/u)`);
  return lineas.slice(0, 3).join('; ') + (lineas.length > 3 ? `; y ${lineas.length - 3} más` : '');
}

/**
 * Lo que queda de instalación en la línea que viaja al servidor: solo si trae un tipo válido y un precio válido; si no, se descarta
 * (nunca se confía a ciegas en lo que manda el cliente).
 */
export function limpiarInstalacion<T extends Pick<VentaItem, 'instalacion_por' | 'instalacion_usd'>>(item: T): T {
  const { instalacion_por: por, instalacion_usd: usd, ...resto } = item;
  if ((por !== 'LOCAL' && por !== 'PROMOTOR') || typeof usd !== 'number' || errorPrecioInstalacion(usd)) return resto as T;
  return { ...resto, instalacion_por: por, instalacion_usd: redondear(usd) } as T;
}
