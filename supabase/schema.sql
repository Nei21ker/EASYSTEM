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
  imagen_url     text,  -- foto del producto (Storage, bucket "productos"; migración 0009)
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
-- SECURITY DEFINER: una venta de un vendedor debe poder descontar stock aunque
-- él no tenga permiso de escritura sobre productos (ver sección 7).
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

-- Las políticas de ESCRITURA (solo administrador; ventas abiertas a vendedores)
-- dependen de public.rol_actual(), que se define más abajo: ver sección 7.

-- ----------------------------------------------------------------------------
-- Vista de apoyo para el Dashboard: stock bajo mínimo.
-- stock_minimo = 0 significa "sin control de reabastecimiento": no genera alerta.
-- ----------------------------------------------------------------------------
create or replace view public.vw_productos_stock_bajo as
select id, codigo_barras, nombre, categoria, stock_actual, stock_minimo
from public.productos
where stock_minimo > 0 and stock_actual <= stock_minimo
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
-- 6. usuarios_autorizados + trigger de registro cerrado (migración 0004)
--    El sistema es de uso interno: nadie puede registrarse por su cuenta.
--    Un administrador autoriza un correo (la app lo hace desde /usuarios), y el
--    trigger BEFORE INSERT en auth.users solo deja pasar el alta si el correo
--    está autorizado (vigencia 10 min) y consume la autorización.
-- ----------------------------------------------------------------------------
create table if not exists public.usuarios_autorizados (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  created_at timestamptz not null default now()
);

alter table public.usuarios_autorizados enable row level security;

create policy "Administradores ven autorizaciones" on public.usuarios_autorizados
  for select using (public.rol_actual() = 'administrador');
create policy "Administradores crean autorizaciones" on public.usuarios_autorizados
  for insert with check (public.rol_actual() = 'administrador');
create policy "Administradores borran autorizaciones" on public.usuarios_autorizados
  for delete using (public.rol_actual() = 'administrador');

create or replace function public.verificar_registro_autorizado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.usuarios_autorizados
  where lower(email) = lower(new.email)
    and created_at > now() - interval '10 minutes';

  if not found then
    raise exception 'REGISTRO_NO_AUTORIZADO: solo un administrador puede crear cuentas en EASYSTEM.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_verificar_registro on auth.users;
create trigger trg_verificar_registro
  before insert on auth.users
  for each row
  execute function public.verificar_registro_autorizado();

-- ----------------------------------------------------------------------------
-- Primer usuario administrador (bootstrap)
-- No es posible crear usuarios de Auth por SQL (las contraseñas las maneja
-- GoTrue) y el registro público está cerrado. Pasos:
--   1. insert into public.usuarios_autorizados (email) values ('jefe@dominio.com');
--   2. En los siguientes 10 min: Authentication → Users → Add user → Create new
--      user (con "Auto Confirm User").
--   3. update public.perfiles set rol = 'administrador' where email = 'jefe@dominio.com';
-- Desde ahí, ese administrador crea a los empleados en /usuarios.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 7. Permisos de escritura por rol y utilidades (migración 0006)
--    Lectura: cualquier usuario autenticado. Escritura de productos, modelos y
--    compatibilidades: solo administrador. Movimientos: cualquier autenticado
--    registra SALIDAS (ventas); las ENTRADAS (mercancía) solo el administrador.
-- ----------------------------------------------------------------------------
create policy "Administradores insertan productos" on public.productos
  for insert with check (public.rol_actual() = 'administrador');
create policy "Administradores actualizan productos" on public.productos
  for update using (public.rol_actual() = 'administrador') with check (public.rol_actual() = 'administrador');
create policy "Administradores eliminan productos" on public.productos
  for delete using (public.rol_actual() = 'administrador');

create policy "Administradores insertan modelos" on public.modelos_telefono
  for insert with check (public.rol_actual() = 'administrador');
create policy "Administradores actualizan modelos" on public.modelos_telefono
  for update using (public.rol_actual() = 'administrador') with check (public.rol_actual() = 'administrador');
create policy "Administradores eliminan modelos" on public.modelos_telefono
  for delete using (public.rol_actual() = 'administrador');

create policy "Administradores insertan compatibilidades" on public.compatibilidades
  for insert with check (public.rol_actual() = 'administrador');
create policy "Administradores actualizan compatibilidades" on public.compatibilidades
  for update using (public.rol_actual() = 'administrador') with check (public.rol_actual() = 'administrador');
create policy "Administradores eliminan compatibilidades" on public.compatibilidades
  for delete using (public.rol_actual() = 'administrador');

create policy "Salidas para autenticados, entradas solo administrador" on public.movimientos_inventario
  for insert with check (
    auth.role() = 'authenticated'
    and (tipo = 'SALIDA' or public.rol_actual() = 'administrador')
  );

-- Código de barras interno EAN-13 (prefijo 20 = uso interno de tiendas, GS1).
-- ean13_interno(1) -> '2000000000015'. Misma regla que src/utils/codigos.ts.
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

-- ----------------------------------------------------------------------------
-- 8. Fotos de productos (migración 0009)
--    Bucket público "productos": todos ven las fotos; solo un administrador
--    sube, reemplaza o borra, y solo imágenes jpg/jpeg/png/webp.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do update set public = true;

create policy "Fotos de productos: lectura" on storage.objects
  for select using (bucket_id = 'productos');
create policy "Fotos de productos: subir (solo administrador)" on storage.objects
  for insert with check (
    bucket_id = 'productos'
    and public.rol_actual() = 'administrador'
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );
create policy "Fotos de productos: reemplazar (solo administrador)" on storage.objects
  for update using (bucket_id = 'productos' and public.rol_actual() = 'administrador')
  with check (bucket_id = 'productos' and public.rol_actual() = 'administrador');
create policy "Fotos de productos: borrar (solo administrador)" on storage.objects
  for delete using (bucket_id = 'productos' and public.rol_actual() = 'administrador');

-- ----------------------------------------------------------------------------
-- 8. Ventas con datos del cliente y tipo de cobro (migración 0011)
-- ----------------------------------------------------------------------------
create table if not exists public.ventas (
  id               uuid primary key default gen_random_uuid(),
  folio            bigint generated always as identity unique,
  fecha            timestamptz not null default now(),
  cliente_cedula   text not null check (char_length(cliente_cedula) between 5 and 20),
  cliente_nombre   text not null check (char_length(btrim(cliente_nombre)) between 3 and 120),
  cliente_telefono text not null check (char_length(cliente_telefono) between 7 and 25),
  metodo_pago      text not null check (metodo_pago in (
                     'BS_PAGO_MOVIL', 'BS_PUNTO_VENTA', 'BS_EFECTIVO', 'USD_EFECTIVO', 'BINANCE_USDT')),
  total            numeric(12, 2) not null check (total >= 0),
  -- [{ producto_id, nombre, codigo_barras, cantidad, precio_unitario }]
  items            jsonb not null check (jsonb_typeof(items) = 'array'),
  vendedor_id      uuid default auth.uid() references auth.users (id) on delete set null,
  vendedor_nombre  text
);

comment on table public.ventas is 'Ventas del POS con datos del cliente y tipo de cobro (el stock se mueve vía movimientos_inventario)';

create index if not exists ventas_fecha_idx on public.ventas (fecha desc);
create index if not exists ventas_cliente_cedula_idx on public.ventas (cliente_cedula);
create index if not exists ventas_vendedor_id_idx on public.ventas (vendedor_id);

alter table public.ventas enable row level security;

drop policy if exists "Ventas: el administrador ve todas, el vendedor las suyas" on public.ventas;
drop policy if exists "Ventas: registrar a nombre propio" on public.ventas;

create policy "Ventas: el administrador ve todas, el vendedor las suyas" on public.ventas
  for select using (public.rol_actual() = 'administrador' or vendedor_id = auth.uid());

create policy "Ventas: registrar a nombre propio" on public.ventas
  for insert with check (auth.role() = 'authenticated' and vendedor_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 9. Tasa de cambio del dólar y ventas con monto en bolívares (migración 0012)
-- ----------------------------------------------------------------------------
create table if not exists public.tasas_cambio (
  id                uuid primary key default gen_random_uuid(),
  fecha             date not null,
  tasa              numeric(14, 4) not null check (tasa > 0 and tasa < 10000000),
  created_at        timestamptz not null default now(),
  registrado_por    uuid default auth.uid() references auth.users (id) on delete set null,
  registrado_nombre text
);

comment on table public.tasas_cambio is 'Historial de la tasa del dólar (Bs por $); la vigente es la última fila';

create index if not exists tasas_cambio_reciente_idx on public.tasas_cambio (created_at desc);

alter table public.tasas_cambio enable row level security;

drop policy if exists "Tasas: lectura para usuarios autenticados" on public.tasas_cambio;
drop policy if exists "Tasas: registrar a nombre propio" on public.tasas_cambio;

create policy "Tasas: lectura para usuarios autenticados" on public.tasas_cambio
  for select using (auth.role() = 'authenticated');

create policy "Tasas: registrar a nombre propio" on public.tasas_cambio
  for insert with check (auth.role() = 'authenticated' and registrado_por = auth.uid());

-- Ventas: tasa usada y monto en bolívares (null en ventas anteriores o cobradas en dólares)
alter table public.ventas add column if not exists tasa_cambio numeric(14, 4) check (tasa_cambio > 0);
alter table public.ventas add column if not exists total_bs numeric(14, 2) check (total_bs >= 0);

comment on column public.ventas.tasa_cambio is 'Bs por $ vigente al momento de la venta';
comment on column public.ventas.total_bs is 'Monto cobrado en bolívares (solo si el cobro fue en Bs)';
