-- Traslados entre locales de productos que se controlan por cantidad (vidrios sencillos): no tienen código por pieza, así que el
-- traslado lleva «producto + cuántas» en vez de piezas escaneadas. Mismo flujo de dos pasos que las piezas con código:
--   despachar (sale del stock del origen) → recibir (entra al stock del destino, total o parcial) → cerrar (lo que no llegó vuelve al origen).
-- El CHECK impide recibir o devolver más de lo despachado (si dos operaciones chocan, el lote entero aborta).
CREATE TABLE traslado_cantidades (
  traslado_id     TEXT NOT NULL REFERENCES traslados (id) ON DELETE CASCADE,
  producto_id     TEXT NOT NULL REFERENCES productos (id),
  producto_nombre TEXT NOT NULL,
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  recibida        INTEGER NOT NULL DEFAULT 0,
  devuelta        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (traslado_id, producto_id),
  CHECK (recibida >= 0 AND devuelta >= 0 AND recibida + devuelta <= cantidad)
);
