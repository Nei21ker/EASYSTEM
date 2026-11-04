// Ayudantes compartidos por las pruebas del servidor.
import { env } from 'cloudflare:workers';
import type { Entorno } from '../../src/server/entorno';
import type { Rol } from '../../src/server/authz';

export function crearEntornoDePrueba(): Entorno {
  return env as unknown as Entorno;
}

/**
 * Deja la base de datos vacía (el plugin de Vitest ya no aísla el almacenamiento por prueba).
 * Los triggers de inmutabilidad (nómina pagada, cuadre cerrado…) impiden borrar filas, así que se quitan,
 * se vacían las tablas y se vuelven a crear, todo en un solo lote atómico. Llamarlo en `beforeEach`.
 */
export async function reiniciarBase(db: D1Database): Promise<void> {
  const triggers = await db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all<{ name: string; sql: string }>();
  const tablas = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'")
    .all<{ name: string }>();
  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys = true'),
    ...triggers.results.map((t) => db.prepare(`DROP TRIGGER "${t.name}"`)),
    ...tablas.results.map((t) => db.prepare(`DELETE FROM "${t.name}"`)),
    ...triggers.results.map((t) => db.prepare(t.sql)),
  ]);
}

export const IDS_LOCALES = {
  accesorios: '00000000-0000-4000-8000-000000000001',
  vidrios: '00000000-0000-4000-8000-000000000002',
  servicio: '00000000-0000-4000-8000-000000000003',
  controles: '00000000-0000-4000-8000-000000000004',
} as const;

/** Inserta los 4 locales (todos vigentes) para las pruebas que no necesitan la semilla completa. */
export async function sembrarLocales(db: D1Database): Promise<void> {
  const filas: [string, string, string][] = [
    [IDS_LOCALES.accesorios, 'Local Accesorios', 'accesorios'],
    [IDS_LOCALES.vidrios, 'Local Vidrios', 'vidrios'],
    [IDS_LOCALES.servicio, 'Local Servicio Técnico', 'servicio_tecnico'],
    [IDS_LOCALES.controles, 'Local de controles', 'controles'],
  ];
  await db.batch(filas.map(([id, nombre, tipo]) => db.prepare('INSERT INTO locales (id, nombre, tipo) VALUES (?, ?, ?)').bind(id, nombre, tipo)));
}

const ORIGEN_PRUEBAS = 'http://localhost:8787';
let contadorUsuarios = 0;

export interface UsuarioDePrueba {
  id: string;
  email: string;
  clave: string;
  /** Cookie de sesión lista para enviarla en una petición */
  cookie: string;
}

/** Crea un usuario con el rol y local indicados e inicia su sesión (devuelve su cookie). */
export async function crearUsuarioDePrueba(
  entorno: Entorno,
  opciones: { rol: Rol; localId: string | null; nombre?: string }
): Promise<UsuarioDePrueba> {
  const { crearAuth, crearUsuarioInterno } = await import('../../src/server/auth');
  contadorUsuarios += 1;
  const email = `${opciones.rol}${contadorUsuarios}@prueba.com`;
  const clave = 'Clave-de-prueba-123';
  const id = await crearUsuarioInterno(entorno, { email, nombre: opciones.nombre ?? `Usuario ${opciones.rol}`, clave, rol: opciones.rol, localId: opciones.localId });
  const respuesta = await crearAuth(entorno, ORIGEN_PRUEBAS).handler(
    new Request(`${ORIGEN_PRUEBAS}/api/auth/sign-in/email`, {
      method: 'POST',
      // Una dirección distinta por usuario: el limitador de intentos cuenta por dirección y las pruebas inician muchas sesiones
      headers: { 'content-type': 'application/json', origin: ORIGEN_PRUEBAS, 'cf-connecting-ip': `10.0.${Math.floor(contadorUsuarios / 250)}.${contadorUsuarios % 250}` },
      body: JSON.stringify({ email, password: clave }),
    })
  );
  const cookie = (respuesta.headers.get('set-cookie') ?? '').split(';')[0];
  return { id, email, clave, cookie };
}

/** Petición a la API con la cookie de un usuario de prueba. */
export function peticionComo(usuario: UsuarioDePrueba | null, ruta = '/api/prueba', init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (usuario) headers.set('cookie', usuario.cookie);
  return new Request(`${ORIGEN_PRUEBAS}${ruta}`, { ...init, headers });
}
