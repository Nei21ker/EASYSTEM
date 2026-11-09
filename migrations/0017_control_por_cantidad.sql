-- Productos "por cantidad": mercancía muy barata y desechable (p. ej. vidrios sencillos de $1 a $3) que no lleva etiqueta por
-- pieza. Su stock es solo un número por local (inventario_local): no hay filas en unidades_producto, se vende por cantidad (sin
-- escanear cada pieza) y se controla con conteos. Cualquier otro producto sigue igual (una pieza = un código = una etiqueta).
ALTER TABLE productos ADD COLUMN control_por_cantidad INTEGER NOT NULL DEFAULT 0;

-- Mermas: piezas de productos por cantidad que se botaron (defectuosas o dañadas). Cada una es también un movimiento BAJA
-- (baja el stock); esta tabla guarda QUIÉN, POR QUÉ y de dónde salió, para saber cuántos se pierden por modelo y por persona.
CREATE TABLE mermas (
  id                TEXT PRIMARY KEY,
  movimiento_id     TEXT NOT NULL,
  producto_id       TEXT NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  local_id          TEXT NOT NULL REFERENCES locales (id),
  cantidad          INTEGER NOT NULL CHECK (cantidad > 0),
  -- VENTA: salió al vender (el cliente no pagó esa pieza) · DESCARGO: se dio de baja desde Mercancía
  origen            TEXT NOT NULL CHECK (origen IN ('VENTA', 'DESCARGO')),
  -- Opcional: DEFECTO_FABRICA (llegó defectuoso) · DANADO_AL_COLOCAR (se dañó al instalarlo) · OTRO
  motivo            TEXT CHECK (motivo IS NULL OR motivo IN ('DEFECTO_FABRICA', 'DANADO_AL_COLOCAR', 'OTRO')),
  nota              TEXT CHECK (nota IS NULL OR length(nota) <= 300),
  por_id            TEXT,
  por_nombre        TEXT NOT NULL,
  -- Quien puso su clave cuando hubo que autorizarla (3 o más piezas en una venta)
  autorizado_por    TEXT,
  autorizado_nombre TEXT,
  fecha             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX mermas_local_fecha_idx ON mermas (local_id, fecha DESC);
CREATE INDEX mermas_producto_idx ON mermas (producto_id);
