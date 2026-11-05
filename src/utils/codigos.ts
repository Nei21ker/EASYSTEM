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

// --- Códigos de UNIDAD ----------------------------------------------------------------------
// Cada unidad física lleva su propio código: el PREFIJO de su producto (2 a 4 letras, normalmente 3 de la marca: INF, TEC…) y un
// número de 6 dígitos consecutivo por prefijo: INF000001, INF000002… Es lo que dice el QR y lo que se imprime bajo el nombre, así
// que si el QR no se lee basta escribirlo (incluso abreviado: "inf14" → INF000014). Los códigos de producto (EAN-13) no se parecen.
const PATRON_UNIDAD = /^([A-Z]{2,4})(\d{6})$/;
const PATRON_ESCRITO = /^([A-Z]{2,4})(\d{1,6})$/;
// Con guion (INF-014) es la REFERENCIA de un producto, no de una pieza: por eso aquí no se acepta guion ni espacio.
const PATRON_REFERENCIA = /^([A-Z]{2,4})-(\d{1,})$/;

/** ¿Es un prefijo válido (2 a 4 letras A-Z mayúsculas)? */
export function esPrefijoValido(prefijo: string): boolean {
  return /^[A-Z]{2,4}$/.test(prefijo);
}

/** El código de la unidad número `numero` (1 a 999999) de ese prefijo: ('INF', 1) → 'INF000001'. */
export function construirCodigoUnidad(prefijo: string, numero: number): string {
  const p = prefijo.toUpperCase();
  if (!esPrefijoValido(p)) throw new Error(`Prefijo de código inválido: "${prefijo}" (deben ser de 2 a 4 letras).`);
  if (!Number.isInteger(numero) || numero < 1 || numero > 999_999) throw new Error(`Número de unidad fuera de rango: ${numero}.`);
  return `${p}${String(numero).padStart(6, '0')}`;
}

/** ¿Tiene forma de código de unidad (2 a 4 letras mayúsculas y 6 dígitos)? */
export function esCodigoUnidad(codigo: string): boolean {
  return PATRON_UNIDAD.test(codigo);
}

/** Las letras (el prefijo) de un código de unidad válido; null si no lo es. */
export function prefijoDelCodigo(codigo: string): string | null {
  return PATRON_UNIDAD.exec(codigo)?.[1] ?? null;
}

/**
 * Lo que alguien escribió o escaneó, como código de unidad: mayúsculas, sin espacios y con los ceros completados ("inf14" →
 * "INF000014"). null si no tiene forma de código de unidad (un código de barras de producto, por ejemplo).
 */
export function normalizarCodigoUnidad(texto: string): string | null {
  const m = PATRON_ESCRITO.exec(texto.trim().toUpperCase());
  if (!m) return null;
  const numero = Number(m[2]);
  return numero > 0 ? `${m[1]}${String(numero).padStart(6, '0')}` : null;
}

/** Número de referencia de producto: 3 dígitos como mínimo (INF-007) y 4 o más pasado el 999. */
export function construirReferencia(prefijo: string, numero: number): string {
  const p = prefijo.toUpperCase();
  if (!esPrefijoValido(p)) throw new Error(`Prefijo de código inválido: "${prefijo}" (deben ser de 2 a 4 letras).`);
  if (!Number.isInteger(numero) || numero < 1) throw new Error(`Número de referencia fuera de rango: ${numero}.`);
  return `${p}-${String(numero).padStart(3, '0')}`;
}

/** Lo escrito como referencia de producto ("inf-7" → "INF-007"); null si no tiene esa forma (INF-... con guion). */
export function normalizarReferencia(texto: string): string | null {
  const m = PATRON_REFERENCIA.exec(texto.trim().toUpperCase());
  if (!m) return null;
  const numero = Number(m[2]);
  return numero > 0 ? construirReferencia(m[1], numero) : null;
}

const sinAcentos = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '');
const soloLetras = (t: string) => sinAcentos(t).toUpperCase().replace(/[^A-Z]/g, '');

/**
 * El prefijo que se sugiere para un producto: las 3 primeras letras de la marca que aparece (como palabra entera) en su nombre; si
 * no hay, las de su categoría; si tampoco, GEN. Es solo una sugerencia: se puede cambiar al crear el producto.
 */
export function sugerirPrefijo(nombre: string, categoria: string, marcas: string[]): string {
  const nombreLimpio = sinAcentos(nombre).toLowerCase();
  const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const comoPalabra = (palabra: string) => new RegExp(`(^|[^a-z0-9])${escapar(palabra)}([^a-z0-9]|$)`).test(nombreLimpio);
  const encontradas = marcas.filter((m) => comoPalabra(sinAcentos(m).toLowerCase())).sort((a, b) => b.length - a.length);
  // Un iPhone sin la marca escrita (el catálogo lo llama Apple) se codifica IPH, como lo hace la migración 0008
  const iphone = encontradas.length === 0 && comoPalabra('iphone') ? ['iPhone'] : [];
  for (const origen of [...encontradas.slice(0, 1), ...iphone, categoria]) {
    const letras = soloLetras(origen).slice(0, 3);
    if (letras.length >= 2) return letras;
  }
  return 'GEN';
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

/**
 * Lo que se muestra como "código" de un producto en listas y buscadores: su referencia corta (INF-001) y, si todavía no la
 * tiene, su código de barras. El código de barras sigue existiendo (empaque de fábrica, productos repetidos) pero es largo.
 */
export function codigoVisible(p: { referencia?: string | null; codigo_barras: string }): string {
  return p.referencia || p.codigo_barras;
}
