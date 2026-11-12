-- Cambio de mercancía con otro local (Local Vidrios): se entrega mercancía a cambio de otra (p. ej. 5 vidrios de un modelo por 5 de otro).
--
-- No es una venta, una compra ni un traslado entre locales propios: los movimientos que genera usan los tipos TRASLADO_SALIDA / TRASLADO_ENTRADA
-- (no cuentan en los reportes ni en Inversión) con el motivo «Cambio #N con <contraparte>». Cada cambio guarda lo que SALE y lo que ENTRA
-- (copia del producto, su precio de catálogo de ese día y los códigos de pieza que se movieron).
--
-- Estados: COMPLETADO (se entregó y se recibió) · EN_ESPERA (solo uno de los dos lados ya se movió; `lado_pendiente` dice cuál falta:
-- 'SALEN' = todavía no entregamos lo nuestro, 'ENTRAN' = todavía no recibimos lo suyo) · ANULADO (se revirtió o se canceló).
CREATE TABLE intercambios (
  id                    TEXT PRIMARY KEY,
  folio                 INTEGER NOT NULL UNIQUE,
  local_id              TEXT NOT NULL REFERENCES locales (id),
  contraparte           TEXT NOT NULL CHECK (length(contraparte) BETWEEN 2 AND 80),
  nota                  TEXT CHECK (nota IS NULL OR length(nota) <= 300),
  estado                TEXT NOT NULL CHECK (estado IN ('COMPLETADO', 'EN_ESPERA', 'ANULADO')),
  lado_pendiente        TEXT CHECK (lado_pendiente IS NULL OR lado_pendiente IN ('SALEN', 'ENTRAN')),
  salen                 TEXT NOT NULL CHECK (json_valid(salen)),
  entran                TEXT NOT NULL CHECK (json_valid(entran)),
  valor_sale_usd        REAL NOT NULL DEFAULT 0,
  valor_entra_usd       REAL NOT NULL DEFAULT 0,
  creado_por            TEXT,
  creado_por_nombre     TEXT NOT NULL,
  fecha                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completado_en         TEXT,
  completado_por_nombre TEXT,
  anulado_en            TEXT,
  anulado_por_nombre    TEXT,
  nota_cierre           TEXT CHECK (nota_cierre IS NULL OR length(nota_cierre) <= 300)
);
CREATE INDEX intercambios_local_fecha_idx ON intercambios (local_id, fecha DESC);
CREATE INDEX intercambios_estado_idx ON intercambios (local_id, estado);
