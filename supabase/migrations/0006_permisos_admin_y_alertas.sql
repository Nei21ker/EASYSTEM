-- ============================================================================
-- Permisos reales por rol + alertas + códigos de barras internos.
--
-- 1. Hasta ahora cualquier usuario autenticado (incluido un vendedor) podía
--    crear/editar/borrar productos, modelos y compatibilidades llamando a la
--    API, aunque la interfaz no se lo mostrara. Ahora la base de datos exige
--    rol administrador. Un vendedor sigue pudiendo LEER todo y registrar
--    SALIDAS (ventas); las ENTRADAS de mercancía son solo del administrador.
-- 2. El trigger de stock pasa a SECURITY DEFINER: así una venta de un vendedor
--    puede descontar stock aunque él ya no pueda actualizar productos.
-- 3. Un stock_minimo de 0 significa "producto sin control de reabastecimiento":
--    no genera alerta (evita cientos de alertas por productos recién cargados).
-- 4. Función para generar códigos de barras EAN-13 internos (prefijo 20).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Escritura solo para administradores
-- ----------------------------------------------------------------------------
drop policy if exists "Usuarios autenticados gestionan productos" on public.productos;
drop policy if exists "Administradores insertan productos" on public.productos;
drop policy if exists "Administradores actualizan productos" on public.productos;
drop policy if exists "Administradores eliminan productos" on public.productos;
create policy "Administradores insertan productos" on public.productos
  for insert with check (public.rol_actual() = 'administrador');
create policy "Administradores actualizan productos" on public.productos
  for update using (public.rol_actual() = 'administrador') with check (public.rol_actual() = 'administrador');
create policy "Administradores eliminan productos" on public.productos
  for delete using (public.rol_actual() = 'administrador');

drop policy if exists "Usuarios autenticados gestionan modelos" on public.modelos_telefono;
drop policy if exists "Administradores insertan modelos" on public.modelos_telefono;
drop policy if exists "Administradores actualizan modelos" on public.modelos_telefono;
drop policy if exists "Administradores eliminan modelos" on public.modelos_telefono;
create policy "Administradores insertan modelos" on public.modelos_telefono
  for insert with check (public.rol_actual() = 'administrador');
create policy "Administradores actualizan modelos" on public.modelos_telefono
  for update using (public.rol_actual() = 'administrador') with check (public.rol_actual() = 'administrador');
create policy "Administradores eliminan modelos" on public.modelos_telefono
  for delete using (public.rol_actual() = 'administrador');

drop policy if exists "Usuarios autenticados gestionan compatibilidades" on public.compatibilidades;
drop policy if exists "Administradores insertan compatibilidades" on public.compatibilidades;
drop policy if exists "Administradores actualizan compatibilidades" on public.compatibilidades;
drop policy if exists "Administradores eliminan compatibilidades" on public.compatibilidades;
create policy "Administradores insertan compatibilidades" on public.compatibilidades
  for insert with check (public.rol_actual() = 'administrador');
create policy "Administradores actualizan compatibilidades" on public.compatibilidades
  for update using (public.rol_actual() = 'administrador') with check (public.rol_actual() = 'administrador');
create policy "Administradores eliminan compatibilidades" on public.compatibilidades
  for delete using (public.rol_actual() = 'administrador');

-- Movimientos: cualquier usuario registra SALIDAS (ventas); ENTRADAS solo admin
drop policy if exists "Usuarios autenticados gestionan movimientos" on public.movimientos_inventario;
drop policy if exists "Salidas para autenticados, entradas solo administrador" on public.movimientos_inventario;
create policy "Salidas para autenticados, entradas solo administrador" on public.movimientos_inventario
  for insert with check (
    auth.role() = 'authenticated'
    and (tipo = 'SALIDA' or public.rol_actual() = 'administrador')
  );

-- ----------------------------------------------------------------------------
-- 2. Trigger de stock con privilegios del dueño (sigue validando stock suficiente)
-- ----------------------------------------------------------------------------
create or replace function public.aplicar_movimiento_inventario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stock_actual_real integer;
begin
  select stock_actual into stock_actual_real
  from public.productos
  where id = new.producto_id
  for update;

  if new.tipo = 'SALIDA' and stock_actual_real < new.cantidad then
    raise exception 'Stock insuficiente para el producto %: stock actual %, se intentó restar %',
      new.producto_id, stock_actual_real, new.cantidad;
  end if;

  update public.productos
  set stock_actual = stock_actual + case when new.tipo = 'ENTRADA' then new.cantidad else -new.cantidad end
  where id = new.producto_id;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Alertas: solo productos con control de reabastecimiento (stock_minimo > 0)
-- ----------------------------------------------------------------------------
create or replace view public.vw_productos_stock_bajo as
select id, codigo_barras, nombre, categoria, stock_actual, stock_minimo
from public.productos
where stock_minimo > 0 and stock_actual <= stock_minimo
order by stock_actual asc;

-- ----------------------------------------------------------------------------
-- 4. Código de barras interno EAN-13 (prefijo 20 = uso interno de tiendas, GS1)
--    ean13_interno(1) -> '2000000000015'. Misma regla que src/utils/codigos.ts.
-- ----------------------------------------------------------------------------
create or replace function public.ean13_interno(secuencia bigint)
returns text
language sql
immutable
as $$
  select b.base || (((10 - (
    (select sum((substr(b.base, i, 1))::int * case when i % 2 = 1 then 1 else 3 end)
     from generate_series(1, 12) as i) % 10
  )) % 10))::text
  from (select '20' || lpad(secuencia::text, 10, '0') as base) b;
$$;
