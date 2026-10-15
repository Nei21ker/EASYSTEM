-- ============================================================================
-- Registro cerrado: solo un administrador puede dar de alta cuentas.
--
-- EASYSTEM es de uso interno (jefe + empleados de Edward Accesorios), no para
-- clientes. Ocultar el botón "Crear cuenta" no basta: la anon key es pública
-- y cualquiera podría llamar a la API de Auth directamente. Por eso se bloquea
-- aquí, en la base de datos.
--
-- Cómo funciona:
--   1. Un administrador (con sesión) autoriza un correo insertándolo en
--      public.usuarios_autorizados (lo hace la app en /usuarios).
--   2. Se crea la cuenta de Auth con ese correo.
--   3. Este trigger (BEFORE INSERT en auth.users) solo deja pasar el alta si el
--      correo está autorizado y la autorización tiene menos de 10 minutos, y
--      la consume (la borra). Cualquier otro registro es rechazado.
--
-- Las cuentas que ya existen no se ven afectadas.
-- ============================================================================

create table if not exists public.usuarios_autorizados (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  created_at timestamptz not null default now()
);

comment on table public.usuarios_autorizados is
  'Correos que un administrador autorizó a registrarse; se consumen al crear la cuenta (vigencia 10 min)';

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
-- Alta de usuarios fuera de la app (p. ej. un proyecto nuevo sin administrador):
--   1. En el SQL Editor:
--        insert into public.usuarios_autorizados (email) values ('jefe@dominio.com');
--   2. DENTRO DE LOS SIGUIENTES 10 MINUTOS, en Authentication → Users →
--      Add user → Create new user (con "Auto Confirm User" activado).
--   3. Ascender a administrador:
--        update public.perfiles set rol = 'administrador' where email = 'jefe@dominio.com';
-- ----------------------------------------------------------------------------
