-- ============================================================================
-- Precios de venta del Local Accesorios (en dólares).
--
-- Forros:      de silicona $6 · antigolpes $7 · transparentes $6
-- Cargadores:  entre $5 y $15 según el tipo (ver escala abajo)
-- Popsockets:  entre $2 y $4 según el modelo
--
-- Solo cambia productos.precio_venta (el precio de compra no se toca). Los forros
-- "con soporte MagSafe" no se incluyeron en la lista y conservan su precio.
--
-- Escala de cargadores y cables (categoría "Cargadores"):
--   Cables:               USB-A/USB-C a Lightning 1m $5-6 · USB-C a USB-C 1m $5 · 2m $7
--   Cargadores de pared:  por potencia: hasta 18W $7 · 20W $8 · 25W $9 · 30W $10
--                         45W $12 · 65W $14 · 100W o más $15 · doble puerto $8
--   Inalámbricos:         15W MagSafe $12 · base 3 en 1 $15
--   Cargadores de carro:  dual $6 · 30W $8 · 45W $11
--   Cualquier otro cargador que no encaje en la escala queda en $8.
--
-- Es idempotente: se puede ejecutar más de una vez (siempre deja el mismo precio).
-- ============================================================================

-- Forros
update public.productos set precio_venta = 6 where categoria = 'Forros' and nombre ilike 'Forro de silicona%';
update public.productos set precio_venta = 7 where categoria = 'Forros' and nombre ilike 'Forro antigolpes%';
update public.productos set precio_venta = 6 where categoria = 'Forros' and nombre ilike 'Forro transparente%';

-- Cargadores y cables
with calculo as (
  select
    id,
    case
      -- Cables
      when nombre ilike 'Cable%' then
        case
          when nombre ~* '2 ?m\M'              then 7
          when nombre ~* 'a Lightning'         then (case when nombre ~* 'USB-C a Lightning' then 6 else 5 end)
          else 5
        end
      -- Base 3 en 1 e inalámbricos
      when nombre ~* '3 en 1'                  then 15
      when nombre ~* 'inal[aá]mbric|magsafe'   then 12
      -- Cargadores de carro
      when nombre ~* 'carro' then
        case
          when nombre ~* '(^|[^0-9])4[5-9]W'   then 11
          when nombre ~* '(^|[^0-9])[3]0W'     then 8
          else 6
        end
      -- Cargadores de pared: por potencia
      when nombre ~* 'doble puerto'            then 8
      when substring(nombre from '([0-9]+) ?W') is not null then
        case
          when substring(nombre from '([0-9]+) ?W')::int >= 100 then 15
          when substring(nombre from '([0-9]+) ?W')::int >= 65  then 14
          when substring(nombre from '([0-9]+) ?W')::int >= 45  then 12
          when substring(nombre from '([0-9]+) ?W')::int >= 30  then 10
          when substring(nombre from '([0-9]+) ?W')::int >= 25  then 9
          when substring(nombre from '([0-9]+) ?W')::int >= 20  then 8
          else 7
        end
      else 8
    end as nuevo_precio
  from public.productos
  where categoria = 'Cargadores'
)
update public.productos p
set precio_venta = greatest(5, least(15, c.nuevo_precio))
from calculo c
where p.id = c.id;

-- Popsockets
update public.productos
set precio_venta = case
  when nombre ilike '%mate%'                              then 2
  when nombre ilike '%metálico%' or nombre ilike '%metalico%' then 4
  when nombre ilike '%magsafe%'                           then 4
  when nombre ilike '%tarjetero%' or nombre ilike '%wallet%'  then 4
  when nombre ilike '%espejo%'                            then 3
  when nombre ilike '%estampado%'                         then 3
  else 3
end
where categoria = 'Popsockets';
