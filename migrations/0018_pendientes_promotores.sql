-- Promotores registrados y módulo de Pendientes (Local Vidrios).
--
-- · `promotores`: directorio de promotores (cédula única). Se llena desde Pendientes o Nómina ("Agregar promotor") y también solo,
--   cuando se vende con precio de promotor y se anota su cédula; así la próxima venta se completa sola al escribir la cédula.
--   Incluye el banco receptor (donde se le paga la comisión).
-- · `pendientes`: lo que queda por cobrar o pagar con un promotor.
--     MERCANCIA: se llevó mercancía y vendrá a pagarla (lo anota el encargado, con el monto que debe).
--     COMISION : un promotor trajo un cliente y se le debe la comisión; la crea sola la venta con precio de promotor.
--   Estado PENDIENTE → PAGADO (o ANULADO si fue un error). Guarda copia de los datos del promotor al momento de crear la fila
--   (por si la venta no tenía cédula, o el promotor se registra después).
ALTER TABLE ventas ADD COLUMN promotor_banco TEXT;

CREATE TABLE promotores (
  id                TEXT PRIMARY KEY,
  cedula            TEXT NOT NULL UNIQUE,
  nombre            TEXT NOT NULL DEFAULT '',
  apellido          TEXT NOT NULL DEFAULT '',
  telefono          TEXT,
  banco             TEXT,
  creado_por_nombre TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE pendientes (
  id                 TEXT PRIMARY KEY,
  local_id           TEXT NOT NULL REFERENCES locales (id),
  tipo               TEXT NOT NULL CHECK (tipo IN ('MERCANCIA', 'COMISION')),
  promotor_id        TEXT REFERENCES promotores (id) ON DELETE SET NULL,
  promotor_cedula    TEXT,
  promotor_nombre    TEXT,
  promotor_telefono  TEXT,
  promotor_banco     TEXT,
  descripcion        TEXT NOT NULL CHECK (length(descripcion) <= 500),
  monto_usd          REAL NOT NULL CHECK (monto_usd >= 0),
  estado             TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PAGADO', 'ANULADO')),
  -- Solo las comisiones: la venta que las originó (si la venta se elimina, la comisión pendiente desaparece con ella)
  venta_id           TEXT,
  venta_folio        INTEGER,
  creado_por         TEXT,
  creado_por_nombre  TEXT NOT NULL,
  fecha              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  cerrado_en         TEXT,
  cerrado_por_nombre TEXT,
  nota_cierre        TEXT CHECK (nota_cierre IS NULL OR length(nota_cierre) <= 300)
);
CREATE INDEX pendientes_local_estado_idx ON pendientes (local_id, estado, fecha DESC);
CREATE INDEX pendientes_promotor_idx ON pendientes (promotor_id);
CREATE INDEX pendientes_venta_idx ON pendientes (venta_id);
