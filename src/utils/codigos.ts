// Códigos de barras internos de la tienda.
//
// Para los productos que NO traen código de fábrica generamos uno propio en
// formato EAN-13 con prefijo "20": GS1 reserva 20–29 para uso interno de
// tiendas, así que nunca choca con un código de fabricante y cualquier
// lector/impresora de etiquetas lo acepta.
//
//   2 0 SSSSSSSSSS C      S = secuencia de 10 dígitos, C = dígito verificador
//
// La misma regla existe en SQL (función public.ean13_interno, migración 0006):
// si cambias una, cambia la otra.

const PATRON_INTERNO = /^20\d{11}$/;

/** Dígito verificador EAN-13 a partir de los primeros 12 dígitos. */
export function digitoVerificadorEAN13(base12: string): number {
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (suma % 10)) % 10;
}

export function construirCodigoInterno(secuencia: number): string {
  const base = `20${String(secuencia).padStart(10, '0')}`;
  return `${base}${digitoVerificadorEAN13(base)}`;
}

/** ¿Es un código interno válido (prefijo 20, 13 dígitos, verificador correcto)? */
export function esCodigoInterno(codigo: string): boolean {
  return PATRON_INTERNO.test(codigo) && digitoVerificadorEAN13(codigo.slice(0, 12)) === Number(codigo[12]);
}

// --- Códigos de UNIDAD (migración 0033) -----------------------------------------------------
// Cada unidad física lleva su propio EAN-13 con prefijo 21 (los productos usan 20): así cualquier lector y la
// cámara lo leen, y no se confunde con el código del producto. Misma regla que la función SQL ean13_unidad.
const PATRON_UNIDAD = /^21\d{11}$/;

export function construirCodigoUnidad(secuencia: number): string {
  const base = `21${String(secuencia).padStart(10, '0')}`;
  return `${base}${digitoVerificadorEAN13(base)}`;
}

/** ¿Tiene forma de código de unidad (prefijo 21, 13 dígitos, verificador correcto)? */
export function esCodigoUnidad(codigo: string): boolean {
  return PATRON_UNIDAD.test(codigo) && digitoVerificadorEAN13(codigo.slice(0, 12)) === Number(codigo[12]);
}

function secuenciaMaxima(existentes: Iterable<string>): number {
  let max = 0;
  for (const codigo of existentes) {
    if (!esCodigoInterno(codigo)) continue;
    max = Math.max(max, Number(codigo.slice(2, 12)));
  }
  return max;
}

/** Siguiente(s) código(s) interno(s) libres, a continuación del mayor existente. */
export function generarCodigosInternos(existentes: Iterable<string>, cantidad = 1): string[] {
  const inicio = secuenciaMaxima(existentes);
  return Array.from({ length: cantidad }, (_, i) => construirCodigoInterno(inicio + i + 1));
}
