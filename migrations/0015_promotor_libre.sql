-- El promotor de una venta con precio de promotor ya no es un empleado registrado: quien vende anota, si los sabe, su cédula,
-- nombre y teléfono (todo opcional). `promotor_nombre` guarda nombre y apellido; `promotor_id` queda sin uso en las ventas nuevas.
ALTER TABLE ventas ADD COLUMN promotor_cedula TEXT;
ALTER TABLE ventas ADD COLUMN promotor_telefono TEXT;
