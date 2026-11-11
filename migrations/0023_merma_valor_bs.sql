-- Los vidrios por cantidad con precio FIJO en bolívares no se pueden mostrar convertidos a la tasa BCV: su valor está en Bs.
-- Al registrar una merma se guarda también el valor de UNA pieza en bolívares (`valor_unitario_bs`) cuando el producto tiene precio fijo
-- en Bs y no tiene costo de compra cargado (si hay costo, manda el costo en dólares). NULL = se valora en dólares a la tasa BCV.
ALTER TABLE mermas ADD COLUMN valor_unitario_bs REAL;

UPDATE mermas
   SET valor_unitario_bs = (SELECT p.precio_bs FROM productos p WHERE p.id = mermas.producto_id AND p.moneda_precio = 'BS' AND p.precio_bs > 0 AND p.precio_compra <= 0)
 WHERE valor_unitario_bs IS NULL;
