-- Rol «supervisor»: tiene los permisos y los módulos del encargado, pero en TODOS los locales (no tiene local propio).
-- SQLite no permite cambiar un CHECK: se reconstruye `perfiles` con la lista de roles ampliada. Ninguna tabla ni vista la
-- referencia (las demás apuntan a `user`), así que borrar la vieja no dispara ningún borrado en cascada.
CREATE TABLE perfiles_nueva (
  id                    TEXT PRIMARY KEY REFERENCES user (id) ON DELETE CASCADE,
  email                 TEXT NOT NULL,
  nombre                TEXT NOT NULL,
  rol                   TEXT NOT NULL DEFAULT 'vendedor' CHECK (rol IN ('administrador', 'gerente', 'supervisor', 'encargado', 'vendedor', 'tecnico', 'contador')),
  local_id              TEXT REFERENCES locales (id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_force_logout_at  TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  debe_cambiar_clave    INTEGER NOT NULL DEFAULT 0
);

INSERT INTO perfiles_nueva (id, email, nombre, rol, local_id, status, last_force_logout_at, created_at, debe_cambiar_clave)
SELECT id, email, nombre, rol, local_id, status, last_force_logout_at, created_at, debe_cambiar_clave FROM perfiles;

DROP TABLE perfiles;
ALTER TABLE perfiles_nueva RENAME TO perfiles;
