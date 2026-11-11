-- Módulo de Inversión (solo administrador y gerente): lo que se invierte en mercancía NUEVA, anotado a mano, por local.
--
-- · `proveedores`: lista de proveedores (global). El nombre es único sin importar mayúsculas, acentos ni espacios de más
--   (`nombre_normalizado`). Se agregan desde la pestaña Proveedores o escribiendo un nombre nuevo al registrar una compra.
-- · `inversiones`: una fila por compra (COMPRA) o pérdida (PERDIDA) que el gerente anota. NO está ligada a la mercancía del sistema
--   (mucha mercancía vieja todavía no está cargada). Guarda el monto en dólares y la tasa BCV vigente a la fecha de la compra
--   (`tasa_bcv`, Bs por $1) para mostrar también los bolívares de referencia; si no había tasa queda en NULL.
--   `proveedor_nombre` es copia del nombre al momento de anotar (si el proveedor se borra, el registro lo conserva).
CREATE TABLE proveedores (
  id                TEXT PRIMARY KEY,
  nombre            TEXT NOT NULL,
  nombre_normalizado TEXT NOT NULL UNIQUE,
  telefono          TEXT,
  nota              TEXT,
  creado_por_nombre TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE inversiones (
  id                TEXT PRIMARY KEY,
  local_id          TEXT NOT NULL REFERENCES locales (id),
  tipo              TEXT NOT NULL CHECK (tipo IN ('COMPRA', 'PERDIDA')),
  fecha             TEXT NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  descripcion       TEXT NOT NULL CHECK (length(descripcion) <= 300),
  proveedor_id      TEXT REFERENCES proveedores (id) ON DELETE SET NULL,
  proveedor_nombre  TEXT,
  monto_usd         REAL NOT NULL CHECK (monto_usd > 0),
  tasa_bcv          REAL,
  creado_por        TEXT,
  creado_por_nombre TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX inversiones_local_fecha_idx ON inversiones (local_id, fecha DESC);
CREATE INDEX inversiones_fecha_idx ON inversiones (fecha DESC);
CREATE INDEX inversiones_proveedor_idx ON inversiones (proveedor_id);
