-- ============================================================================
-- EASYSTEM en Cloudflare D1 (SQLite): esquema completo.
--
-- Conversión desde las migraciones de Postgres (supabase/migrations 0001–0034):
--   uuid -> TEXT (el UUID lo genera la API) · numeric -> REAL (se redondea a 2 decimales en el código)
--   timestamptz -> TEXT ISO-8601 UTC · date -> TEXT 'aaaa-mm-dd' · jsonb / text[] -> TEXT con json_valid
--   enum / check in -> TEXT con CHECK · identity (folios) y secuencias -> tabla `contadores`.
-- No hay RLS: el aislamiento por local y rol está en src/server/authz.ts. Aquí quedan las reglas que NO deben
-- depender de que la API esté bien escrita: stock, estados de las unidades, cuadre cerrado, nómina pagada.
-- Los mensajes de error son los mismos que en Postgres.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Autenticación (Better-Auth). Las fechas son milisegundos desde 1970 (formato del adaptador Drizzle).
-- ---------------------------------------------------------------------------
CREATE TABLE user (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image         TEXT,
  createdAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL
);

CREATE TABLE session (
  id        TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  token     TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId    TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE
);
CREATE INDEX session_user_idx ON session (userId);

CREATE TABLE account (
  id                    TEXT PRIMARY KEY,
  accountId             TEXT NOT NULL,
  providerId            TEXT NOT NULL,
  userId                TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  accessToken           TEXT,
  refreshToken          TEXT,
  idToken               TEXT,
  accessTokenExpiresAt  INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope                 TEXT,
  password              TEXT,
  createdAt             INTEGER NOT NULL,
  updatedAt             INTEGER NOT NULL
);
CREATE INDEX account_user_idx ON account (userId);

CREATE TABLE verification (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  INTEGER NOT NULL,
  createdAt  INTEGER,
  updatedAt  INTEGER
);

-- ---------------------------------------------------------------------------
-- Locales y perfiles
-- ---------------------------------------------------------------------------
CREATE TABLE locales (
  id                      TEXT PRIMARY KEY,
  nombre                  TEXT NOT NULL UNIQUE,
  tipo                    TEXT NOT NULL CHECK (tipo IN ('accesorios', 'vidrios', 'servicio_tecnico', 'controles')),
  direccion               TEXT,
  telefono                TEXT,
  activo                  INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  subscription_status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (subscription_status IN ('ACTIVE', 'SUSPENDED', 'PAST_DUE')),
  subscription_expires_at TEXT
);

CREATE TABLE perfiles (
  id                    TEXT PRIMARY KEY REFERENCES user (id) ON DELETE CASCADE,
  email                 TEXT NOT NULL,
  nombre                TEXT NOT NULL,
  rol                   TEXT NOT NULL DEFAULT 'vendedor' CHECK (rol IN ('administrador', 'gerente', 'encargado', 'vendedor', 'tecnico', 'contador')),
  local_id              TEXT REFERENCES locales (id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_force_logout_at  TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE suscripcion_eventos (
  id              TEXT PRIMARY KEY,
  local_id        TEXT NOT NULL REFERENCES locales (id) ON DELETE CASCADE,
  estado_anterior TEXT,
  estado_nuevo    TEXT NOT NULL,
  vence_anterior  TEXT,
  vence_nuevo     TEXT,
  cambiado_por    TEXT REFERENCES user (id) ON DELETE SET NULL,
  fecha           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- Catálogo (compartido por todos los locales)
-- ---------------------------------------------------------------------------
CREATE TABLE modelos_telefono (
  id         TEXT PRIMARY KEY,
  marca      TEXT NOT NULL,
  modelo     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (marca, modelo)
);

CREATE TABLE productos (
  id            TEXT PRIMARY KEY,
  codigo_barras TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  categoria     TEXT NOT NULL,
  precio_compra REAL NOT NULL DEFAULT 0 CHECK (precio_compra >= 0),
  precio_venta  REAL NOT NULL DEFAULT 0 CHECK (precio_venta >= 0),
  -- Total entre todos los locales: lo mantiene el trigger de movimientos, nunca se escribe a mano
  stock_actual  INTEGER NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
  stock_minimo  INTEGER NOT NULL DEFAULT 5 CHECK (stock_minimo >= 0),
  imagen_url    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX productos_categoria_idx ON productos (categoria);

CREATE TABLE compatibilidades (
  id          TEXT PRIMARY KEY,
  producto_id TEXT NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  modelo_id   TEXT NOT NULL REFERENCES modelos_telefono (id) ON DELETE CASCADE,
  UNIQUE (producto_id, modelo_id)
);
CREATE INDEX compatibilidades_modelo_idx ON compatibilidades (modelo_id);

-- Stock y mínimo de cada producto en cada local (0 mínimo = sin control de reabastecimiento)
CREATE TABLE inventario_local (
  local_id     TEXT NOT NULL REFERENCES locales (id) ON DELETE CASCADE,
  producto_id  TEXT NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  stock_actual INTEGER NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
  stock_minimo INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  PRIMARY KEY (local_id, producto_id)
);
CREATE INDEX inventario_local_producto_idx ON inventario_local (producto_id);

CREATE TABLE movimientos_inventario (
  id             TEXT PRIMARY KEY,
  producto_id    TEXT NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA')),
  cantidad       INTEGER NOT NULL CHECK (cantidad > 0),
  fecha          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  motivo         TEXT,
  local_id       TEXT NOT NULL REFERENCES locales (id),
  -- JSON: códigos de TODAS las unidades que movió este movimiento (migración 0033 de Postgres)
  unidad_codigos TEXT CHECK (unidad_codigos IS NULL OR json_valid(unidad_codigos))
);
CREATE INDEX movimientos_producto_idx ON movimientos_inventario (producto_id);
CREATE INDEX movimientos_local_fecha_idx ON movimientos_inventario (local_id, fecha DESC);

-- Una fila por unidad física, con su propio código (EAN-13 con prefijo 21)
CREATE TABLE unidades_producto (
  id          TEXT PRIMARY KEY,
  producto_id TEXT NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  local_id    TEXT NOT NULL REFERENCES locales (id),
  codigo      TEXT NOT NULL UNIQUE,
  estado      TEXT NOT NULL DEFAULT 'DISPONIBLE' CHECK (estado IN ('DISPONIBLE', 'VENDIDA')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  vendida_en  TEXT,
  impresa_en  TEXT
);
CREATE INDEX unidades_disponibles_idx ON unidades_producto (producto_id, local_id, estado, created_at);
CREATE INDEX unidades_local_idx ON unidades_producto (local_id, estado);

-- ---------------------------------------------------------------------------
-- Ventas, devoluciones y tasa del dólar
-- ---------------------------------------------------------------------------
CREATE TABLE ventas (
  id               TEXT PRIMARY KEY,
  folio            INTEGER NOT NULL UNIQUE,
  fecha            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  local_id         TEXT NOT NULL REFERENCES locales (id),
  cliente_cedula   TEXT NOT NULL CHECK (length(cliente_cedula) BETWEEN 5 AND 20),
  cliente_nombre   TEXT NOT NULL CHECK (length(trim(cliente_nombre)) BETWEEN 3 AND 120),
  cliente_telefono TEXT NOT NULL CHECK (length(cliente_telefono) BETWEEN 7 AND 25),
  metodo_pago      TEXT NOT NULL CHECK (metodo_pago IN ('BS_PAGO_MOVIL', 'BS_PUNTO_VENTA', 'BS_EFECTIVO', 'USD_EFECTIVO', 'BINANCE_USDT', 'MIXTO')),
  total            REAL NOT NULL CHECK (total >= 0),
  -- JSON [{ producto_id, nombre, codigo_barras, cantidad, precio_unitario, unidades? }]
  items            TEXT NOT NULL CHECK (json_valid(items) AND json_type(items) = 'array'),
  pagos            TEXT CHECK (pagos IS NULL OR (json_valid(pagos) AND json_type(pagos) = 'array')),
  vuelto           TEXT CHECK (vuelto IS NULL OR (json_valid(vuelto) AND json_type(vuelto) = 'object')),
  tasa_cambio      REAL CHECK (tasa_cambio IS NULL OR tasa_cambio > 0),
  total_bs         REAL CHECK (total_bs IS NULL OR total_bs >= 0),
  vendedor_id      TEXT REFERENCES user (id) ON DELETE SET NULL,
  vendedor_nombre  TEXT
);
CREATE INDEX ventas_fecha_idx ON ventas (fecha DESC);
CREATE INDEX ventas_local_fecha_idx ON ventas (local_id, fecha DESC);

CREATE TABLE devoluciones (
  id                TEXT PRIMARY KEY,
  folio             INTEGER NOT NULL UNIQUE,
  fecha             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  local_id          TEXT NOT NULL REFERENCES locales (id),
  venta_id          TEXT NOT NULL REFERENCES ventas (id) ON DELETE RESTRICT,
  venta_folio       INTEGER NOT NULL,
  motivo            TEXT NOT NULL CHECK (length(trim(motivo)) BETWEEN 3 AND 200),
  items_devueltos   TEXT NOT NULL CHECK (json_valid(items_devueltos) AND json_type(items_devueltos) = 'array' AND json_array_length(items_devueltos) > 0),
  items_nuevos      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(items_nuevos) AND json_type(items_nuevos) = 'array'),
  total_devuelto    REAL NOT NULL CHECK (total_devuelto >= 0),
  total_nuevo       REAL NOT NULL DEFAULT 0 CHECK (total_nuevo >= 0),
  diferencia        REAL NOT NULL,
  tasa_cambio       REAL CHECK (tasa_cambio IS NULL OR tasa_cambio > 0),
  pagos             TEXT CHECK (pagos IS NULL OR (json_valid(pagos) AND json_type(pagos) = 'array')),
  vuelto            TEXT CHECK (vuelto IS NULL OR (json_valid(vuelto) AND json_type(vuelto) = 'object')),
  reembolso         TEXT CHECK (reembolso IS NULL OR (json_valid(reembolso) AND json_type(reembolso) = 'object')),
  registrado_por    TEXT REFERENCES user (id) ON DELETE SET NULL,
  registrado_nombre TEXT
);
CREATE INDEX devoluciones_venta_idx ON devoluciones (venta_id);
CREATE INDEX devoluciones_local_fecha_idx ON devoluciones (local_id, fecha DESC);

CREATE TABLE tasas_cambio (
  id                TEXT PRIMARY KEY,
  fecha             TEXT NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  tasa              REAL NOT NULL CHECK (tasa > 0 AND tasa < 10000000),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  registrado_por    TEXT REFERENCES user (id) ON DELETE SET NULL,
  registrado_nombre TEXT
);
CREATE INDEX tasas_fecha_idx ON tasas_cambio (fecha DESC, created_at DESC);

-- ---------------------------------------------------------------------------
-- Servicio técnico
-- ---------------------------------------------------------------------------
CREATE TABLE ordenes_servicio (
  id                   TEXT PRIMARY KEY,
  folio                INTEGER NOT NULL UNIQUE,
  local_id             TEXT NOT NULL REFERENCES locales (id),
  cliente_cedula       TEXT NOT NULL CHECK (length(cliente_cedula) BETWEEN 5 AND 20),
  cliente_nombre       TEXT NOT NULL CHECK (length(trim(cliente_nombre)) BETWEEN 3 AND 120),
  cliente_telefono     TEXT NOT NULL CHECK (length(cliente_telefono) BETWEEN 7 AND 25),
  equipo_marca         TEXT NOT NULL CHECK (length(trim(equipo_marca)) BETWEEN 1 AND 60),
  equipo_modelo        TEXT NOT NULL CHECK (length(trim(equipo_modelo)) BETWEEN 1 AND 80),
  equipo_imei          TEXT CHECK (equipo_imei IS NULL OR length(equipo_imei) <= 40),
  accesorios_recibidos TEXT CHECK (accesorios_recibidos IS NULL OR length(accesorios_recibidos) <= 300),
  falla_reportada      TEXT NOT NULL CHECK (length(trim(falla_reportada)) BETWEEN 3 AND 1000),
  diagnostico          TEXT CHECK (diagnostico IS NULL OR length(diagnostico) <= 1000),
  estado               TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_reparacion', 'listo', 'entregado')),
  tecnico_id           TEXT REFERENCES user (id) ON DELETE SET NULL,
  tecnico_nombre       TEXT,
  -- JSON [{ producto_id, nombre, codigo_barras, cantidad, precio_unitario, unidades? }]
  repuestos            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(repuestos) AND json_type(repuestos) = 'array'),
  mano_de_obra_usd     REAL NOT NULL DEFAULT 0 CHECK (mano_de_obra_usd >= 0),
  total_usd            REAL NOT NULL DEFAULT 0 CHECK (total_usd >= 0),
  recibida_en          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actualizada_en       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  listo_en             TEXT,
  entregada_en         TEXT,
  registrado_por       TEXT REFERENCES user (id) ON DELETE SET NULL,
  registrado_nombre    TEXT
);
CREATE INDEX ordenes_local_idx ON ordenes_servicio (local_id, recibida_en DESC);

-- ---------------------------------------------------------------------------
-- Nómina
-- ---------------------------------------------------------------------------
CREATE TABLE empleados (
  id              TEXT PRIMARY KEY,
  local_id        TEXT NOT NULL REFERENCES locales (id),
  nombre          TEXT NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 80),
  apellido        TEXT NOT NULL CHECK (length(trim(apellido)) BETWEEN 1 AND 80),
  cedula          TEXT NOT NULL UNIQUE CHECK (length(trim(cedula)) BETWEEN 5 AND 20),
  cargo           TEXT NOT NULL CHECK (length(trim(cargo)) BETWEEN 1 AND 80),
  -- Salario MENSUAL en dólares (0 en un trabajador independiente)
  salario_base    REAL NOT NULL CHECK (salario_base >= 0),
  tipo            TEXT NOT NULL DEFAULT 'FIJO' CHECK (tipo IN ('FIJO', 'INDEPENDIENTE')),
  frecuencia_pago TEXT NOT NULL DEFAULT 'QUINCENAL' CHECK (frecuencia_pago IN ('QUINCENAL', 'DIARIO')),
  estado          TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'INACTIVO')),
  fecha_ingreso   TEXT NOT NULL DEFAULT (date('now')) CHECK (fecha_ingreso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((tipo = 'FIJO' AND frecuencia_pago = 'QUINCENAL') OR (tipo = 'INDEPENDIENTE' AND frecuencia_pago = 'DIARIO'))
);
CREATE INDEX empleados_local_idx ON empleados (local_id);

CREATE TABLE nominas (
  id              TEXT PRIMARY KEY,
  empleado_id     TEXT NOT NULL REFERENCES empleados (id),
  local_id        TEXT NOT NULL REFERENCES locales (id),
  periodo_inicio  TEXT NOT NULL CHECK (periodo_inicio GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  periodo_fin     TEXT NOT NULL CHECK (periodo_fin GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  pago_base       REAL NOT NULL CHECK (pago_base >= 0),
  bonos           REAL NOT NULL DEFAULT 0 CHECK (bonos >= 0),
  deducciones     REAL NOT NULL DEFAULT 0 CHECK (deducciones >= 0),
  total_pagado    REAL NOT NULL CHECK (total_pagado >= 0),
  estado_pago     TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado_pago IN ('PENDIENTE', 'PAGADO')),
  pagado_en       TEXT,
  notas           TEXT CHECK (notas IS NULL OR length(notas) <= 500),
  -- Ruta de la captura del pago en el bucket privado de R2 (opcional)
  comprobante_path TEXT CHECK (comprobante_path IS NULL OR length(comprobante_path) <= 300),
  registrado_por  TEXT REFERENCES user (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (periodo_fin >= periodo_inicio),
  CHECK (abs(total_pagado - (pago_base + bonos - deducciones)) < 0.005),
  UNIQUE (empleado_id, periodo_inicio, periodo_fin)
);
CREATE INDEX nominas_periodo_idx ON nominas (periodo_inicio, periodo_fin);
CREATE INDEX nominas_local_idx ON nominas (local_id);

-- Productos que un trabajador independiente revendió en el día (no descuentan stock)
CREATE TABLE nomina_reventas (
  id              TEXT PRIMARY KEY,
  nomina_id       TEXT NOT NULL REFERENCES nominas (id) ON DELETE CASCADE,
  local_id        TEXT NOT NULL REFERENCES locales (id),
  producto_id     TEXT REFERENCES productos (id) ON DELETE SET NULL,
  producto_nombre TEXT NOT NULL CHECK (length(trim(producto_nombre)) BETWEEN 1 AND 200),
  producto_codigo TEXT CHECK (producto_codigo IS NULL OR length(producto_codigo) <= 60),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_lista    REAL NOT NULL CHECK (precio_lista >= 0),
  precio_vendido  REAL NOT NULL CHECK (precio_vendido >= 0),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (precio_vendido >= precio_lista)
);
CREATE INDEX nomina_reventas_nomina_idx ON nomina_reventas (nomina_id);

-- ---------------------------------------------------------------------------
-- Cuadre de caja diario
-- ---------------------------------------------------------------------------
CREATE TABLE cuadres_caja (
  id                TEXT PRIMARY KEY,
  local_id          TEXT NOT NULL REFERENCES locales (id),
  fecha             TEXT NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  estado            TEXT NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO', 'CERRADO')),
  -- JSON [{ metodo, ventas, usd, bs }]
  esperado          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(esperado) AND json_type(esperado) = 'array'),
  -- JSON [{ metodo, monto }]
  contado           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(contado) AND json_type(contado) = 'array'),
  -- JSON [{ tipo, path }]
  fotos             TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(fotos) AND json_type(fotos) = 'array'),
  notas             TEXT CHECK (notas IS NULL OR length(notas) <= 1000),
  registrado_por    TEXT REFERENCES user (id) ON DELETE SET NULL,
  registrado_nombre TEXT,
  cerrado_en        TEXT,
  cerrado_por       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (local_id, fecha)
);
CREATE INDEX cuadres_fecha_idx ON cuadres_caja (fecha DESC, local_id);

-- ---------------------------------------------------------------------------
-- Contadores (folios, secuencia de códigos de unidad) y versiones para la actualización en vivo
-- ---------------------------------------------------------------------------
CREATE TABLE contadores (
  nombre TEXT PRIMARY KEY,
  valor  INTEGER NOT NULL DEFAULT 0
);

-- Cada escritura sube la versión de la tabla tocada (local_id '' = sin local). El cliente consulta las versiones.
CREATE TABLE cambios (
  tabla    TEXT NOT NULL,
  local_id TEXT NOT NULL DEFAULT '',
  version  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tabla, local_id)
);

-- ============================================================================
-- TRIGGERS (equivalentes a los de Postgres)
-- ============================================================================

-- Stock: una SALIDA no puede superar lo que hay en ESE local
CREATE TRIGGER trg_mov_validar_salida
BEFORE INSERT ON movimientos_inventario
WHEN NEW.tipo = 'SALIDA'
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
    SET stock_actual = stock_actual + CASE NEW.tipo WHEN 'ENTRADA' THEN NEW.cantidad ELSE -NEW.cantidad END
    WHERE local_id = NEW.local_id AND producto_id = NEW.producto_id;
  UPDATE productos
    SET stock_actual = stock_actual + CASE NEW.tipo WHEN 'ENTRADA' THEN NEW.cantidad ELSE -NEW.cantidad END
    WHERE id = NEW.producto_id;
END;

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

-- Cuadre de caja
CREATE TRIGGER trg_cuadre_no_futuro
BEFORE INSERT ON cuadres_caja
WHEN NEW.fecha > date('now', '+1 day')
BEGIN
  SELECT RAISE(ABORT, 'No se puede hacer el cuadre de un día futuro.');
END;

CREATE TRIGGER trg_cuadre_cerrado
BEFORE UPDATE ON cuadres_caja
WHEN OLD.estado = 'CERRADO' AND NEW.estado = 'CERRADO'
BEGIN
  SELECT RAISE(ABORT, 'Este cuadre ya está cerrado y no se puede modificar.');
END;

CREATE TRIGGER trg_cuadre_local_dia_fijos
BEFORE UPDATE ON cuadres_caja
WHEN NEW.local_id <> OLD.local_id OR NEW.fecha <> OLD.fecha
BEGIN
  SELECT RAISE(ABORT, 'El local y el día de un cuadre no se pueden cambiar.');
END;

-- Nómina
CREATE TRIGGER trg_nomina_empleado_local
BEFORE INSERT ON nominas
BEGIN
  SELECT RAISE(ABORT, 'El empleado no existe') WHERE NOT EXISTS (SELECT 1 FROM empleados WHERE id = NEW.empleado_id);
  SELECT RAISE(ABORT, 'El local del pago debe ser el del empleado') WHERE (SELECT local_id FROM empleados WHERE id = NEW.empleado_id) <> NEW.local_id;
END;

CREATE TRIGGER trg_nomina_pagada_inmutable
BEFORE UPDATE ON nominas
WHEN OLD.estado_pago = 'PAGADO'
BEGIN
  SELECT RAISE(ABORT, 'Un pago ya registrado como PAGADO no se puede modificar');
END;

CREATE TRIGGER trg_nomina_periodo_fijo
BEFORE UPDATE ON nominas
WHEN NEW.empleado_id <> OLD.empleado_id OR NEW.periodo_inicio <> OLD.periodo_inicio OR NEW.periodo_fin <> OLD.periodo_fin
BEGIN
  SELECT RAISE(ABORT, 'No se puede cambiar el empleado ni el período de un pago');
END;

CREATE TRIGGER trg_nomina_pagada_no_se_borra
BEFORE DELETE ON nominas
WHEN OLD.estado_pago = 'PAGADO'
BEGIN
  SELECT RAISE(ABORT, 'Un pago ya registrado como PAGADO no se puede borrar');
END;

-- Las líneas de reventa de un día PAGADO no se tocan
CREATE TRIGGER trg_reventa_pagada_no_se_inserta
BEFORE INSERT ON nomina_reventas
WHEN (SELECT estado_pago FROM nominas WHERE id = NEW.nomina_id) = 'PAGADO'
BEGIN
  SELECT RAISE(ABORT, 'Un pago ya registrado como PAGADO no se puede modificar');
END;

CREATE TRIGGER trg_reventa_pagada_no_se_borra
BEFORE DELETE ON nomina_reventas
WHEN (SELECT estado_pago FROM nominas WHERE id = OLD.nomina_id) = 'PAGADO'
BEGIN
  SELECT RAISE(ABORT, 'Un pago ya registrado como PAGADO no se puede modificar');
END;

-- Órdenes de servicio
CREATE TRIGGER trg_orden_local_servicio
BEFORE INSERT ON ordenes_servicio
WHEN NOT EXISTS (SELECT 1 FROM locales WHERE id = NEW.local_id AND tipo = 'servicio_tecnico')
BEGIN
  SELECT RAISE(ABORT, 'Las órdenes de servicio solo se registran en un local de servicio técnico');
END;

CREATE TRIGGER trg_orden_local_fijo
BEFORE UPDATE ON ordenes_servicio
WHEN NEW.local_id <> OLD.local_id
BEGIN
  SELECT RAISE(ABORT, 'Una orden de servicio no puede cambiar de local');
END;

CREATE TRIGGER trg_orden_sellos
AFTER UPDATE ON ordenes_servicio
BEGIN
  UPDATE ordenes_servicio
    SET actualizada_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        listo_en = CASE
          WHEN NEW.estado = 'listo' AND OLD.estado <> 'listo' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHEN NEW.estado = 'entregado' AND OLD.estado <> 'entregado' THEN COALESCE(NEW.listo_en, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ELSE NEW.listo_en END,
        entregada_en = CASE
          WHEN NEW.estado = 'entregado' AND OLD.estado <> 'entregado' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ELSE NEW.entregada_en END
    WHERE id = NEW.id;
END;
