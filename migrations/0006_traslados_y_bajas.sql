-- Descargo de mercancía: traslados entre locales (en dos pasos: despachar y recibir) y bajas de piezas (dañadas, usadas, en garantía).
--
-- Una pieza tiene ahora cuatro estados:  DISPONIBLE (cuenta en el stock del local) · VENDIDA · EN_TRANSITO (salió de un local y
-- aún no la recibe el otro: no se puede vender en ninguno) · BAJA (retirada del inventario por daño, uso o garantía).
-- El stock de un local sigue siendo igual a sus unidades DISPONIBLES; lo mueven solo los movimientos de inventario:
--   TRASLADO_SALIDA (despacho: baja el stock del origen) · TRASLADO_ENTRADA (recepción, o devolución de lo que no llegó: sube el
--   stock del local) · BAJA (baja el stock). Ninguno cuenta como venta ni como compra en los reportes.
--
-- SQLite no permite cambiar un CHECK: las dos tablas se reconstruyen (sin perder filas ni su orden de llegada).

-- ---------------------------------------------------------------------------
-- movimientos_inventario: nuevos tipos
-- ---------------------------------------------------------------------------
CREATE TABLE movimientos_inventario_nueva (
  id             TEXT PRIMARY KEY,
  producto_id    TEXT NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA', 'TRASLADO_SALIDA', 'TRASLADO_ENTRADA', 'BAJA')),
  cantidad       INTEGER NOT NULL CHECK (cantidad > 0),
  fecha          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  motivo         TEXT,
  local_id       TEXT NOT NULL REFERENCES locales (id),
  unidad_codigos TEXT CHECK (unidad_codigos IS NULL OR json_valid(unidad_codigos))
);
INSERT INTO movimientos_inventario_nueva (id, producto_id, tipo, cantidad, fecha, motivo, local_id, unidad_codigos)
  SELECT id, producto_id, tipo, cantidad, fecha, motivo, local_id, unidad_codigos FROM movimientos_inventario ORDER BY rowid;
DROP TABLE movimientos_inventario;
ALTER TABLE movimientos_inventario_nueva RENAME TO movimientos_inventario;
CREATE INDEX movimientos_producto_idx ON movimientos_inventario (producto_id);
CREATE INDEX movimientos_local_fecha_idx ON movimientos_inventario (local_id, fecha DESC);

-- Stock: lo que sale de un local (venta, despacho de un traslado o baja) no puede superar lo que hay en ESE local
CREATE TRIGGER trg_mov_validar_salida
BEFORE INSERT ON movimientos_inventario
WHEN NEW.tipo IN ('SALIDA', 'TRASLADO_SALIDA', 'BAJA')
BEGIN
  SELECT RAISE(ABORT, 'Stock insuficiente para el producto en este local')
  WHERE COALESCE((SELECT stock_actual FROM inventario_local WHERE local_id = NEW.local_id AND producto_id = NEW.producto_id), 0) < NEW.cantidad;
END;

-- Stock: el movimiento actualiza el stock del local y el total del producto (nunca se escribe a mano)
CREATE TRIGGER trg_mov_aplicar
AFTER INSERT ON movimientos_inventario
BEGIN
  INSERT OR IGNORE INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo) VALUES (NEW.local_id, NEW.producto_id, 0, 0);
  UPDATE inventario_local
    SET stock_actual = stock_actual + CASE WHEN NEW.tipo IN ('ENTRADA', 'TRASLADO_ENTRADA') THEN NEW.cantidad ELSE -NEW.cantidad END
    WHERE local_id = NEW.local_id AND producto_id = NEW.producto_id;
  UPDATE productos
    SET stock_actual = stock_actual + CASE WHEN NEW.tipo IN ('ENTRADA', 'TRASLADO_ENTRADA') THEN NEW.cantidad ELSE -NEW.cantidad END
    WHERE id = NEW.producto_id;
END;

-- ---------------------------------------------------------------------------
-- unidades_producto: estados EN_TRANSITO y BAJA, y los datos de la baja
-- ---------------------------------------------------------------------------
CREATE TABLE unidades_producto_nueva (
  id                 TEXT PRIMARY KEY,
  producto_id        TEXT NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  local_id           TEXT NOT NULL REFERENCES locales (id),
  codigo             TEXT NOT NULL UNIQUE,
  estado             TEXT NOT NULL DEFAULT 'DISPONIBLE' CHECK (estado IN ('DISPONIBLE', 'VENDIDA', 'EN_TRANSITO', 'BAJA')),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  vendida_en         TEXT,
  impresa_en         TEXT,
  reimpresiones      INTEGER NOT NULL DEFAULT 0,
  ultima_reimpresion TEXT,
  -- Solo cuando estado = BAJA
  baja_motivo        TEXT CHECK (baja_motivo IS NULL OR baja_motivo IN ('DANADA', 'USADA', 'GARANTIA')),
  baja_nota          TEXT,
  baja_en            TEXT,
  baja_por           TEXT
);
INSERT INTO unidades_producto_nueva (id, producto_id, local_id, codigo, estado, created_at, vendida_en, impresa_en, reimpresiones, ultima_reimpresion)
  SELECT id, producto_id, local_id, codigo, estado, created_at, vendida_en, impresa_en, reimpresiones, ultima_reimpresion FROM unidades_producto ORDER BY rowid;
DROP TABLE unidades_producto;
ALTER TABLE unidades_producto_nueva RENAME TO unidades_producto;
CREATE INDEX unidades_disponibles_idx ON unidades_producto (producto_id, local_id, estado, created_at);
CREATE INDEX unidades_local_idx ON unidades_producto (local_id, estado);

-- Unidades: vender una ya vendida (o reactivar una ya disponible) aborta todo el lote.
-- Solo salta cuando la sentencia fija `estado`; marcar `impresa_en` no la dispara.
CREATE TRIGGER trg_unidad_ya_vendida
BEFORE UPDATE OF estado ON unidades_producto
WHEN OLD.estado = 'VENDIDA' AND NEW.estado = 'VENDIDA'
BEGIN
  SELECT RAISE(ABORT, 'Alguna de las unidades escaneadas ya no está disponible (se vendió, es de otro local o de otro producto).');
END;

CREATE TRIGGER trg_unidad_ya_disponible
BEFORE UPDATE OF estado ON unidades_producto
WHEN OLD.estado = 'DISPONIBLE' AND NEW.estado = 'DISPONIBLE'
BEGIN
  SELECT RAISE(ABORT, 'Alguna de las unidades indicadas no está vendida o no pertenece a este producto.');
END;

-- Una pieza solo pasa DISPONIBLE ↔ VENDIDA / EN_TRANSITO / BAJA (nunca directo entre los otros tres, ni a su mismo estado):
-- si dos operaciones chocan por la misma pieza (la vende un cajero mientras la despacha otro), la segunda aborta todo su lote.
CREATE TRIGGER trg_unidad_transicion
BEFORE UPDATE OF estado ON unidades_producto
WHEN NEW.estado <> OLD.estado
 AND NOT ((OLD.estado = 'DISPONIBLE' AND NEW.estado IN ('VENDIDA', 'EN_TRANSITO', 'BAJA'))
       OR (NEW.estado = 'DISPONIBLE' AND OLD.estado IN ('VENDIDA', 'EN_TRANSITO', 'BAJA')))
BEGIN
  SELECT RAISE(ABORT, 'Alguna de las unidades ya no está disponible para esa operación (cambió de estado).');
END;

CREATE TRIGGER trg_unidad_mismo_estado
BEFORE UPDATE OF estado ON unidades_producto
WHEN NEW.estado = OLD.estado AND OLD.estado IN ('EN_TRANSITO', 'BAJA')
BEGIN
  SELECT RAISE(ABORT, 'Alguna de las unidades ya no está disponible para esa operación (cambió de estado).');
END;

-- ---------------------------------------------------------------------------
-- Traslados entre locales
-- ---------------------------------------------------------------------------
CREATE TABLE traslados (
  id               TEXT PRIMARY KEY,
  folio            INTEGER NOT NULL UNIQUE,
  origen_local_id  TEXT NOT NULL REFERENCES locales (id),
  destino_local_id TEXT NOT NULL REFERENCES locales (id),
  -- EN_TRANSITO: despachado, falta recibir (todo o parte) · RECIBIDO: cerrado con piezas recibidas · ANULADO: cerrado sin recibir nada
  estado           TEXT NOT NULL DEFAULT 'EN_TRANSITO' CHECK (estado IN ('EN_TRANSITO', 'RECIBIDO', 'ANULADO')),
  creado_en        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  enviado_por      TEXT NOT NULL,
  recibido_en      TEXT,
  recibido_por     TEXT,
  cerrado_en       TEXT,
  notas            TEXT CHECK (notas IS NULL OR length(notas) <= 300),
  CHECK (origen_local_id <> destino_local_id)
);
CREATE INDEX traslados_origen_idx ON traslados (origen_local_id, estado);
CREATE INDEX traslados_destino_idx ON traslados (destino_local_id, estado);

-- Las piezas de cada traslado (con el nombre del producto tal como estaba al despachar)
CREATE TABLE traslado_unidades (
  traslado_id     TEXT NOT NULL REFERENCES traslados (id) ON DELETE CASCADE,
  codigo          TEXT NOT NULL,
  producto_id     TEXT NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  producto_nombre TEXT NOT NULL,
  recibida_en     TEXT,
  -- Piezas que no llegaron y se devolvieron al local de origen al cerrar el traslado
  devuelta_en     TEXT,
  PRIMARY KEY (traslado_id, codigo)
);
CREATE INDEX traslado_unidades_codigo_idx ON traslado_unidades (codigo);
