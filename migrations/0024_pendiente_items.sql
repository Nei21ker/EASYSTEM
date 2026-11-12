-- Mercancía pendiente con productos del inventario: al anotar lo que un promotor se llevó se pueden elegir productos del inventario
-- (producto, nombre, cantidad y precio de catálogo en ese momento). `items` es un JSON con esa lista (NULL = pendiente escrito solo con
-- texto, como antes). Mientras está PENDIENTE no toca el stock ("en espera"); al marcarla pagada el servidor descuenta del inventario
-- del local una SALIDA por producto.
ALTER TABLE pendientes ADD COLUMN items TEXT;
