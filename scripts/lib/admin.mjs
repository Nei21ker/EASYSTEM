// Lógica pura de scripts/crear-admin.mjs (separada para poder probarla): clave aleatoria, validación y SQL del alta.
import { hashearClave } from '../../src/server/password.ts';

// Sin caracteres que se confunden al leerlos (0/O, 1/l/I)
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LONGITUD_CLAVE = 16;

/** Clave aleatoria de 16 caracteres con crypto.getRandomValues (muestreo por rechazo: sin sesgo hacia ningún carácter). */
export function generarClave() {
  const limite = 256 - (256 % ALFABETO.length);
  let clave = '';
  while (clave.length < LONGITUD_CLAVE) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limite && clave.length < LONGITUD_CLAVE) clave += ALFABETO[byte % ALFABETO.length];
    }
  }
  return clave;
}

export function validarCorreo(correo) {
  return typeof correo === 'string' && correo.length <= 254 && /^[^@\s'"`;\\]+@[^@\s'"`;\\]+\.[^@\s'"`;\\]+$/.test(correo.trim());
}

const literal = (texto) => `'${String(texto).replaceAll("'", "''")}'`;

/**
 * Las tres sentencias del alta (user + cuenta con hash PBKDF2 + perfil de administrador sin local), las mismas que ejecuta
 * crearUsuarioInterno del servidor. NUNCA incluyen la clave en claro: solo su hash.
 */
export async function sentenciasAltaAdministrador({ correo, nombre, clave, id = crypto.randomUUID(), ahora = Date.now() }) {
  const email = correo.trim().toLowerCase();
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (!validarCorreo(email)) throw new Error('Escribe un correo válido.');
  if (limpio.length < 2) throw new Error('Escribe el nombre del administrador.');
  const hash = await hashearClave(clave);
  return [
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (${literal(id)}, ${literal(limpio)}, ${literal(email)}, 1, ${ahora}, ${ahora})`,
    `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (${literal(crypto.randomUUID())}, ${literal(id)}, 'credential', ${literal(id)}, ${literal(hash)}, ${ahora}, ${ahora})`,
    `INSERT INTO perfiles (id, email, nombre, rol, local_id, status, created_at) VALUES (${literal(id)}, ${literal(email)}, ${literal(limpio)}, 'administrador', NULL, 'active', ${literal(new Date(ahora).toISOString())})`,
  ];
}
