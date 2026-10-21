// Generador de códigos de barras en SVG, sin dependencias, para imprimir etiquetas.
//
// Simbologías (se elige sola según el código del producto):
//  · EAN-13  — los códigos internos de la tienda (prefijo 20, ver utils/codigos.ts) y los de fábrica de 13 dígitos.
//  · UPC-A   — 12 dígitos: es un EAN-13 con un 0 delante, se dibuja igual y los lectores lo leen como UPC-A.
//  · EAN-8   — 8 dígitos.
//  · Code 128 (juego B) — cualquier otro texto ASCII imprimible: así ningún código de fábrica queda sin etiqueta.
// Todo se calcula como una cadena de "módulos" ('1' = barra, '0' = espacio) que luego se pinta como rectángulos.

export type Simbologia = 'EAN13' | 'EAN8' | 'CODE128';

// --- EAN / UPC ---------------------------------------------------------------
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN13_PARIDAD = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Dígito verificador EAN/UPC: ponderación 3-1 desde la derecha del cuerpo (sin el verificador). */
function digitoVerificador(cuerpo: string): number {
  let suma = 0;
  for (let i = 0; i < cuerpo.length; i++) {
    const desdeDerecha = cuerpo.length - 1 - i;
    suma += Number(cuerpo[i]) * (desdeDerecha % 2 === 0 ? 3 : 1);
  }
  return (10 - (suma % 10)) % 10;
}

const verificadorCorrecto = (codigo: string) => digitoVerificador(codigo.slice(0, -1)) === Number(codigo.slice(-1));

export function esEAN13(codigo: string): boolean {
  return /^\d{13}$/.test(codigo) && verificadorCorrecto(codigo);
}
export function esUPCA(codigo: string): boolean {
  return /^\d{12}$/.test(codigo) && verificadorCorrecto(codigo);
}
export function esEAN8(codigo: string): boolean {
  return /^\d{8}$/.test(codigo) && verificadorCorrecto(codigo);
}

export function modulosEAN13(codigo: string): string {
  const paridad = EAN13_PARIDAD[Number(codigo[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (paridad[i - 1] === 'L' ? EAN_L : EAN_G)[Number(codigo[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(codigo[i])];
  return bits + '101';
}

export function modulosEAN8(codigo: string): string {
  let bits = '101';
  for (let i = 0; i < 4; i++) bits += EAN_L[Number(codigo[i])];
  bits += '01010';
  for (let i = 4; i < 8; i++) bits += EAN_R[Number(codigo[i])];
  return bits + '101';
}

// --- Code 128 (juego B) ----------------------------------------------------------
// Anchos de barra/espacio de cada símbolo (0–106; el 106 es la parada, de 13 módulos).
const CODE128_ANCHOS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const CODE128_INICIO_B = 104;
const CODE128_PARADA = 106;

function modulosDeAnchos(anchos: string): string {
  let bits = '';
  let barra = true;
  for (const ancho of anchos) {
    bits += (barra ? '1' : '0').repeat(Number(ancho));
    barra = !barra;
  }
  return bits;
}

/** null si el texto trae caracteres que el juego B no puede representar (fuera de ASCII 32–126). */
export function modulosCode128(texto: string): string | null {
  if (!texto || !/^[\x20-\x7e]+$/.test(texto)) return null;
  const valores = [...texto].map((c) => c.charCodeAt(0) - 32);
  let suma = CODE128_INICIO_B;
  valores.forEach((v, i) => (suma += v * (i + 1)));
  const verificador = suma % 103;
  return [CODE128_INICIO_B, ...valores, verificador, CODE128_PARADA].map((v) => modulosDeAnchos(CODE128_ANCHOS[v])).join('');
}

// --- API pública ------------------------------------------------------------------
export interface CodigoDibujable {
  simbologia: Simbologia;
  /** Módulos '1'/'0' (sin zonas de silencio) */
  modulos: string;
}

/** Elige la simbología del código; null si no se puede dibujar (p. ej. vacío o con caracteres raros). */
export function codificarCodigoBarras(codigo: string): CodigoDibujable | null {
  const limpio = codigo.trim();
  if (esEAN13(limpio)) return { simbologia: 'EAN13', modulos: modulosEAN13(limpio) };
  if (esUPCA(limpio)) return { simbologia: 'EAN13', modulos: modulosEAN13(`0${limpio}`) };
  if (esEAN8(limpio)) return { simbologia: 'EAN8', modulos: modulosEAN8(limpio) };
  const modulos = modulosCode128(limpio);
  return modulos ? { simbologia: 'CODE128', modulos } : null;
}

const ZONA_SILENCIO = 10; // módulos en blanco a cada lado (los lectores la necesitan)

/**
 * SVG del código (solo las barras; el número va aparte en el HTML de la etiqueta). Se estira al ancho de su
 * contenedor: `preserveAspectRatio="none"` mantiene las proporciones entre barras, que es lo que lee el escáner.
 */
export function svgCodigoBarras(codigo: string, alto = 40): string | null {
  const dibujable = codificarCodigoBarras(codigo);
  if (!dibujable) return null;

  const { modulos } = dibujable;
  const ancho = modulos.length + ZONA_SILENCIO * 2;
  let rectas = '';
  let inicio = -1;
  for (let i = 0; i <= modulos.length; i++) {
    const barra = i < modulos.length && modulos[i] === '1';
    if (barra && inicio < 0) inicio = i;
    if (!barra && inicio >= 0) {
      rectas += `<rect x="${inicio + ZONA_SILENCIO}" y="0" width="${i - inicio}" height="${alto}"/>`;
      inicio = -1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Código de barras ${codigo.trim()}" fill="#000">${rectas}</svg>`;
}
