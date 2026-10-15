-- ============================================================================
-- Cargadores, cables y popsockets (productos generales, no por modelo).
--
-- Requiere 0005 (catálogo de modelos) y 0006 (función ean13_interno).
--
-- Cada producto nace con: stock 0, precio de compra 0, stock mínimo 0 (sin
-- alertas) y un código de barras interno EAN-13. Los precios de venta son
-- INICIALES/estimados: ajústalos con Importar CSV o Editar.
--
-- Es idempotente: omite los artículos cuyo nombre ya existe (varios ya vienen
-- en el seed original), así que se puede ejecutar más de una vez.
--
-- Compatibilidad (solo donde la tecnología lo exige):
--   magsafe   -> iPhone 12 en adelante (imán MagSafe)
--   lightning -> iPhone 11 a 14 y SE 3.ª gen (el iPhone 15 ya usa USB-C)
-- El resto (cargadores de pared/carro, cables USB-C) es universal.
-- ============================================================================

with articulos(nombre, categoria, precio_venta, compat) as (
  values
    -- Cargadores de pared
    ('Cargador rápido 20W USB-C',                         'Cargadores',  80, null),
    ('Cargador rápido 25W USB-C Samsung',                 'Cargadores',  90, null),
    ('Cargador rápido 45W USB-C Samsung',                 'Cargadores', 130, null),
    ('Cargador rápido 65W USB-C',                         'Cargadores', 150, null),
    ('Cargador rápido 120W USB-C',                        'Cargadores', 220, null),
    ('Cargador de pared doble puerto USB-A + USB-C',      'Cargadores',  85, null),
    -- Inalámbricos y MagSafe
    ('Cargador inalámbrico 15W MagSafe',                  'Cargadores', 145, 'magsafe'),
    ('Base de carga inalámbrica 3 en 1 (teléfono, reloj y audífonos)', 'Cargadores', 220, null),
    -- Cargadores de carro
    ('Cargador de carro USB-C PD 30W',                    'Cargadores',  75, null),
    ('Cargador de carro USB-C PD 45W',                    'Cargadores', 110, null),
    ('Cargador de carro dual (QC 3.0 + USB-C)',           'Cargadores',  60, null),
    -- Cables
    ('Cable USB-C a USB-C 1m',                            'Cargadores',  40, null),
    ('Cable USB-C a USB-C 2m',                            'Cargadores',  55, null),
    ('Cable USB-A a Lightning 1m',                        'Cargadores',  45, 'lightning'),
    ('Cable USB-C a Lightning 1m',                        'Cargadores',  50, 'lightning'),
    -- Popsockets
    ('Popsocket estampado',                               'Popsockets',  20, null),
    ('Popsocket monocolor mate',                          'Popsockets',  15, null),
    ('Popsocket metálico de aluminio',                    'Popsockets',  35, null),
    ('Popsocket con espejo',                              'Popsockets',  30, null),
    ('Popsocket MagSafe magnético',                       'Popsockets',  45, 'magsafe'),
    ('Popsocket con tarjetero (Wallet Pop)',              'Popsockets',  35, null)
),
faltantes as (
  select a.*
  from articulos a
  where not exists (
    select 1 from public.productos p where lower(p.nombre) = lower(a.nombre)
  )
),
numerados as (
  select f.*, row_number() over (order by f.categoria, f.nombre) as n
  from faltantes f
),
punto_partida as (
  select coalesce(max(substr(codigo_barras, 3, 10)::bigint), 0) as ultimo
  from public.productos
  where codigo_barras ~ '^20[0-9]{11}$'
),
nuevos as (
  insert into public.productos
    (codigo_barras, nombre, categoria, precio_compra, precio_venta, stock_actual, stock_minimo)
  select
    public.ean13_interno(pp.ultimo + n.n),
    n.nombre,
    n.categoria,
    0,
    n.precio_venta,
    0,
    0
  from numerados n
  cross join punto_partida pp
  returning id, nombre
)
insert into public.compatibilidades (producto_id, modelo_id)
select nu.id, m.id
from nuevos nu
join numerados n on n.nombre = nu.nombre
join public.modelos_telefono m on m.marca = 'Apple'
where n.compat is not null
  and (
    (n.compat = 'magsafe'   and m.modelo ~ '^iPhone 1[2-8]( |$)')
    or
    (n.compat = 'lightning' and (m.modelo ~ '^iPhone 1[1-4]( |$)' or m.modelo like 'iPhone SE (3.ª%'))
  )
on conflict do nothing;

-- Verificación: debe listar los artículos de Cargadores y Popsockets.
--   select categoria, count(*) from public.productos
--   where categoria in ('Cargadores', 'Popsockets') group by categoria;
