// Autenticación con Better-Auth sobre D1 (tablas user/session/account/verification de migrations/0001).
// Registro público DESHABILITADO: solo el administrador/gerente crean usuarios (crearUsuarioInterno).
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bd } from './db/cliente';
import { account, session, user, verification } from './db/schema';
import type { Entorno } from './entorno';
import { hashearClave, verificarClave } from './password';
import { nuevoId, ahoraISO } from './util';
import { ErrorApi } from './errores';
import type { Rol } from './authz';

/** Better-Auth para un origen (la dirección desde la que se sirve el sitio: cookies y orígenes de confianza). */
export function crearAuth(env: Entorno, origen: string) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origen,
    trustedOrigins: [origen],
    database: drizzleAdapter(bd(env), { provider: 'sqlite', schema: { user, session, account, verification } }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      password: { hash: hashearClave, verify: ({ hash, password }) => verificarClave(password, hash) },
    },
  });
}

export interface DatosUsuarioNuevo {
  email: string;
  nombre: string;
  clave: string;
  rol: Rol;
  localId: string | null;
}

/**
 * Crea un usuario completo (user + cuenta con hash PBKDF2 + perfil) en UN lote atómico: si el correo ya existe
 * no queda nada a medias. Es la única forma de dar de alta usuarios; ninguna ruta pública la llama.
 */
export async function crearUsuarioInterno(env: Entorno, datos: DatosUsuarioNuevo): Promise<string> {
  const email = datos.email.trim().toLowerCase();
  const nombre = datos.nombre.trim().replace(/\s+/g, ' ');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorApi(400, 'Escribe un correo válido.');
  if (nombre.length < 2) throw new ErrorApi(400, 'Escribe el nombre del usuario.');
  if (datos.clave.length < 8) throw new ErrorApi(400, 'La contraseña debe tener al menos 8 caracteres.');

  const id = nuevoId();
  const ahora = Date.now();
  const hash = await hashearClave(datos.clave);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').bind(id, nombre, email, ahora, ahora),
      env.DB
        .prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
        .bind(nuevoId(), id, id, hash, ahora, ahora),
      env.DB
        .prepare('INSERT INTO perfiles (id, email, nombre, rol, local_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, email, nombre, datos.rol, datos.localId, 'active', ahoraISO()),
    ]);
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: user\.email/i.test(err.message)) {
      throw new ErrorApi(409, 'Ya existe un usuario con ese correo.');
    }
    throw err;
  }
  return id;
}
