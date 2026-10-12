-- ============================================================================
-- EASYSTEM · Edward Accesorios
-- Modelo de datos para gestión de inventario de accesorios de teléfono
-- Motor: PostgreSQL (Supabase)
--
-- Este archivo es la referencia "de lectura" del esquema completo (incluye
-- inventario + roles). Las migraciones incrementales aplicables viven en
-- supabase/migrations/0001_init.sql y 0002_perfiles.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. productos
--    Producto físico vendible (forro, cargador, vidrio templado, etc.).
--    `categoria` es un campo libre (Forros, Cargadores, Vidrios Templados...);
--    no requiere tabla propia porque no se le necesita CRUD independiente.
--    El stock vive aquí y se mantiene sincronizado mediante el trigger sobre
--    movimientos_inventario (ver más abajo).
-- ----------------------------------------------------------------------------
create table if not exists public.productos (
  id             uuid primary key default gen_random_uuid(),
  codigo_barras  text not null unique,
  nombre         text not null,
  categoria      text not null,
  precio_compra  numeric(10, 2) not null default 0 check (precio_compra >= 0),
  precio_venta   numeric(10, 2) not null default 0 check (precio_venta >= 0),
  stock_actual   integer not null default 0 check (stock_actual >= 0),
  stock_minimo   integer not null default 5 check (stock_minimo >= 0),
  created_at     timestamptz not null default now()
);

comment on table public.productos is 'Productos físicos del inventario (forros, cargadores, vidrios, etc.)';

create index if not exists productos_categoria_idx on public.productos (categoria);
create index if not exists productos_nombre_idx on public.productos using gin (to_tsvector('spanish', nombre));
create index if not exists productos_stock_bajo_idx on public.productos (stock_actual) where stock_actual <= stock_minimo;

-- ----------------------------------------------------------------------------
-- 2. modelos_telefono
--    Catálogo de modelos de teléfono con los que un producto puede ser
--    compatible. Ej: (Apple, iPhone 13), (Samsung, Galaxy A54).
-- ----------------------------------------------------------------------------
create table if not exists public.modelos_telefono (
  id         uuid primary key default gen_random_uuid(),
  marca      text not null,
  modelo     text not null,
  created_at timestamptz not null default now(),
  constraint modelos_telefono_marca_modelo_key unique (marca, modelo)
);

comment on table public.modelos_telefono is 'Catálogo de marcas/modelos de teléfono soportados';

-- ----------------------------------------------------------------------------
-- 3. compatibilidades
--    Relación N:M entre productos y modelos de teléfono: qué forro/vidrio
--    sirve para qué teléfono. Un producto puede tener muchos modelos
--    compatibles; un modelo puede tener muchos productos compatibles.
-- ----------------------------------------------------------------------------
create table if not exists public.compatibilidades (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references public.productos(id) on delete cascade,
  modelo_id    uuid not null references public.modelos_telefono(id) on delete cascade,
  constraint compatibilidades_producto_modelo_key unique (producto_id, modelo_id)
);

comment on table public.compatibilidades is 'Relación N:M entre productos y modelos de teléfono compatibles';

create index if not exists compatibilidades_producto_id_idx on public.compatibilidades (producto_id);
create index if not exists compatibilidades_modelo_id_idx on public.compatibilidades (modelo_id);

-- ----------------------------------------------------------------------------
-- 4. movimientos_inventario
--    Kardex de entradas y salidas de stock. Es la única vía soportada para
--    cambiar productos.stock_actual (ver trigger abajo): nunca se edita a mano.
-- ----------------------------------------------------------------------------
create table if not exists public.movimientos_inventario (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  tipo        text not null check (tipo in ('ENTRADA', 'SALIDA')),
  cantidad    integer not null check (cantidad > 0),
  fecha       timestamptz not null default now(),
  motivo      text
);

comment on table public.movimientos_inventario is 'Kardex de movimientos de inventario (ENTRADA / SALIDA)';

create index if not exists movimientos_inventario_producto_id_idx on public.movimientos_inventario (producto_id);
create index if not exists movimientos_inventario_fecha_idx on public.movimientos_inventario (fecha desc);

-- ----------------------------------------------------------------------------
-- Trigger: aplicar el movimiento al stock del producto
-- ----------------------------------------------------------------------------
create or replace function public.aplicar_movimiento_inventario()
returns trigger
language plpgsql
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

drop trigger if exists trg_aplicar_movimiento_inventario on public.movimientos_inventario;
create trigger trg_aplicar_movimiento_inventario
  after insert on public.movimientos_inventario
  for each row
  execute function public.aplicar_movimiento_inventario();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- Habilitado por defecto; ajustar políticas según el modelo de auth real
-- (por ahora: lectura pública de catálogo, escritura solo autenticados).
-- ----------------------------------------------------------------------------
alter table public.productos enable row level security;
alter table public.modelos_telefono enable row level security;
alter table public.compatibilidades enable row level security;
alter table public.movimientos_inventario enable row level security;

create policy "Lectura para usuarios autenticados" on public.productos for select using (auth.role() = 'authenticated');
create policy "Lectura para usuarios autenticados" on public.modelos_telefono for select using (auth.role() = 'authenticated');
create policy "Lectura para usuarios autenticados" on public.compatibilidades for select using (auth.role() = 'authenticated');
create policy "Lectura para usuarios autenticados" on public.movimientos_inventario for select using (auth.role() = 'authenticated');

create policy "Usuarios autenticados gestionan productos" on public.productos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Usuarios autenticados gestionan modelos" on public.modelos_telefono
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Usuarios autenticados gestionan compatibilidades" on public.compatibilidades
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Usuarios autenticados gestionan movimientos" on public.movimientos_inventario
  for insert with check (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Vista de apoyo para el Dashboard: stock bajo mínimo
-- ----------------------------------------------------------------------------
create or replace view public.vw_productos_stock_bajo as
select id, codigo_barras, nombre, categoria, stock_actual, stock_minimo
from public.productos
where stock_actual <= stock_minimo
order by stock_actual asc;

-- ----------------------------------------------------------------------------
-- 5. perfiles
--    Rol de cada usuario de Supabase Auth. auth.users no es accesible desde
--    el cliente (ni siquiera el email de otros usuarios), así que guardamos
--    aquí una copia mínima (email, nombre, rol) que sí se puede leer con RLS.
--
--    Administrador: acceso total (inventario, precios de costo, reportes
--    financieros, gestión de usuarios).
--    Vendedor: inventario sin precio de costo, POS y compatibilidades.
-- ----------------------------------------------------------------------------
create type public.rol_usuario as enum ('administrador', 'vendedor');

create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nombre     text not null,
  rol        public.rol_usuario not null default 'vendedor',
  created_at timestamptz not null default now()
);

comment on table public.perfiles is 'Rol de cada usuario (administrador / vendedor); 1:1 con auth.users';

-- Crea automáticamente un perfil (vendedor por defecto) cuando alguien se
-- registra. security definer: corre con permisos del dueño de la función,
-- necesario porque el usuario que se acaba de registrar aún no tiene
-- permisos para insertar en public.perfiles por sí mismo.
create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, email, nombre, rol)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    -- Siempre 'vendedor': el metadata lo controla el cliente, así que no se
    -- puede confiar en él para el rol (ver migración 0003).
    'vendedor'
  );
  return new;
end;
$$;

drop trigger if exists trg_nuevo_usuario on auth.users;
create trigger trg_nuevo_usuario
  after insert on auth.users
  for each row
  execute function public.manejar_nuevo_usuario();

-- Rol del usuario autenticado actual; se usa en las políticas de abajo.
create or replace function public.rol_actual()
returns public.rol_usuario
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.perfiles where id = auth.uid();
$$;

alter table public.perfiles enable row level security;

create policy "Cada usuario ve su propio perfil" on public.perfiles
  for select using (auth.uid() = id);
create policy "Los administradores ven todos los perfiles" on public.perfiles
  for select using (public.rol_actual() = 'administrador');
create policy "Los administradores actualizan cualquier perfil" on public.perfiles
  for update using (public.rol_actual() = 'administrador');

-- ----------------------------------------------------------------------------
-- Primer usuario administrador (bootstrap)
-- No es posible crear usuarios de Auth por SQL (las contraseñas las maneja
-- GoTrue). Pasos para el primer administrador:
--   1. Regístrate desde /login (el trigger de arriba lo crea como 'vendedor').
--   2. En el SQL Editor de Supabase:
--      update public.perfiles set rol = 'administrador' where email = 'tu-correo@dominio.com';
-- Desde ahí, ese administrador ya puede crear más usuarios en /usuarios.
-- ----------------------------------------------------------------------------
