-- Comprobante del pago móvil: la captura (o foto) que el cajero adjunta en el POS cuando algún cobro es "Bs pago móvil".
-- Es la ruta del archivo en el almacenamiento PRIVADO (comprobantes-pago-movil/<local>/<hora>-<n>.jpg); null en el resto de las ventas
-- (y en las anteriores a esta migración).
ALTER TABLE ventas ADD COLUMN comprobante_path TEXT;
