-- Promotores por local: cada local ve en su lista (selector del cobro con precio de promotor) los promotores que se registraron en él.
-- Un promotor puede estar en varios locales (se agrega solo al vender con su cédula en otro local).
CREATE TABLE promotor_locales (
  promotor_id TEXT NOT NULL REFERENCES promotores (id) ON DELETE CASCADE,
  local_id    TEXT NOT NULL REFERENCES locales (id) ON DELETE CASCADE,
  PRIMARY KEY (promotor_id, local_id)
);
CREATE INDEX idx_promotor_locales_local ON promotor_locales (local_id);

-- Lo que ya existe: cada promotor queda en los locales donde ya tiene pendientes, ventas con su cédula o fila de nómina
INSERT OR IGNORE INTO promotor_locales (promotor_id, local_id)
  SELECT DISTINCT promotor_id, local_id FROM pendientes WHERE promotor_id IS NOT NULL;
INSERT OR IGNORE INTO promotor_locales (promotor_id, local_id)
  SELECT DISTINCT p.id, v.local_id FROM ventas v JOIN promotores p ON p.cedula = v.promotor_cedula WHERE v.promotor_cedula IS NOT NULL;
INSERT OR IGNORE INTO promotor_locales (promotor_id, local_id)
  SELECT DISTINCT promotor_id, local_id FROM empleados WHERE promotor_id IS NOT NULL;
-- Los que no tienen ningún rastro (registrados sin movimiento) van al Local Vidrios, que es donde se usan los promotores
INSERT OR IGNORE INTO promotor_locales (promotor_id, local_id)
  SELECT id, '00000000-0000-4000-8000-000000000002' FROM promotores WHERE id NOT IN (SELECT promotor_id FROM promotor_locales);
