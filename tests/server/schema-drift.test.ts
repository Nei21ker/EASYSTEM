// Guarda contra el desfase entre migrations/0001_d1_schema.sql y el esquema Drizzle (src/server/db/schema.ts):
// cada tabla del SQL debe tener su espejo con exactamente las mismas columnas.
import { describe, expect, it } from 'vitest';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { is, Table } from 'drizzle-orm';
import { crearEntornoDePrueba } from './ayudas';
import * as schema from '../../src/server/db/schema';

const { DB } = crearEntornoDePrueba();

const tablasDrizzle = Object.values(schema).filter((v) => is(v, Table)) as unknown as SQLiteTable[];

describe('esquema Drizzle = migración SQL', () => {
  it('cubre todas las tablas de la migración', async () => {
    const filas = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'").all<{ name: string }>();
    const sql = filas.results.map((f) => f.name).sort();
    const drizzle = tablasDrizzle.map((t) => getTableConfig(t).name).sort();
    expect(drizzle).toEqual(sql);
  });

  it.each(tablasDrizzle.map((t) => [getTableConfig(t).name, t] as const))('%s tiene las mismas columnas', async (nombre, tabla) => {
    const info = await DB.prepare(`PRAGMA table_info("${nombre}")`).all<{ name: string }>();
    const columnasSql = info.results.map((c) => c.name).sort();
    const columnasDrizzle = getTableConfig(tabla).columns.map((c) => c.name).sort();
    expect(columnasDrizzle).toEqual(columnasSql);
  });
});
