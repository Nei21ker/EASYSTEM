-- ============================================================================
-- Nómina (2/2): empleados y pagos quincenales.
--
-- Requiere 0026_rol_contador.sql ejecutada ANTES (y terminada), y 0025.
--
--  · public.empleados: el PERSONAL que cobra sueldo en cada local (no es lo mismo que las cuentas de acceso
--    a EASYSTEM de la tabla perfiles: un empleado puede no tener usuario).
--  · public.nominas: un pago quincenal por empleado y período. Guarda el cálculo de ese momento:
--    pago_base (= salario_base / 2) + bonos - deducciones = total_pagado.
--  · Acceso (RLS): LECTURA y ESCRITURA de todos los locales para administrador, gerente y contador.
--    Encargado, vendedor y técnico NO ven nada de nómina. El contador no ve datos del negocio (ventas, stock):
--    solo empleados, nóminas y los locales (para filtrar). Un local con la suscripción suspendida bloquea su
--    nómina a gerente y contador (el administrador nunca queda bloqueado).
--  · Un pago PAGADO es inmutable (no se edita ni se borra); uno PENDIENTE se puede ajustar o borrar.
--  · Los empleados no se borran: se pasan a INACTIVO (así el historial de pagos se conserva).
--
-- Todos los montos están en dólares (la moneda base del sistema). Es idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Funciones de acceso
-- ----------------------------------------------------------------------------
create or replace function public.es_contador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.usuario_habilitado()
     and coalesce((select rol::text = 'contador' from public.perfiles where id = auth.uid()), false);
$$;

-- Acceso a la nómina de un local: administrador siempre; gerente y contador si el local tiene la suscripción vigente
create or replace function public.nomina_accesible(p_local uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.usuario_habilitado()
     and exists (
       select 1 from public.perfiles p
       where p.id = auth.uid()
         and (
           p.rol::text = 'administrador'
           or (p.rol::text in ('gerente', 'contador') and public.local_vigente(p_local))
         )
     );
$$;

grant execute on function public.es_contador(), public.nomina_accesible(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. empleados
-- ----------------------------------------------------------------------------
create table if not exists public.empleados (
  id               uuid primary key default gen_random_uuid(),
  local_id         uuid not null references public.locales (id),
  nombre           text not null check (char_length(btrim(nombre)) between 1 and 80),
  apellido         text not null check (char_length(btrim(apellido)) between 1 and 80),
  cedula           text not null unique check (char_length(btrim(cedula)) between 5 and 20),
  cargo            text not null check (char_length(btrim(cargo)) between 1 and 80),
  -- Salario MENSUAL en dólares; cada quincena se paga la mitad
  salario_base     numeric(12, 2) not null check (salario_base >= 0),
  frecuencia_pago  text not null default 'QUINCENAL' check (frecuencia_pago in ('QUINCENAL')),
  estado           text not null default 'ACTIVO' check (estado in ('ACTIVO', 'INACTIVO')),
  fecha_ingreso    date not null default current_date,
  created_at       timestamptz not null default now()
);

comment on table public.empleados is 'Personal que cobra sueldo en cada local (no son las cuentas de acceso: ver perfiles)';
comment on column public.empleados.salario_base is 'Salario mensual en dólares; la quincena es la mitad';

create index if not exists empleados_local_idx on public.empleados (local_id, estado);

alter table public.empleados enable row level security;

drop policy if exists "Empleados: ver (administrador, gerente, contador)" on public.empleados;
drop policy if exists "Empleados: crear (administrador, gerente, contador)" on public.empleados;
drop policy if exists "Empleados: editar (administrador, gerente, contador)" on public.empleados;

create policy "Empleados: ver (administrador, gerente, contador)" on public.empleados
  for select using (public.nomina_accesible(local_id));
create policy "Empleados: crear (administrador, gerente, contador)" on public.empleados
  for insert with check (public.nomina_accesible(local_id));
create policy "Empleados: editar (administrador, gerente, contador)" on public.empleados
  for update using (public.nomina_accesible(local_id)) with check (public.nomina_accesible(local_id));
-- (sin política de borrado: un empleado se pasa a INACTIVO)

-- ----------------------------------------------------------------------------
-- 3. nominas
-- ----------------------------------------------------------------------------
create table if not exists public.nominas (
  id             uuid primary key default gen_random_uuid(),
  empleado_id    uuid not null references public.empleados (id),
  local_id       uuid not null references public.locales (id),
  periodo_inicio date not null,
  periodo_fin    date not null,
  pago_base      numeric(12, 2) not null check (pago_base >= 0),
  bonos          numeric(12, 2) not null default 0 check (bonos >= 0),
  deducciones    numeric(12, 2) not null default 0 check (deducciones >= 0),
  total_pagado   numeric(12, 2) not null check (total_pagado >= 0),
  estado_pago    text not null default 'PENDIENTE' check (estado_pago in ('PENDIENTE', 'PAGADO')),
  pagado_en      timestamptz,
  notas          text check (notas is null or char_length(notas) <= 500),
  registrado_por uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint nominas_periodo_valido check (periodo_fin >= periodo_inicio),
  constraint nominas_total_coherente check (total_pagado = pago_base + bonos - deducciones),
  constraint nominas_un_pago_por_periodo unique (empleado_id, periodo_inicio, periodo_fin)
);

comment on table public.nominas is 'Pago quincenal de cada empleado: pago_base + bonos - deducciones = total_pagado';

create index if not exists nominas_periodo_idx on public.nominas (periodo_inicio, local_id);

-- Reglas: el local es siempre el del empleado; un pago pagado no se toca; marca de fecha al pagar
create or replace function public.preparar_nomina()
returns trigger
language plpgsql
as $$
declare
  local_empleado uuid;
begin
  if tg_op = 'UPDATE' then
    if old.estado_pago = 'PAGADO' then
      raise exception 'Un pago ya registrado como PAGADO no se puede modificar';
    end if;
    if new.empleado_id <> old.empleado_id or new.periodo_inicio <> old.periodo_inicio or new.periodo_fin <> old.periodo_fin then
      raise exception 'No se puede cambiar el empleado ni el período de un pago';
    end if;
  end if;

  select local_id into local_empleado from public.empleados where id = new.empleado_id;
  if local_empleado is null then
    raise exception 'El empleado no existe';
  end if;
  new.local_id := local_empleado;

  if new.estado_pago = 'PAGADO' then
    new.pagado_en := coalesce(new.pagado_en, now());
  else
    new.pagado_en := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_preparar_nomina on public.nominas;
create trigger trg_preparar_nomina
  before insert or update on public.nominas
  for each row
  execute function public.preparar_nomina();

alter table public.nominas enable row level security;

drop policy if exists "Nóminas: ver (administrador, gerente, contador)" on public.nominas;
drop policy if exists "Nóminas: crear (administrador, gerente, contador)" on public.nominas;
drop policy if exists "Nóminas: editar pendientes (administrador, gerente, contador)" on public.nominas;
drop policy if exists "Nóminas: borrar pendientes (administrador, gerente, contador)" on public.nominas;

create policy "Nóminas: ver (administrador, gerente, contador)" on public.nominas
  for select using (public.nomina_accesible(local_id));
create policy "Nóminas: crear (administrador, gerente, contador)" on public.nominas
  for insert with check (public.nomina_accesible(local_id));
create policy "Nóminas: editar pendientes (administrador, gerente, contador)" on public.nominas
  for update using (public.nomina_accesible(local_id) and estado_pago = 'PENDIENTE')
  with check (public.nomina_accesible(local_id));
create policy "Nóminas: borrar pendientes (administrador, gerente, contador)" on public.nominas
  for delete using (public.nomina_accesible(local_id) and estado_pago = 'PENDIENTE');

-- ----------------------------------------------------------------------------
-- 4. El contador necesita ver los locales (para filtrar); estado de la cuenta
-- ----------------------------------------------------------------------------
drop policy if exists "Locales: ver el propio (el administrador ve todos)" on public.locales;
create policy "Locales: ver el propio (el administrador ve todos)" on public.locales
  for select using (
    public.es_administrador()
    or (public.usuario_habilitado() and (public.es_global() or public.es_contador() or id = public.local_actual()))
  );

-- estado_cuenta: el contador, como el gerente, solo queda bloqueado si TODOS los locales están suspendidos
create or replace function public.estado_cuenta()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  perfil public.perfiles;
  local_fila public.locales;
  motivo text := 'ok';
  vigentes integer;
begin
  select * into perfil from public.perfiles where id = auth.uid();
  if not found then
    return jsonb_build_object('acceso', false, 'motivo', 'sin_perfil');
  end if;

  if perfil.local_id is not null then
    select * into local_fila from public.locales where id = perfil.local_id;
  end if;

  if perfil.status <> 'active' then
    motivo := 'usuario_inactivo';
  elsif not public.usuario_habilitado() then
    motivo := 'sesion_cerrada';
  elsif perfil.rol::text = 'administrador' then
    motivo := 'ok'; -- el administrador nunca queda bloqueado por una suscripción
  elsif perfil.rol::text in ('gerente', 'contador') then
    select count(*) into vigentes from public.locales l where public.local_vigente(l.id);
    if vigentes = 0 then motivo := 'local_suspendido'; end if;
  elsif perfil.local_id is null or not public.local_vigente(perfil.local_id) then
    motivo := 'local_suspendido';
  end if;

  return jsonb_build_object(
    'acceso', motivo = 'ok',
    'motivo', motivo,
    'rol', perfil.rol,
    'local_id', perfil.local_id,
    'local_nombre', local_fila.nombre,
    'subscription_status', local_fila.subscription_status,
    'subscription_expires_at', local_fila.subscription_expires_at
  );
end;
$$;

-- El gerente ve a los contadores en la lista de usuarios (solo lectura): ya lo permite la política de perfiles
-- (ve a todos menos a los administradores). Crear, editar, borrar o cambiar la clave de un contador:
-- solo el administrador (las funciones y políticas de 0023/0024 no incluyen 'contador' para el gerente).
