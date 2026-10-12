-- ============================================================================
-- EASYSTEM · Roles y autenticación (Administrador / Vendedor)
-- Incremental sobre 0001_init.sql — ver supabase/schema.sql para el esquema
-- completo comentado.
-- ============================================================================

-- Antes la lectura del catálogo era pública (using (true)); ahora requiere sesión.
drop policy if exists "Lectura pública de catálogo" on public.productos;
drop policy if exists "Lectura pública de catálogo" on public.modelos_telefono;
drop policy if exists "Lectura pública de catálogo" on public.compatibilidades;
drop policy if exists "Lectura pública de catálogo" on public.movimientos_inventario;

create policy "Lectura para usuarios autenticados" on public.productos for select using (auth.role() = 'authenticated');
create policy "Lectura para usuarios autenticados" on public.modelos_telefono for select using (auth.role() = 'authenticated');
create policy "Lectura para usuarios autenticados" on public.compatibilidades for select using (auth.role() = 'authenticated');
create policy "Lectura para usuarios autenticados" on public.movimientos_inventario for select using (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- perfiles: rol de cada usuario de Supabase Auth
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
    coalesce((new.raw_user_meta_data ->> 'rol')::public.rol_usuario, 'vendedor')
  );
  return new;
end;
$$;

drop trigger if exists trg_nuevo_usuario on auth.users;
create trigger trg_nuevo_usuario
  after insert on auth.users
  for each row
  execute function public.manejar_nuevo_usuario();

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

-- Primer administrador (bootstrap): regístrate en /login y luego
--   update public.perfiles set rol = 'administrador' where email = 'tu-correo@dominio.com';
