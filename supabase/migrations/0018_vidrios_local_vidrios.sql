-- ============================================================================
-- Vidrios e hidrogel para el Local Vidrios: un producto por cada tipo y modelo.
--
-- Requiere 0005 (catálogo de modelos), 0006 (función ean13_interno) y 0015/0016
-- (locales e inventario por local).
--
-- Tipos y precio de venta (dólares):
--   Vidrio blindado .... $5     Vidrio sencillo ... $3
--   Vidrio antiespías .. $7     Hidrogel .......... $4
--
-- Cada producto nace con: precio de compra 0, stock mínimo 0 (sin alertas), un
-- código de barras interno EAN-13 y su compatibilidad con el modelo. Quedan dados
-- de alta en el LOCAL VIDRIOS con 10 unidades de PRUEBA cada uno (movimiento
-- ENTRADA "Stock de prueba (Local Vidrios)"): reemplázalas por las cantidades reales
-- con "Registrar entrada" (estando en el Local Vidrios) o con la importación CSV.
--
-- Es idempotente: omite los productos cuyo nombre ya existe (y no vuelve a sumar
-- las unidades de prueba a los existentes); sí vuelve a dejar los precios indicados.
-- ============================================================================

with tipos(orden, prefijo, categoria, precio_venta) as (
  values
    (1, 'Vidrio blindado',   'Vidrios Templados', 5),
    (2, 'Vidrio sencillo',   'Vidrios Templados', 3),
    (3, 'Vidrio antiespías', 'Vidrios Templados', 7),
    (4, 'Hidrogel',          'Hidrogel',          4)
),
base_nombres as (
  select
    t.orden,
    t.categoria,
    t.precio_venta,
    m.id as modelo_id,
    m.marca,
    m.modelo,
    -- Tecno e Infinix repiten el nombre de la marca ("Vidrio blindado Infinix Hot 30")
    t.prefijo || ' '
      || case when m.marca in ('Tecno', 'Infinix') then m.marca || ' ' else '' end
      || m.modelo as nombre
  from tipos t
  cross join public.modelos_telefono m
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
    n.categoria,
    0,
    n.precio_venta,
    0,
    0
  from numerados n
  cross join punto_partida pp
  returning id, nombre
),
compatibles as (
  insert into public.compatibilidades (producto_id, modelo_id)
  select nu.id, n.modelo_id
  from nuevos nu
  join numerados n on n.nombre = nu.nombre
  on conflict do nothing
  returning producto_id
)
-- Alta en el Local Vidrios con 10 unidades de prueba (el trigger crea la fila de inventario del local)
insert into public.movimientos_inventario (producto_id, tipo, cantidad, motivo, local_id)
select nu.id, 'ENTRADA', 10, 'Stock de prueba (Local Vidrios)', '00000000-0000-4000-8000-000000000002'
from nuevos nu;

-- Precios (también si el producto ya existía)
update public.productos set precio_venta = 5 where nombre ilike 'Vidrio blindado %';
update public.productos set precio_venta = 3 where nombre ilike 'Vidrio sencillo %';
update public.productos set precio_venta = 7 where nombre ilike 'Vidrio antiespías %';
update public.productos set precio_venta = 4 where nombre ilike 'Hidrogel %';

-- Verificación: ~4 productos por cada modelo del catálogo
--   select categoria, count(*) from public.productos
--   where nombre ~ '^(Vidrio blindado|Vidrio sencillo|Vidrio antiespías|Hidrogel) ' group by categoria;
