-- Las pérdidas de vidrios (mermas: piezas defectuosas marcadas al cobrar o dadas de baja por cantidad en Descargo) aparecen solas como
-- PÉRDIDA en Inversión. Para valorarlas se guarda, al registrar la merma, el valor de UNA pieza en dólares: el precio de compra del
-- producto si lo tiene cargado (> 0) y, si no, su precio de venta. Así el monto no cambia después aunque el precio del producto
-- (o el equivalente en $ de un precio fijo en Bs) se mueva. NULL = sin valorar (se toma como 0).
ALTER TABLE mermas ADD COLUMN valor_unitario_usd REAL;

UPDATE mermas
   SET valor_unitario_usd = (SELECT CASE WHEN p.precio_compra > 0 THEN p.precio_compra ELSE p.precio_venta END FROM productos p WHERE p.id = mermas.producto_id)
 WHERE valor_unitario_usd IS NULL;
