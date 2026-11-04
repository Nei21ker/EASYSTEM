// Utilidades del servidor compartidas por todos los módulos.

export function nuevoId(): string {
  return crypto.randomUUID();
}

/** Fecha y hora actual en ISO-8601 UTC (el formato de todas las columnas de fecha de D1). */
export function ahoraISO(): string {
  return new Date().toISOString();
}

/** Dos decimales, igual que el redondeo del cliente (dinero en dólares). */
export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sentencia que incrementa un contador y devuelve el nuevo valor (`RETURNING valor`). Va dentro de un `db.batch`
 * junto con la fila que usa el número (folio de venta, secuencia de códigos de unidad…), así que ambos se confirman
 * o se revierten juntos y dos peticiones nunca reciben el mismo número.
 */
export function sentenciaContador(db: D1Database, nombre: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO contadores (nombre, valor) VALUES (?, 1) ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1 RETURNING valor')
    .bind(nombre);
}
