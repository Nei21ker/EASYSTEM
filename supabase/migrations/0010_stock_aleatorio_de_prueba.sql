-- ============================================================================
-- Stock aleatorio de PRUEBA para productos sin existencias.
--
-- Sirve para probar el punto de venta con inventario "real". Cada producto con
-- stock_actual = 0 recibe una ENTRADA de entre 3 y 25 unidades. El stock nunca
-- se escribe directo: el trigger aplicar_movimiento_inventario lo actualiza, y
-- cada carga queda registrada en Movimientos con el motivo indicado abajo.
--
-- No toca productos que ya tienen stock, así que volver a ejecutarlo no
-- reasigna cantidades. Antes de usar el sistema con inventario real, ajusta las
-- cantidades verdaderas con "Registrar entrada" o la importación CSV.
-- ============================================================================

insert into public.movimientos_inventario (producto_id, tipo, cantidad, motivo)
select id, 'ENTRADA', 3 + floor(random() * 23)::int, 'Stock de prueba (aleatorio)'
from public.productos
where stock_actual = 0;
