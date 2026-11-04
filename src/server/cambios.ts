// Versiones por tabla y local para la actualización en vivo (/api/cambios, tarea 16).
// Cada escritura agrega estas sentencias a su `db.batch`: así la versión sube si y solo si la escritura se confirma.
export function sentenciasCambio(db: D1Database, tablas: string[], localId: string | null): D1PreparedStatement[] {
  return [...new Set(tablas)].map((tabla) =>
    db
      .prepare('INSERT INTO cambios (tabla, local_id, version) VALUES (?, ?, 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1')
      .bind(tabla, localId ?? '')
  );
}
