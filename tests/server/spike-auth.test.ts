// Fase 0 (spike): ¿Better-Auth arranca sobre D1 + Drizzle dentro del runtime de Workers, con el registro público
// cerrado y nuestro hasher PBKDF2? (La tarea 7 reemplaza este esquema provisional por el definitivo.)
import { beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { crearEntornoDePrueba } from './ayudas';
import { hashearClave, verificarClave } from '../../src/server/password';

const env = crearEntornoDePrueba();
const ORIGEN = 'http://localhost:8787';

const marcaDeTiempo = (nombre: string) => integer(nombre, { mode: 'timestamp_ms' }).notNull();
const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: marcaDeTiempo('createdAt'),
  updatedAt: marcaDeTiempo('updatedAt'),
});
const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: marcaDeTiempo('expiresAt'),
  token: text('token').notNull().unique(),
  createdAt: marcaDeTiempo('createdAt'),
  updatedAt: marcaDeTiempo('updatedAt'),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull(),
});
const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: marcaDeTiempo('createdAt'),
  updatedAt: marcaDeTiempo('updatedAt'),
});
const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: marcaDeTiempo('expiresAt'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }),
});

function crearAuth() {
  const bd = drizzle(env.DB);
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: ORIGEN,
    database: drizzleAdapter(bd, { provider: 'sqlite', schema: { user, session, account, verification } }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      password: { hash: hashearClave, verify: ({ hash, password }) => verificarClave(password, hash) },
    },
  });
}

const auth = crearAuth();

function peticion(ruta: string, cuerpo: unknown) {
  return auth.handler(
    new Request(`${ORIGEN}/api/auth${ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGEN },
      body: JSON.stringify(cuerpo),
    })
  );
}

beforeAll(async () => {
  // D1.exec: una sentencia por línea
  await env.DB.exec('CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)');
  await env.DB.exec('CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL)');
  await env.DB.exec('CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)');
  await env.DB.exec('CREATE TABLE IF NOT EXISTS verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER)');
});

describe('Better-Auth sobre D1 + Drizzle', () => {
  it('rechaza el registro público', async () => {
    const respuesta = await peticion('/sign-up/email', { email: 'intruso@ejemplo.com', password: 'Clave-123-abc', name: 'Intruso' });
    expect(respuesta.status).toBeGreaterThanOrEqual(400);
    const usuarios = await env.DB.prepare("SELECT count(*) AS n FROM user WHERE email = 'intruso@ejemplo.com'").first<{ n: number }>();
    expect(usuarios?.n).toBe(0);
  });

  it('inicia sesión con un usuario creado por el servidor y su clave PBKDF2', async () => {
    const contexto = await auth.$context;
    const creado = await contexto.internalAdapter.createUser({ email: 'dueno@ejemplo.com', name: 'Dueño', emailVerified: true }, { method: 'admin' });
    await contexto.internalAdapter.linkAccount({ userId: creado.id, providerId: 'credential', accountId: creado.id, password: await hashearClave('Clave-123-abc') });

    const buena = await peticion('/sign-in/email', { email: 'dueno@ejemplo.com', password: 'Clave-123-abc' });
    expect(buena.status).toBe(200);
    expect(buena.headers.get('set-cookie') ?? '').toContain('session_token');

    const mala = await peticion('/sign-in/email', { email: 'dueno@ejemplo.com', password: 'otra-clave' });
    expect(mala.status).toBeGreaterThanOrEqual(400);
  });
});
