-- ============================================================================
-- Local Servicio Técnico: repuestos en stock y órdenes de ejemplo (para no verlo vacío).
--
-- Requiere 0005, 0006, 0015 y 0016.
--
-- 1. Repuestos, uno por cada modelo de teléfono del catálogo (categoría "Repuestos"):
--      Pantalla 3/4 ... $25     Mica ... $3     Batería ... $12
--    Cada producto nace con precio de compra 0, stock mínimo 0, código EAN-13 interno y su
--    compatibilidad con el modelo, y queda dado de alta en el LOCAL SERVICIO TÉCNICO con
--    10 unidades de PRUEBA (movimiento ENTRADA "Stock de prueba (Servicio Técnico)").
-- 2. 6 órdenes de servicio DE EJEMPLO (registrado_nombre = 'Datos de ejemplo'), en distintos
--    estados, con clientes ficticios. Las que usan repuestos los descuentan del stock del local
--    con movimientos SALIDA "Repuesto, orden de servicio #N", igual que lo hace la aplicación.
--
-- Todo es temporal: corrige precios y cantidades con "Editar" / "Registrar entrada" / CSV, y las
-- órdenes de ejemplo se pueden dejar como historial o ignorar. Es idempotente: no repite productos
-- (por nombre) ni vuelve a crear las órdenes de ejemplo; sí vuelve a dejar los precios indicados.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Repuestos por modelo
-- ----------------------------------------------------------------------------
with tipos(orden, prefijo, precio_venta) as (
  values
    (1, 'Pantalla 3/4', 25),
    (2, 'Mica',          3),
    (3, 'Batería',      12)
),
base_nombres as (
  select
    t.orden,
    t.precio_venta,
    m.id as modelo_id,
    m.marca,
    m.modelo,
    -- Tecno e Infinix repiten el nombre de la marca ("Batería Tecno Camon 20")
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
    'Repuestos',
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
insert into public.movimientos_inventario (producto_id, tipo, cantidad, motivo, local_id)
select nu.id, 'ENTRADA', 10, 'Stock de prueba (Servicio Técnico)', '00000000-0000-4000-8000-000000000003'
from nuevos nu;

-- Precios (también si el producto ya existía)
update public.productos set precio_venta = 25 where categoria = 'Repuestos' and nombre ilike 'Pantalla 3/4 %';
update public.productos set precio_venta = 3  where categoria = 'Repuestos' and nombre ilike 'Mica %';
update public.productos set precio_venta = 12 where categoria = 'Repuestos' and nombre ilike 'Batería %';

-- ----------------------------------------------------------------------------
-- 2. Órdenes de servicio de ejemplo
-- ----------------------------------------------------------------------------
do $$
declare
  local_servicio constant uuid := '00000000-0000-4000-8000-000000000003';
  demo record;
  rep record;
  producto record;
  orden_id uuid;
  orden_folio bigint;
  lista_repuestos jsonb;
  total_repuestos numeric(12, 2);
begin
  if exists (select 1 from public.ordenes_servicio where registrado_nombre = 'Datos de ejemplo') then
    return; -- ya se crearon
  end if;

  for demo in
    select * from (values
      ('V-14223344', 'Carlos Mendoza', '0414-5550101', 'Apple',   'iPhone 11',      '356938035643809', 'Cargador, sin funda',        'Pantalla rota después de una caída',              'pendiente',     0, 0,  null,                                             '[]'::jsonb),
      ('E-84123456', 'Ana Rivas',      '0424-5550202', 'Samsung', 'Galaxy A54',     null,              'Solo el equipo',             'No carga bien y la batería dura muy poco',        'en_reparacion', 1, 8,  'Batería agotada: se reemplaza por una nueva',    '[["Batería Galaxy A54", 1]]'::jsonb),
      ('V-9876543',  'Luis Gómez',     '0412-7654321', 'Apple',   'iPhone 12',      '353456789012345', 'Con funda',                  'Se ve una línea verde en la pantalla',            'listo',         3, 10, 'Pantalla dañada: se cambia por pantalla 3/4',    '[["Pantalla 3/4 iPhone 12", 1]]'::jsonb),
      ('V-20112233', 'Marta Pérez',    '0416-5550303', 'Xiaomi',  'Redmi Note 12 Pro', null,             'Cargador',                   'La pantalla tiene manchas y no responde al tacto', 'entregado',    6, 10, 'Pantalla y mica nuevas',                          '[["Pantalla 3/4 Redmi Note 12 Pro", 1], ["Mica Redmi Note 12 Pro", 1]]'::jsonb),
      ('V-17445566', 'José Rojas',     '0426-5550404', 'Apple',   'iPhone 13',      null,              'Sin accesorios',             'Mica rota, quiere cambiarla',                     'entregado',    8, 2,  'Solo cambio de mica',                             '[["Mica iPhone 13", 1]]'::jsonb),
      ('V-15332211', 'Elena Suárez',   '0414-5559988', 'Tecno',   'Camon 20',       null,              'Cargador y SIM',             'Se apaga solo y se calienta',                     'pendiente',     0, 0,  null,                                             '[]'::jsonb)
    ) as t(cedula, nombre, telefono, marca, modelo, imei, recibido, falla, estado, dias_atras, mano_obra, diagnostico, repuestos)
  loop
    insert into public.ordenes_servicio
      (local_id, cliente_cedula, cliente_nombre, cliente_telefono, equipo_marca, equipo_modelo, equipo_imei,
       accesorios_recibidos, falla_reportada, recibida_en, registrado_nombre)
    values
      (local_servicio, demo.cedula, demo.nombre, demo.telefono, demo.marca, demo.modelo, demo.imei,
       demo.recibido, demo.falla, now() - make_interval(days => demo.dias_atras), 'Datos de ejemplo')
    returning id, folio into orden_id, orden_folio;

    -- Repuestos: salen del stock del local y se anotan en la orden con el precio del momento
    lista_repuestos := '[]'::jsonb;
    total_repuestos := 0;
    for rep in select value from jsonb_array_elements(demo.repuestos) loop
      select id, codigo_barras, nombre, precio_venta into producto
      from public.productos
      where lower(nombre) = lower(rep.value ->> 0);

      if found then
        insert into public.movimientos_inventario (producto_id, tipo, cantidad, motivo, local_id)
        values (producto.id, 'SALIDA', (rep.value ->> 1)::int, 'Repuesto, orden de servicio #' || orden_folio, local_servicio);

        lista_repuestos := lista_repuestos || jsonb_build_object(
          'producto_id', producto.id,
          'nombre', producto.nombre,
          'codigo_barras', producto.codigo_barras,
          'cantidad', (rep.value ->> 1)::int,
          'precio_unitario', producto.precio_venta
        );
        total_repuestos := total_repuestos + producto.precio_venta * (rep.value ->> 1)::int;
      end if;
    end loop;

    -- Diagnóstico, costos y estado (por pasos, para que el trigger ponga las marcas de tiempo)
    update public.ordenes_servicio
    set diagnostico = demo.diagnostico,
        mano_de_obra_usd = demo.mano_obra,
        repuestos = lista_repuestos,
        total_usd = total_repuestos + demo.mano_obra,
        tecnico_nombre = case when demo.estado = 'pendiente' then null else 'Técnico de ejemplo' end
    where id = orden_id;

    if demo.estado in ('en_reparacion', 'listo', 'entregado') then
      update public.ordenes_servicio set estado = 'en_reparacion' where id = orden_id;
    end if;
    if demo.estado in ('listo', 'entregado') then
      update public.ordenes_servicio set estado = 'listo' where id = orden_id;
    end if;
    if demo.estado = 'entregado' then
      update public.ordenes_servicio set estado = 'entregado' where id = orden_id;
    end if;
  end loop;
end
$$;
