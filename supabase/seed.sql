-- ============================================================================
-- Datos de ejemplo para desarrollo local ("supabase db reset" los vuelve a
-- aplicar). Catálogo amplio de accesorios de teléfono: forros (silicona,
-- antigolpes, MagSafe), vidrios templados (9D, cerámica, anti-espía) y
-- cargadores/cables, con compatibilidades cruzadas entre marcas.
-- Mismo catálogo que src/lib/mock-data.ts (modo LocalStorage sin Supabase).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Modelos de teléfono
-- ----------------------------------------------------------------------------
insert into public.modelos_telefono (marca, modelo) values
  ('Apple', 'iPhone 11'),
  ('Apple', 'iPhone 12'),
  ('Apple', 'iPhone 13'),
  ('Apple', 'iPhone 14'),
  ('Apple', 'iPhone 15'),
  ('Apple', 'iPhone 15 Pro Max'),
  ('Samsung', 'Galaxy A14'),
  ('Samsung', 'Galaxy A34'),
  ('Samsung', 'Galaxy A54'),
  ('Samsung', 'Galaxy S21'),
  ('Samsung', 'Galaxy S23'),
  ('Samsung', 'Galaxy S24'),
  ('Xiaomi', 'Redmi Note 11'),
  ('Xiaomi', 'Redmi Note 12'),
  ('Xiaomi', 'Redmi Note 13'),
  ('Infinix', 'Hot 30'),
  ('Infinix', 'Note 30'),
  ('Tecno', 'Spark 10'),
  ('Tecno', 'Camon 20')
on conflict (marca, modelo) do nothing;

-- ----------------------------------------------------------------------------
-- Productos
-- stock_actual arranca en 0: el stock real se establece más abajo mediante
-- movimientos_inventario, que es la única vía soportada por el trigger.
-- ----------------------------------------------------------------------------
insert into public.productos (codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_actual, stock_minimo) values
  -- Forros: silicona
  ('750001000101', 'Forro de silicona iPhone 11', 'Forros', 15, 38, 0, 6),
  ('750001000102', 'Forro de silicona Galaxy A54', 'Forros', 15, 38, 0, 5),
  ('750001000103', 'Forro de silicona Redmi Note 12', 'Forros', 14, 36, 0, 5),
  -- Forros: antigolpes
  ('750001000104', 'Forro antigolpes iPhone 12', 'Forros', 22, 55, 0, 5),
  ('750001000105', 'Forro antigolpes iPhone 13', 'Forros', 22, 55, 0, 6),
  ('750001000106', 'Forro antigolpes Galaxy A34', 'Forros', 20, 50, 0, 5),
  ('750001000107', 'Forro antigolpes Galaxy S23', 'Forros', 25, 62, 0, 4),
  ('750001000108', 'Forro antigolpes Redmi Note 13', 'Forros', 20, 50, 0, 5),
  ('750001000109', 'Forro antigolpes Infinix Hot 30', 'Forros', 18, 45, 0, 5),
  -- Forros: MagSafe
  ('750001000110', 'Forro con soporte MagSafe iPhone 13', 'Forros', 45, 115, 0, 4),
  ('750001000111', 'Forro con soporte MagSafe iPhone 14', 'Forros', 45, 115, 0, 5),
  ('750001000112', 'Forro con soporte MagSafe iPhone 15', 'Forros', 48, 120, 0, 4),
  ('750001000113', 'Forro con soporte MagSafe iPhone 15 Pro Max', 'Forros', 55, 135, 0, 4),
  -- Vidrios templados: 9D
  ('750001000114', 'Vidrio templado 9D iPhone 11', 'Vidrios Templados', 5, 20, 0, 10),
  ('750001000115', 'Vidrio templado 9D iPhone 13', 'Vidrios Templados', 5, 20, 0, 10),
  ('750001000116', 'Vidrio templado 9D Galaxy A54', 'Vidrios Templados', 5, 20, 0, 10),
  ('750001000117', 'Vidrio templado 9D Redmi Note 12', 'Vidrios Templados', 5, 18, 0, 8),
  -- Vidrios templados: cerámica
  ('750001000118', 'Vidrio templado cerámica iPhone 14', 'Vidrios Templados', 10, 42, 0, 6),
  ('750001000119', 'Vidrio templado cerámica iPhone 15 Pro Max', 'Vidrios Templados', 12, 48, 0, 5),
  ('750001000120', 'Vidrio templado cerámica Galaxy S23', 'Vidrios Templados', 10, 42, 0, 5),
  -- Vidrios templados: anti-espía
  ('750001000121', 'Vidrio templado anti-espía iPhone 13', 'Vidrios Templados', 11, 45, 0, 5),
  ('750001000122', 'Vidrio templado anti-espía Galaxy A34', 'Vidrios Templados', 11, 45, 0, 5),
  -- Vidrio universal (compatibilidad cruzada entre marcas, pantallas ~6.1")
  ('750001000123', 'Vidrio templado universal 6.1"', 'Vidrios Templados', 4, 16, 0, 10),
  -- Cargadores y cables
  ('750001000124', 'Cargador rápido 18W USB-C', 'Cargadores', 28, 70, 0, 8),
  ('750001000125', 'Cargador rápido 20W USB-C', 'Cargadores', 32, 80, 0, 8),
  ('750001000126', 'Cargador inalámbrico 15W MagSafe', 'Cargadores', 60, 145, 0, 4),
  ('750001000127', 'Cable USB-C a USB-C 1m', 'Cargadores', 15, 40, 0, 10),
  ('750001000128', 'Cable USB-C a Lightning 1m', 'Cargadores', 20, 50, 0, 10),
  ('750001000129', 'Cable USB-A a Lightning 1m', 'Cargadores', 18, 45, 0, 10),
  ('750001000130', 'Cable USB-A a USB-C 1m', 'Cargadores', 14, 38, 0, 10),
  -- Audífonos
  ('750001000131', 'Audífonos Bluetooth in-ear', 'Audífonos', 55, 130, 0, 5),
  ('750001000132', 'Audífonos Bluetooth over-ear', 'Audífonos', 90, 210, 0, 4)
on conflict (codigo_barras) do nothing;

-- ----------------------------------------------------------------------------
-- Compatibilidades (mapeo cruzado producto <-> modelos de teléfono)
-- ----------------------------------------------------------------------------
insert into public.compatibilidades (producto_id, modelo_id)
select p.id, m.id
from (values
  ('750001000101', 'iPhone 11'),
  ('750001000102', 'Galaxy A54'),
  ('750001000103', 'Redmi Note 12'),
  ('750001000104', 'iPhone 12'),
  ('750001000105', 'iPhone 13'),
  ('750001000106', 'Galaxy A34'),
  ('750001000107', 'Galaxy S23'),
  ('750001000108', 'Redmi Note 13'),
  ('750001000109', 'Hot 30'),
  ('750001000110', 'iPhone 13'),
  ('750001000111', 'iPhone 14'),
  ('750001000112', 'iPhone 15'),
  ('750001000113', 'iPhone 15 Pro Max'),
  ('750001000114', 'iPhone 11'),
  ('750001000115', 'iPhone 13'),
  ('750001000116', 'Galaxy A54'),
  ('750001000117', 'Redmi Note 12'),
  ('750001000118', 'iPhone 14'),
  ('750001000119', 'iPhone 15 Pro Max'),
  ('750001000120', 'Galaxy S23'),
  ('750001000121', 'iPhone 13'),
  ('750001000122', 'Galaxy A34'),
  -- Vidrio universal: sirve para varios modelos de ~6.1" entre marcas
  ('750001000123', 'iPhone 13'),
  ('750001000123', 'iPhone 14'),
  ('750001000123', 'Galaxy A54'),
  ('750001000123', 'Galaxy S23'),
  ('750001000123', 'Redmi Note 12'),
  ('750001000123', 'Redmi Note 13'),
  ('750001000123', 'Note 30'),
  ('750001000123', 'Camon 20'),
  -- Cargador inalámbrico MagSafe: todo iPhone con MagSafe (12 en adelante)
  ('750001000126', 'iPhone 12'),
  ('750001000126', 'iPhone 13'),
  ('750001000126', 'iPhone 14'),
  ('750001000126', 'iPhone 15'),
  ('750001000126', 'iPhone 15 Pro Max'),
  -- Cables Lightning: iPhone 11-14 (iPhone 15 ya usa USB-C)
  ('750001000128', 'iPhone 11'),
  ('750001000128', 'iPhone 12'),
  ('750001000128', 'iPhone 13'),
  ('750001000128', 'iPhone 14'),
  ('750001000129', 'iPhone 11'),
  ('750001000129', 'iPhone 12'),
  ('750001000129', 'iPhone 13'),
  ('750001000129', 'iPhone 14')
) as v(codigo_barras, modelo)
join public.productos p on p.codigo_barras = v.codigo_barras
join public.modelos_telefono m on m.modelo = v.modelo
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Movimientos iniciales de inventario: el trigger aplicar_movimiento_inventario
-- actualiza productos.stock_actual automáticamente. Un producto sin fila aquí
-- (Cable USB-A a Lightning 1m) queda a propósito en 0 unidades ("sin stock").
-- ----------------------------------------------------------------------------
insert into public.movimientos_inventario (producto_id, tipo, cantidad, motivo)
select p.id, 'ENTRADA', v.cantidad, 'Carga inicial de inventario'
from (values
  ('750001000101', 28), ('750001000102', 24), ('750001000103', 20),
  ('750001000104', 17), ('750001000105', 19), ('750001000106', 15),
  ('750001000107', 9),  ('750001000108', 13), ('750001000109', 10),
  ('750001000110', 7),  ('750001000111', 2),  ('750001000112', 6),
  ('750001000113', 4),
  ('750001000114', 30), ('750001000115', 22), ('750001000116', 26),
  ('750001000117', 19), ('750001000118', 14), ('750001000119', 8),
  ('750001000120', 11), ('750001000121', 9),  ('750001000122', 7),
  ('750001000123', 3),
  ('750001000124', 22), ('750001000125', 35), ('750001000126', 8),
  ('750001000127', 30), ('750001000128', 25), ('750001000130', 20),
  ('750001000131', 6),  ('750001000132', 3)
) as v(codigo_barras, cantidad)
join public.productos p on p.codigo_barras = v.codigo_barras;

-- ----------------------------------------------------------------------------
-- Movimientos recientes de ejemplo (ventas y reabastecimientos), para que el
-- Dashboard y el historial no arranquen vacíos.
-- ----------------------------------------------------------------------------
insert into public.movimientos_inventario (producto_id, tipo, cantidad, motivo, fecha)
select p.id, v.tipo, v.cantidad, v.motivo, v.fecha::timestamptz
from (values
  ('750001000111', 'SALIDA',  3,  'Venta mostrador',       '2026-09-17T14:20:00Z'),
  ('750001000123', 'SALIDA',  2,  'Venta al por mayor',    '2026-09-17T11:05:00Z'),
  ('750001000126', 'ENTRADA', 10, 'Compra a proveedor',    '2026-09-16T16:40:00Z'),
  ('750001000120', 'SALIDA',  4,  'Venta mostrador',       '2026-09-15T09:30:00Z'),
  ('750001000113', 'SALIDA',  2,  'Venta mostrador',       '2026-09-14T17:45:00Z'),
  ('750001000128', 'ENTRADA', 15, 'Compra a proveedor',    '2026-09-13T12:10:00Z'),
  ('750001000107', 'SALIDA',  5,  'Venta al por mayor',    '2026-09-13T09:00:00Z'),
  ('750001000132', 'ENTRADA', 5,  'Compra a proveedor',    '2026-09-12T15:30:00Z')
) as v(codigo_barras, tipo, cantidad, motivo, fecha)
join public.productos p on p.codigo_barras = v.codigo_barras;
