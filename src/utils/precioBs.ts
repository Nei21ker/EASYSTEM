// Precio de venta en bolívares FIJO. Un producto puede tener su precio en dólares (se muestra en Bs con la tasa del día, como siempre)
// o en bolívares: entonces el precio que se escribe y se cambia a mano es el de Bs y NO sigue a la tasa; su precio en dólares es solo el
// equivalente de hoy (`precio_bs / tasa`) y se recalcula cada vez que se registra una tasa nueva. Todo lo demás (POS, reportes,
// autorizaciones) sigue trabajando con `precio_venta` en dólares.
import type { MonedaPrecio, Producto } from '../types/database.types';

export type { MonedaPrecio };

/** Tope razonable para un precio en bolívares (evita un cero de más al teclear). */
export const PRECIO_BS_MAXIMO = 100_000_000;

export const esMonedaPrecio = (valor: unknown): valor is MonedaPrecio => valor === 'USD' || valor === 'BS';

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Bs escritos a mano: se guardan con 2 decimales. */
export function normalizarPrecioBs(bs: number): number {
  return centavos(bs);
}

/**
 * Equivalente en dólares de un precio en bolívares. Se guarda con 6 decimales (no con centavos) para que al volver a convertir a Bs
 * con la misma tasa salga el precio exacto (1100 Bs → 1100,00 y no 1099,95).
 */
export function usdDesdeBs(bs: number, tasa: number): number {
  return Math.round((bs / tasa) * 1_000_000) / 1_000_000;
}

/** Mensaje si el precio en bolívares no es válido (mayor a 0 y dentro del tope); null si está bien. */
export function errorPrecioBs(bs: number): string | null {
  if (!Number.isFinite(bs) || !(bs > 0)) return 'El precio en bolívares debe ser mayor a 0.';
  if (bs > PRECIO_BS_MAXIMO) return 'El precio en bolívares es demasiado grande. Revisa los ceros.';
  return null;
}

/** ¿El producto tiene su precio fijado en bolívares? */
export const tienePrecioEnBs = (p: Pick<Producto, 'moneda_precio' | 'precio_bs'>): boolean => p.moneda_precio === 'BS' && (p.precio_bs ?? 0) > 0;

/** Precio en bolívares de un producto: el fijo si lo tiene, o el de dólares convertido con la tasa (null si falta la tasa). */
export function precioEnBolivares(p: Pick<Producto, 'moneda_precio' | 'precio_bs' | 'precio_venta'>, tasa: number | null | undefined): number | null {
  if (tienePrecioEnBs(p)) return p.precio_bs!;
  return tasa && tasa > 0 ? centavos(p.precio_venta * tasa) : null;
}
