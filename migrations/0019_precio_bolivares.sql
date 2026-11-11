-- Precio de venta en bolívares, FIJO (no anclado a la tasa del día). Hasta ahora todo precio era en dólares y los bolívares se
-- calculaban con la tasa. Un producto con moneda_precio = 'BS' guarda su precio en `precio_bs` (el que se cambia a mano, p. ej. cada
-- semana o quincena) y su `precio_venta` en dólares pasa a ser DERIVADO: precio_bs / tasa vigente. Se recalcula solo cuando se
-- registra una tasa nueva, así todo lo demás (POS, reportes, autorizaciones de precio) sigue leyendo `precio_venta` en dólares.
-- Los productos que ya existían quedan en 'USD', sin cambios.
ALTER TABLE productos ADD COLUMN moneda_precio TEXT NOT NULL DEFAULT 'USD' CHECK (moneda_precio IN ('USD', 'BS'));
ALTER TABLE productos ADD COLUMN precio_bs REAL CHECK (precio_bs IS NULL OR precio_bs > 0);
