-- Referencia corta de cada producto: el prefijo de sus piezas + un numero consecutivo por prefijo (INF-001, TEC-001...).
-- Es un dato EXTRA para personas: el codigo de barras del producto (EAN-13) sigue existiendo para el empaque de fabrica.
-- La numeracion de los productos que ya existen la hace la migracion 0010 (idempotente).
ALTER TABLE productos ADD COLUMN referencia TEXT;
CREATE UNIQUE INDEX idx_productos_referencia ON productos (referencia);
