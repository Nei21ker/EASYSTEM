-- Venta con precio de promotor: la tienda cobra el precio que pagó el cliente (p. ej. $15) y la diferencia con el precio de lista
-- ($12) es la comisión del promotor ($3), que se le paga aparte. Solo un supervisor (encargado, gerente o administrador) puede
-- autorizar el cambio de precio, con su contraseña; la venta guarda quién lo autorizó. El promotor es un trabajador independiente
-- (empleados.tipo = 'INDEPENDIENTE'); en `items` cada línea modificada guarda además `precio_lista`.
ALTER TABLE ventas ADD COLUMN promotor_id TEXT;
ALTER TABLE ventas ADD COLUMN promotor_nombre TEXT;
ALTER TABLE ventas ADD COLUMN comision REAL NOT NULL DEFAULT 0;
ALTER TABLE ventas ADD COLUMN precio_autorizado_por TEXT;
ALTER TABLE ventas ADD COLUMN precio_autorizado_nombre TEXT;
CREATE INDEX IF NOT EXISTS idx_ventas_promotor ON ventas (promotor_id, fecha);
