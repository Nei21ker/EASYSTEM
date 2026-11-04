// Hash de contraseñas con PBKDF2-SHA-256 (WebCrypto nativo del Worker: casi no consume CPU de JavaScript,
// a diferencia de bcrypt/scrypt en JS, que exceden el límite de CPU del plan gratuito).
// Formato guardado: pbkdf2$<iteraciones>$<sal base64>$<hash base64>
//
// workerd limita PBKDF2 a 100.000 iteraciones; ese es el valor que se usa.

export const ITERACIONES_PBKDF2 = 100_000;
/** Un hash guardado con más iteraciones que esto se rechaza sin calcular (evita gastar CPU con un hash manipulado). */
const ITERACIONES_MAXIMAS = 1_000_000;
const LONGITUD_SAL = 16;
const LONGITUD_HASH = 32;

function aBase64(bytes: Uint8Array): string {
  let texto = '';
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto);
}

function deBase64(texto: string): Uint8Array | null {
  try {
    const binario = atob(texto);
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function derivar(clave: string, sal: Uint8Array, iteraciones: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal as BufferSource, iterations: iteraciones },
    material,
    LONGITUD_HASH * 8
  );
  return new Uint8Array(bits);
}

/** Comparación en tiempo constante (no se detiene en el primer byte distinto). */
function iguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a[i] ^ b[i];
  return diferencia === 0;
}

export async function hashearClave(clave: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(LONGITUD_SAL));
  const hash = await derivar(clave, sal, ITERACIONES_PBKDF2);
  return `pbkdf2$${ITERACIONES_PBKDF2}$${aBase64(sal)}$${aBase64(hash)}`;
}

export async function verificarClave(clave: string, hashGuardado: string): Promise<boolean> {
  const partes = hashGuardado.split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;
  const iteraciones = Number(partes[1]);
  if (!Number.isInteger(iteraciones) || iteraciones < 1 || iteraciones > ITERACIONES_MAXIMAS) return false;
  const sal = deBase64(partes[2]);
  const esperado = deBase64(partes[3]);
  if (!sal || !esperado || sal.length === 0 || esperado.length === 0) return false;
  const calculado = await derivar(clave, sal, iteraciones);
  return iguales(calculado, esperado);
}
