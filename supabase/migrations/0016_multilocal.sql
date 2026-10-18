-- ============================================================================
-- Multi-local (2/2): 3 locales independientes con inventario, ventas y permisos propios.
--
--   1. Local Accesorios · 2. Local Vidrios · 3. Local Servicio Técnico
--
-- Requiere 0015_roles_encargado_y_tecnico.sql ejecutada ANTES (y terminada) y las
-- migraciones 0011 a 0014 (ventas, tasa, pagos, devoluciones).
--
-- Qué hace:
--  · public.locales: los 3 locales (equivalente a la tabla "stores" del requisito).
--  · public.perfiles.local_id: local asignado a cada empleado. Un administrador tiene
--    acceso a TODOS los locales (su local_id puede quedar vacío); el resto solo ve y
--    modifica datos de su local.
--  · public.inventario_local: el stock y el mínimo de cada producto EN cada local
--    (tabla pivote "store_inventory"). El catálogo (productos, modelos, compatibilidades,
--    fotos, precios) es único y compartido; lo que cambia por local es el stock y qué
--    productos maneja (los que tienen fila en inventario_local).
--  · movimientos_inventario / ventas / devoluciones ganan local_id. El trigger de stock
--    ahora mueve el stock DEL LOCAL del movimiento y mantiene productos.stock_actual como
--    el total entre todos los locales.
--  · public.ordenes_servicio: órdenes de servicio técnico (recepción del equipo, falla,
--    repuestos consumidos del stock, estado).
--  · RLS: administrador = todo; los demás roles solo filas con su local_id.
--
-- DATOS EXISTENTES: todo lo que ya estaba cargado (productos con su stock, movimientos,
-- ventas, devoluciones y empleados no administradores) se asigna al "Local Accesorios",
-- que era el único local. Después el administrador puede dar de alta productos en el
-- Local Vidrios con "Registrar entrada" estando en ese local.
--
-- Es idempotente: se puede ejecutar más de una vez.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. locales
-- ----------------------------------------------------------------------------
create table if not exists public.locales (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  tipo       text not null check (tipo in ('accesorios', 'vidrios', 'servicio_tecnico')),
  direccion  text,
  telefono   text,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.locales is 'Locales (sucursales) del negocio; cada uno tiene inventario, ventas y empleados propios';

insert into public.locales (id, nombre, tipo) values
  ('00000000-0000-4000-8000-000000000001', 'Local Accesorios', 'accesorios'),
  ('00000000-0000-4000-8000-000000000002', 'Local Vidrios', 'vidrios'),
  ('00000000-0000-4000-8000-000000000003', 'Local Servicio Técnico', 'servicio_tecnico')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 2. perfiles.local_id y funciones de ayuda para las políticas
-- ----------------------------------------------------------------------------
alter table public.perfiles add column if not exists local_id uuid references public.locales (id) on delete set null;

comment on column public.perfiles.local_id is 'Local asignado. El administrador tiene acceso global; el resto solo a este local';

-- Empleados que ya existían (no administradores): al Local Accesorios
update public.perfiles
set local_id = '00000000-0000-4000-8000-000000000001'
where local_id is null and rol <> 'administrador';

create or replace function public.local_actual()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select local_id from public.perfiles where id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 3. Políticas de locales y perfiles
-- ----------------------------------------------------------------------------
alter table public.locales enable row level security;

drop policy if exists "Locales: ver el propio (el administrador ve todos)" on public.locales;
drop policy if exists "Locales: solo administrador escribe" on public.locales;

create policy "Locales: ver el propio (el administrador ve todos)" on public.locales
  for select using (public.rol_actual() = 'administrador' or id = public.local_actual());

create policy "Locales: solo administrador escribe" on public.locales
  for all using (public.rol_actual() = 'administrador') with check (public.rol_actual() = 'administrador');

-- (perfiles: ya existen "cada usuario ve el suyo", "administradores ven todos" y
--  "administradores actualizan cualquier perfil"; el administrador asigna rol y local_id.)

-- ----------------------------------------------------------------------------
-- 4. inventario_local: stock por local (tabla pivote)
-- ----------------------------------------------------------------------------
create table if not exists public.inventario_local (
  local_id     uuid not null references public.locales (id) on delete cascade,
  producto_id  uuid not null references public.productos (id) on delete cascade,
  stock_actual integer not null default 0 check (stock_actual >= 0),
  stock_minimo integer not null default 0 check (stock_minimo >= 0),
  primary key (local_id, producto_id)
);

comment on table public.inventario_local is 'Stock y mínimo de cada producto en cada local. stock_minimo = 0 significa "sin control de reabastecimiento"';

create index if not exists inventario_local_producto_idx on public.inventario_local (producto_id);

-- Los productos que ya existían quedan en el Local Accesorios con su stock actual
insert into public.inventario_local (local_id, producto_id, stock_actual, stock_minimo)
select '00000000-0000-4000-8000-000000000001', p.id, p.stock_actual, p.stock_minimo
from public.productos p
on conflict (local_id, producto_id) do nothing;

alter table public.inventario_local enable row level security;

drop policy if exists "Inventario: ver el de su local" on public.inventario_local;
drop policy if exists "Inventario: solo administrador escribe directo" on public.inventario_local;

create policy "Inventario: ver el de su local" on public.inventario_local
  for select using (public.rol_actual() = 'administrador' or local_id = public.local_actual());

-- El stock cambia por movimientos (trigger SECURITY DEFINER); la escritura directa es solo del administrador
create policy "Inventario: solo administrador escribe directo" on public.inventario_local
  for all using (public.rol_actual() = 'administrador') with check (public.rol_actual() = 'administrador');

-- ----------------------------------------------------------------------------
-- 5. movimientos_inventario.local_id y trigger de stock por local
-- ----------------------------------------------------------------------------
alter table public.movimientos_inventario add column if not exists local_id uuid references public.locales (id);
update public.movimientos_inventario set local_id = '00000000-0000-4000-8000-000000000001' where local_id is null;
alter table public.movimientos_inventario alter column local_id set not null;
create index if not exists movimientos_inventario_local_idx on public.movimientos_inventario (local_id, fecha desc);

create or replace function public.aplicar_movimiento_inventario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stock_local integer;
  delta integer := case when new.tipo = 'ENTRADA' then new.cantidad else -new.cantidad end;
begin
  -- Si el producto aún no se manejaba en ese local, se da de alta con stock 0 y sin mínimo
  insert into public.inventario_local (local_id, producto_id, stock_actual, stock_minimo)
  values (new.local_id, new.producto_id, 0, 0)
  on conflict (local_id, producto_id) do nothing;

  select stock_actual into stock_local
  from public.inventario_local
  where local_id = new.local_id and producto_id = new.producto_id
  for update;

  if new.tipo = 'SALIDA' and stock_local < new.cantidad then
    raise exception 'Stock insuficiente para el producto % en este local: stock actual %, se intentó restar %',
      new.producto_id, stock_local, new.cantidad;
  end if;

  update public.inventario_local
  set stock_actual = stock_actual + delta
  where local_id = new.local_id and producto_id = new.producto_id;

  -- productos.stock_actual = total entre todos los locales
  update public.productos set stock_actual = stock_actual + delta where id = new.producto_id;

  return new;
end;
$$;

drop policy if exists "Salidas para autenticados, entradas solo administrador" on public.movimientos_inventario;
drop policy if exists "Lectura para usuarios autenticados" on public.movimientos_inventario;
drop policy if exists "Movimientos: ver los de su local" on public.movimientos_inventario;
drop policy if exists "Movimientos: registrar en su local" on public.movimientos_inventario;

create policy "Movimientos: ver los de su local" on public.movimientos_inventario
  for select using (public.rol_actual() = 'administrador' or local_id = public.local_actual());

-- Cualquier empleado registra SALIDAS (ventas, repuestos) en SU local; las ENTRADAS son del
-- administrador (cualquier local) y del encargado (solo su local)
create policy "Movimientos: registrar en su local" on public.movimientos_inventario
  for insert with check (
    auth.role() = 'authenticated'
    and (
      public.rol_actual() = 'administrador'
      or (local_id = public.local_actual() and (tipo = 'SALIDA' or public.rol_actual() = 'encargado'))
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Alertas de stock bajo por local
-- ----------------------------------------------------------------------------
drop view if exists public.vw_productos_stock_bajo;
create view public.vw_productos_stock_bajo
with (security_invoker = true) as
select i.local_id, l.nombre as local_nombre, p.id, p.codigo_barras, p.nombre, p.categoria, i.stock_actual, i.stock_minimo
from public.inventario_local i
join public.productos p on p.id = i.producto_id
join public.locales l on l.id = i.local_id
where i.stock_minimo > 0 and i.stock_actual <= i.stock_minimo
order by i.stock_actual asc;

-- ----------------------------------------------------------------------------
-- 7. ventas y devoluciones por local
-- ----------------------------------------------------------------------------
alter table public.ventas add column if not exists local_id uuid references public.locales (id);
update public.ventas set local_id = '00000000-0000-4000-8000-000000000001' where local_id is null;
alter table public.ventas alter column local_id set not null;
create index if not exists ventas_local_idx on public.ventas (local_id, fecha desc);

drop policy if exists "Ventas: el administrador ve todas, el vendedor las suyas" on public.ventas;
drop policy if exists "Ventas: registrar a nombre propio" on public.ventas;
drop policy if exists "Ventas: ver las de su local" on public.ventas;
drop policy if exists "Ventas: registrar en su local" on public.ventas;

-- Administrador: todas. Encargado: todas las de su local. Vendedor/técnico: las que registraron ellos en su local.
create policy "Ventas: ver las de su local" on public.ventas
  for select using (
    public.rol_actual() = 'administrador'
    or (local_id = public.local_actual() and (public.rol_actual() = 'encargado' or vendedor_id = auth.uid()))
  );

create policy "Ventas: registrar en su local" on public.ventas
  for insert with check (
    auth.role() = 'authenticated'
    and vendedor_id = auth.uid()
    and (public.rol_actual() = 'administrador' or local_id = public.local_actual())
  );

alter table public.devoluciones add column if not exists local_id uuid references public.locales (id);
update public.devoluciones d set local_id = v.local_id from public.ventas v where d.venta_id = v.id and d.local_id is null;
update public.devoluciones set local_id = '00000000-0000-4000-8000-000000000001' where local_id is null;
alter table public.devoluciones alter column local_id set not null;
create index if not exists devoluciones_local_idx on public.devoluciones (local_id, fecha desc);

drop policy if exists "Devoluciones: ver las de las ventas visibles" on public.devoluciones;
drop policy if exists "Devoluciones: solo administrador registra" on public.devoluciones;
drop policy if exists "Devoluciones: registrar (administrador o encargado del local)" on public.devoluciones;

create policy "Devoluciones: ver las de las ventas visibles" on public.devoluciones
  for select using (
    public.rol_actual() = 'administrador'
    or (local_id = public.local_actual() and exists (select 1 from public.ventas v where v.id = devoluciones.venta_id))
  );

-- Devolver mercancía al inventario es una ENTRADA: administrador (cualquier local) o encargado (su local)
create policy "Devoluciones: registrar (administrador o encargado del local)" on public.devoluciones
  for insert with check (
    registrado_por = auth.uid()
    and (
      public.rol_actual() = 'administrador'
      or (public.rol_actual() = 'encargado' and local_id = public.local_actual())
    )
  );

-- ----------------------------------------------------------------------------
-- 8. Servicio técnico: órdenes de servicio / reparaciones
-- ----------------------------------------------------------------------------
create table if not exists public.ordenes_servicio (
  id                 uuid primary key default gen_random_uuid(),
  folio              bigint generated always as identity unique,
  local_id           uuid not null references public.locales (id),
  -- Cliente
  cliente_cedula     text not null check (char_length(cliente_cedula) between 5 and 20),
  cliente_nombre     text not null check (char_length(btrim(cliente_nombre)) between 3 and 120),
  cliente_telefono   text not null check (char_length(cliente_telefono) between 7 and 25),
  -- Equipo recibido
  equipo_marca       text not null check (char_length(btrim(equipo_marca)) between 1 and 60),
  equipo_modelo      text not null check (char_length(btrim(equipo_modelo)) between 1 and 80),
  equipo_imei        text check (equipo_imei is null or char_length(equipo_imei) <= 40),
  accesorios_recibidos text check (accesorios_recibidos is null or char_length(accesorios_recibidos) <= 300),
  falla_reportada    text not null check (char_length(btrim(falla_reportada)) between 3 and 1000),
  diagnostico        text check (diagnostico is null or char_length(diagnostico) <= 1000),
  -- Seguimiento
  estado             text not null default 'pendiente' check (estado in ('pendiente', 'en_reparacion', 'listo', 'entregado')),
  tecnico_id         uuid references auth.users (id) on delete set null,
  tecnico_nombre     text,
  -- Repuestos que salieron del stock del local: [{ producto_id, nombre, codigo_barras, cantidad, precio_unitario }]
  repuestos          jsonb not null default '[]'::jsonb check (jsonb_typeof(repuestos) = 'array'),
  mano_de_obra_usd   numeric(12, 2) not null default 0 check (mano_de_obra_usd >= 0),
  total_usd          numeric(12, 2) not null default 0 check (total_usd >= 0),
  recibida_en        timestamptz not null default now(),
  actualizada_en     timestamptz not null default now(),
  listo_en           timestamptz,
  entregada_en       timestamptz,
  registrado_por     uuid default auth.uid() references auth.users (id) on delete set null,
  registrado_nombre  text
);

comment on table public.ordenes_servicio is 'Órdenes de servicio técnico: equipo recibido, falla, repuestos consumidos del stock y estado';

create index if not exists ordenes_servicio_local_idx on public.ordenes_servicio (local_id, recibida_en desc);
create index if not exists ordenes_servicio_estado_idx on public.ordenes_servicio (estado);

-- Reglas: solo en un local de servicio técnico; el local no cambia; marcas de tiempo del seguimiento
create or replace function public.preparar_orden_servicio()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.locales where id = new.local_id and tipo = 'servicio_tecnico') then
    raise exception 'Las órdenes de servicio solo se registran en un local de servicio técnico';
  end if;

  if tg_op = 'UPDATE' then
    if new.local_id <> old.local_id then
      raise exception 'Una orden de servicio no puede cambiar de local';
    end if;
    new.actualizada_en := now();
    if new.estado = 'listo' and old.estado <> 'listo' then new.listo_en := now(); end if;
    if new.estado = 'entregado' and old.estado <> 'entregado' then
      new.entregada_en := now();
      new.listo_en := coalesce(new.listo_en, now());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_preparar_orden_servicio on public.ordenes_servicio;
create trigger trg_preparar_orden_servicio
  before insert or update on public.ordenes_servicio
  for each row
  execute function public.preparar_orden_servicio();

alter table public.ordenes_servicio enable row level security;

drop policy if exists "Servicio: ver las de su local" on public.ordenes_servicio;
drop policy if exists "Servicio: crear en su local" on public.ordenes_servicio;
drop policy if exists "Servicio: actualizar las de su local" on public.ordenes_servicio;

create policy "Servicio: ver las de su local" on public.ordenes_servicio
  for select using (public.rol_actual() = 'administrador' or local_id = public.local_actual());

create policy "Servicio: crear en su local" on public.ordenes_servicio
  for insert with check (
    registrado_por = auth.uid()
    and (public.rol_actual() = 'administrador' or local_id = public.local_actual())
  );

create policy "Servicio: actualizar las de su local" on public.ordenes_servicio
  for update using (public.rol_actual() = 'administrador' or local_id = public.local_actual())
  with check (public.rol_actual() = 'administrador' or local_id = public.local_actual());
-- (sin política de borrado: las órdenes no se eliminan)
