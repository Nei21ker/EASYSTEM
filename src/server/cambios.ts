// Versiones por tabla y local para la actualización en vivo (/api/cambios, tarea 16).
// Cada escritura agrega estas sentencias a su `db.batch`: así la versión sube si y solo si la escritura se confirma.
export function sentenciasCambio(db: D1Database, tablas: string[], localId: string | null): D1PreparedStatement[] {
  return [...new Set(tablas)].map((tabla) =>
    db
      .prepare('INSERT INTO cambios (tabla, local_id, version) VALUES (?, ?, 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1')
      .bind(tabla, localId ?? '')
  );
}

/**
 * Sube la versión DESPUÉS de una escritura que no va en un batch propio (catálogo, tasas, usuarios).
 * No es atómico con la escritura: si el Worker muriera entre las dos, la pantalla se actualizaría
 * al volver a verse la pestaña (el cliente siempre vuelve a consultar al ver la pestaña de nuevo).
 */
export async function avisarCambio(db: D1Database, tablas: string[], localId: string | null = null): Promise<void> {
  await db.batch(sentenciasCambio(db, tablas, localId));
}
