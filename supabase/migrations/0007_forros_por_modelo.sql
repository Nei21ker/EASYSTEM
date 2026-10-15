-- ============================================================================
-- Forros por modelo de teléfono: un producto por cada tipo de forro y modelo.
--
-- Requiere 0005 (catálogo de modelos) y 0006 (función ean13_interno).
--
-- Tipos y precio de venta INICIAL (ajústalos luego con Importar CSV o Editar):
--   Forro de silicona ............ $38    (todos los modelos)
--   Forro antigolpes ............. $55    (todos los modelos)
--   Forro transparente ........... $35    (todos los modelos)
--   Forro con soporte MagSafe .... $115   (solo iPhone 12 en adelante)
--
-- Cada producto nace con: stock 0, precio de compra 0, stock mínimo 0 (sin
-- alertas) y un código de barras interno EAN-13. La compatibilidad con su
-- modelo queda registrada.
--
-- Es idempotente: omite los forros cuyo nombre ya existe (incluidos los del
-- seed original), así que se puede ejecutar más de una vez sin duplicar.
-- ============================================================================

with tipos(orden, prefijo, precio_venta, solo_magsafe) as (
  values
    (1, 'Forro de silicona',          38, false),
    (2, 'Forro antigolpes',           55, false),
    (3, 'Forro transparente',         35, false),
    (4, 'Forro con soporte MagSafe', 115, true)
),
base_nombres as (
  select
    t.orden,
    t.precio_venta,
    m.id as modelo_id,
    m.marca,
    m.modelo,
    -- Tecno e Infinix repiten el nombre de la marca ("Forro antigolpes Infinix Hot 30")
    t.prefijo || ' '
      || case when m.marca in ('Tecno', 'Infinix') then m.marca || ' ' else '' end
      || m.modelo as nombre
  from tipos t
  cross join public.modelos_telefono m
  where not t.solo_magsafe
     or (m.marca = 'Apple' and m.modelo ~ '^iPhone 1[2-8]( |$)')
),
candidatos as (
  select b.*
  from base_nombres b
  where not exists (
    select 1 from public.productos p where lower(p.nombre) = lower(b.nombre)
  )
),
numerados as (
  select c.*, row_number() over (order by c.marca, c.modelo, c.orden) as n
  from candidatos c
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
    'Forros',
    0,
    n.precio_venta,
    0,
    0
  from numerados n
  cross join punto_partida pp
  returning id, nombre
)
insert into public.compatibilidades (producto_id, modelo_id)
select nu.id, n.modelo_id
from nuevos nu
join numerados n on n.nombre = nu.nombre
on conflict do nothing;

-- Verificación: debe devolver ~520 forros (según cuántos ya tuvieras).
--   select count(*) from public.productos where categoria = 'Forros';
