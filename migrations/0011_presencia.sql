-- Presencia ("Tiempo real"): una fila por usuario con la ultima vez que su navegador (pestaña visible) aviso que seguia ahi.
-- Los latidos escriben como maximo una vez cada 10 s por usuario (upsert condicional) y SIN pasar por la tabla `cambios`
-- (no hace avisar a nadie: el administrador consulta esta tabla directamente). Las filas viejas las borra limpiarPresencia.
-- Tiempos en milisegundos desde 1970 (comparaciones directas, sin convertir fechas).
CREATE TABLE presencia (
  user_id       TEXT PRIMARY KEY REFERENCES user (id) ON DELETE CASCADE,
  last_seen_at  INTEGER NOT NULL,
  -- cuando avisaron que salian (cerrar sesion o cerrar la pestaña); el siguiente latido la borra
  salio_en      INTEGER,
  ip            TEXT,
  dispositivo   TEXT,
  -- local que estaba mirando (solo administrador, gerente y contador eligen; el resto usa el de su perfil)
  local_id      TEXT,
  ruta          TEXT
);
CREATE INDEX idx_presencia_last_seen ON presencia (last_seen_at);
