-- Pago móvil: además de la captura del comprobante, la venta puede respaldarse con la REFERENCIA del pago (los últimos 4 dígitos).
-- Una venta con cobro por pago móvil exige al menos una de las dos (lo valida el servidor).
ALTER TABLE ventas ADD COLUMN referencia_pago_movil TEXT;
