// Ayudantes compartidos por las pruebas del servidor.
import { env } from 'cloudflare:workers';
import type { Entorno } from '../../src/server/entorno';

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
