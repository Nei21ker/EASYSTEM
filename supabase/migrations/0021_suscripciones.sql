-- ============================================================================
-- SaaS por suscripción (2/2): estado de cuenta por local, usuarios activos/inactivos y
-- cierre de sesión forzado.
--
-- Requiere 0020_rol_super_admin.sql ejecutada ANTES (y terminada), y 0016 (multi-local).
--
-- Roles: super_admin (quien opera el servicio SaaS) · administrador (= "Gerente", dueño del
-- negocio cliente) · encargado · vendedor · tecnico.
--
-- Qué hace:
--  · locales.subscription_status ('ACTIVE' | 'SUSPENDED' | 'PAST_DUE') y
--    locales.subscription_expires_at (opcional: pasada esa fecha el local deja de ser accesible).
--  · perfiles.status ('active' | 'inactive') y perfiles.last_force_logout_at.
--  · Funciones de acceso usadas por las políticas RLS:
--      es_super_admin()          rol super_admin
--      usuario_habilitado()      perfil activo y sesión no cerrada a la fuerza
--      local_accesible(local)    habilitado + local con suscripción vigente + es su local
--                                (el administrador entra a cualquier local vigente)
--      catalogo_accesible()      habilitado + al menos un local vigente a su alcance
--    Todas las políticas de datos de negocio las usan: con el local suspendido, vencido o en
--    mora, o el usuario inactivo o con la sesión cerrada, las consultas devuelven vacío y las
--    escrituras se rechazan. El super_admin NO ve datos de negocio (ventas, stock, clientes):
--    solo administra suscripciones y sesiones (mínimo privilegio).
--  · RPC solo para super_admin: estado_suscripcion de un local, usuarios_sistema(),
--    cerrar_sesion_forzada(usuario) y cerrar_sesiones_local(local). Cualquier usuario autenticado
--    puede llamar a estado_cuenta() para saber por qué no tiene acceso.
--  · Candados: un administrador no puede crear/ver/editar super_admins, ni cambiar suscripciones,
--    ni tocar last_force_logout_at (sino se reactivaría solo).
--  · Auditoría: public.suscripcion_eventos.
--
-- Cierre de sesión forzado: pone perfiles.last_force_logout_at = now() y borra las sesiones y
-- refresh tokens del usuario en auth. El access token que ya tenía (dura hasta 1 h) deja de
-- servir en el acto, porque las políticas comparan su "iat" con last_force_logout_at.
--
-- Es idempotente. Los datos existentes quedan ACTIVE / active: nadie pierde acceso al migrar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columnas
-- ----------------------------------------------------------------------------
alter table public.locales add column if not exists subscription_status text not null default 'ACTIVE';
alter table public.locales add column if not exists subscription_expires_at timestamptz;

alter table public.locales drop constraint if exists locales_subscription_status_check;
alter table public.locales add constraint locales_subscription_status_check
  check (subscription_status in ('ACTIVE', 'SUSPENDED', 'PAST_DUE'));

comment on column public.locales.subscription_status is 'ACTIVE = acceso normal; SUSPENDED o PAST_DUE = el local y sus empleados quedan bloqueados';
comment on column public.locales.subscription_expires_at is 'Vencimiento de la suscripción (opcional); pasada esta fecha el local deja de ser accesible';

alter table public.perfiles add column if not exists status text not null default 'active';
alter table public.perfiles add column if not exists last_force_logout_at timestamptz;

alter table public.perfiles drop constraint if exists perfiles_status_check;
alter table public.perfiles add constraint perfiles_status_check check (status in ('active', 'inactive'));

comment on column public.perfiles.status is 'inactive = el usuario no puede ver ni modificar datos (el administrador lo puede reactivar)';
comment on column public.perfiles.last_force_logout_at is 'Las sesiones emitidas antes de esta fecha dejan de funcionar (cierre forzado)';

-- ----------------------------------------------------------------------------
-- 2. Funciones de acceso (SECURITY DEFINER para poder leer perfiles/locales desde las políticas)
-- ----------------------------------------------------------------------------
create or replace function public.es_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select rol::text = 'super_admin' and status = 'active' from public.perfiles where id = auth.uid()), false);
$$;

-- Perfil activo y sesión vigente (el token no es anterior al último cierre forzado)
create or replace function public.usuario_habilitado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.status = 'active'
       and (
         p.last_force_logout_at is null
         or coalesce(nullif(auth.jwt() ->> 'iat', '')::bigint, 0) >= floor(extract(epoch from p.last_force_logout_at))::bigint
       )
    from public.perfiles p
    where p.id = auth.uid()
  ), false);
$$;

-- ¿Este local tiene la suscripción vigente?
create or replace function public.local_vigente(p_local uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select l.subscription_status = 'ACTIVE'
       and l.activo
       and (l.subscription_expires_at is null or l.subscription_expires_at > now())
    from public.locales l
    where l.id = p_local
  ), false);
$$;

-- Acceso a los datos de un local: usuario habilitado + suscripción vigente + es su local
-- (el administrador/gerente entra a cualquier local vigente). El super_admin no entra a datos de negocio.
create or replace function public.local_accesible(p_local uuid)
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
         and p.rol::text <> 'super_admin'
         and (p.rol::text = 'administrador' or p.local_id = p_local)
     )
     and public.local_vigente(p_local);
$$;

-- Acceso al catálogo compartido (productos, modelos, tasa): al menos un local vigente a su alcance
create or replace function public.catalogo_accesible()
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
         and p.rol::text <> 'super_admin'
         and (
           (p.rol::text = 'administrador' and exists (select 1 from public.locales l where public.local_vigente(l.id)))
           or (p.rol::text <> 'administrador' and p.local_id is not null and public.local_vigente(p.local_id))
         )
     );
$$;

grant execute on function public.es_super_admin(), public.usuario_habilitado(), public.local_vigente(uuid),
  public.local_accesible(uuid), public.catalogo_accesible() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Políticas: datos de negocio solo con acceso vigente
-- ----------------------------------------------------------------------------
-- Catálogo compartido
drop policy if exists "Lectura para usuarios autenticados" on public.productos;
drop policy if exists "Lectura para usuarios autenticados" on public.modelos_telefono;
drop policy if exists "Lectura para usuarios autenticados" on public.compatibilidades;
create policy "Lectura para usuarios autenticados" on public.productos for select using (public.catalogo_accesible());
create policy "Lectura para usuarios autenticados" on public.modelos_telefono for select using (public.catalogo_accesible());
create policy "Lectura para usuarios autenticados" on public.compatibilidades for select using (public.catalogo_accesible());

drop policy if exists "Administradores insertan productos" on public.productos;
drop policy if exists "Administradores actualizan productos" on public.productos;
drop policy if exists "Administradores eliminan productos" on public.productos;
create policy "Administradores insertan productos" on public.productos
  for insert with check (public.rol_actual() = 'administrador' and public.catalogo_accesible());
create policy "Administradores actualizan productos" on public.productos
  for update using (public.rol_actual() = 'administrador' and public.catalogo_accesible())
  with check (public.rol_actual() = 'administrador' and public.catalogo_accesible());
create policy "Administradores eliminan productos" on public.productos
  for delete using (public.rol_actual() = 'administrador' and public.catalogo_accesible());

drop policy if exists "Administradores insertan modelos" on public.modelos_telefono;
drop policy if exists "Administradores actualizan modelos" on public.modelos_telefono;
drop policy if exists "Administradores eliminan modelos" on public.modelos_telefono;
create policy "Administradores insertan modelos" on public.modelos_telefono
  for insert with check (public.rol_actual() = 'administrador' and public.catalogo_accesible());
create policy "Administradores actualizan modelos" on public.modelos_telefono
  for update using (public.rol_actual() = 'administrador' and public.catalogo_accesible())
  with check (public.rol_actual() = 'administrador' and public.catalogo_accesible());
create policy "Administradores eliminan modelos" on public.modelos_telefono
  for delete using (public.rol_actual() = 'administrador' and public.catalogo_accesible());

drop policy if exists "Administradores insertan compatibilidades" on public.compatibilidades;
drop policy if exists "Administradores actualizan compatibilidades" on public.compatibilidades;
drop policy if exists "Administradores eliminan compatibilidades" on public.compatibilidades;
create policy "Administradores insertan compatibilidades" on public.compatibilidades
  for insert with check (public.rol_actual() = 'administrador' and public.catalogo_accesible());
create policy "Administradores actualizan compatibilidades" on public.compatibilidades
  for update using (public.rol_actual() = 'administrador' and public.catalogo_accesible())
  with check (public.rol_actual() = 'administrador' and public.catalogo_accesible());
create policy "Administradores eliminan compatibilidades" on public.compatibilidades
  for delete using (public.rol_actual() = 'administrador' and public.catalogo_accesible());

-- Tasa del dólar
drop policy if exists "Tasas: lectura para usuarios autenticados" on public.tasas_cambio;
drop policy if exists "Tasas: registrar a nombre propio" on public.tasas_cambio;
create policy "Tasas: lectura para usuarios autenticados" on public.tasas_cambio
  for select using (public.catalogo_accesible());
create policy "Tasas: registrar a nombre propio" on public.tasas_cambio
  for insert with check (public.catalogo_accesible() and registrado_por = auth.uid());

-- Stock por local
drop policy if exists "Inventario: ver el de su local" on public.inventario_local;
drop policy if exists "Inventario: solo administrador escribe directo" on public.inventario_local;
create policy "Inventario: ver el de su local" on public.inventario_local
  for select using (public.local_accesible(local_id));
create policy "Inventario: solo administrador escribe directo" on public.inventario_local
  for all using (public.rol_actual() = 'administrador' and public.local_accesible(local_id))
  with check (public.rol_actual() = 'administrador' and public.local_accesible(local_id));

-- Movimientos
drop policy if exists "Movimientos: ver los de su local" on public.movimientos_inventario;
drop policy if exists "Movimientos: registrar en su local" on public.movimientos_inventario;
create policy "Movimientos: ver los de su local" on public.movimientos_inventario
  for select using (public.local_accesible(local_id));
create policy "Movimientos: registrar en su local" on public.movimientos_inventario
  for insert with check (
    auth.role() = 'authenticated'
    and public.local_accesible(local_id)
    and (tipo = 'SALIDA' or public.rol_actual() in ('administrador', 'encargado'))
  );

-- Ventas y devoluciones
drop policy if exists "Ventas: ver las de su local" on public.ventas;
drop policy if exists "Ventas: registrar en su local" on public.ventas;
create policy "Ventas: ver las de su local" on public.ventas
  for select using (
    public.local_accesible(local_id)
    and (public.rol_actual() in ('administrador', 'encargado') or vendedor_id = auth.uid())
  );
create policy "Ventas: registrar en su local" on public.ventas
  for insert with check (
    auth.role() = 'authenticated'
    and vendedor_id = auth.uid()
    and public.local_accesible(local_id)
  );

drop policy if exists "Devoluciones: ver las de las ventas visibles" on public.devoluciones;
drop policy if exists "Devoluciones: registrar (administrador o encargado del local)" on public.devoluciones;
create policy "Devoluciones: ver las de las ventas visibles" on public.devoluciones
  for select using (
    public.local_accesible(local_id)
    and (public.rol_actual() = 'administrador' or exists (select 1 from public.ventas v where v.id = devoluciones.venta_id))
  );
create policy "Devoluciones: registrar (administrador o encargado del local)" on public.devoluciones
  for insert with check (
    registrado_por = auth.uid()
    and public.local_accesible(local_id)
    and public.rol_actual() in ('administrador', 'encargado')
  );

-- Órdenes de servicio
drop policy if exists "Servicio: ver las de su local" on public.ordenes_servicio;
drop policy if exists "Servicio: crear en su local" on public.ordenes_servicio;
drop policy if exists "Servicio: actualizar las de su local" on public.ordenes_servicio;
create policy "Servicio: ver las de su local" on public.ordenes_servicio
  for select using (public.local_accesible(local_id));
create policy "Servicio: crear en su local" on public.ordenes_servicio
  for insert with check (registrado_por = auth.uid() and public.local_accesible(local_id));
create policy "Servicio: actualizar las de su local" on public.ordenes_servicio
  for update using (public.local_accesible(local_id)) with check (public.local_accesible(local_id));

-- ----------------------------------------------------------------------------
-- 4. locales y perfiles
-- ----------------------------------------------------------------------------
-- Cada quien ve su local (aunque esté suspendido: así la app puede mostrar el aviso); el
-- administrador ve todos; el super_admin ve todos. Escribir (incluida la suscripción) solo el super_admin.
drop policy if exists "Locales: ver el propio (el administrador ve todos)" on public.locales;
drop policy if exists "Locales: solo administrador escribe" on public.locales;
drop policy if exists "Locales: solo super_admin escribe" on public.locales;

create policy "Locales: ver el propio (el administrador ve todos)" on public.locales
  for select using (
    public.es_super_admin()
    or (public.usuario_habilitado() and (public.rol_actual() = 'administrador' or id = public.local_actual()))
  );

create policy "Locales: solo super_admin escribe" on public.locales
  for all using (public.es_super_admin()) with check (public.es_super_admin());

-- El administrador no ve ni edita a los super_admin y solo opera si su cuenta está vigente
drop policy if exists "Los administradores ven todos los perfiles" on public.perfiles;
drop policy if exists "Los administradores actualizan cualquier perfil" on public.perfiles;
create policy "Los administradores ven todos los perfiles" on public.perfiles
  for select using (public.rol_actual() = 'administrador' and public.catalogo_accesible() and rol::text <> 'super_admin');
create policy "Los administradores actualizan cualquier perfil" on public.perfiles
  for update using (public.rol_actual() = 'administrador' and public.catalogo_accesible() and rol::text <> 'super_admin')
  with check (rol::text <> 'super_admin');

-- Candado de columnas sensibles. Aplica a quien llega con una sesión de la app (auth.uid() no
-- nulo); el SQL Editor y el panel de Supabase (sin sesión) pueden hacer todo.
create or replace function public.proteger_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.es_super_admin() then
    return new;
  end if;

  if new.rol::text = 'super_admin' or old.rol::text = 'super_admin' then
    raise exception 'Solo un super administrador puede asignar o modificar ese rol';
  end if;
  if new.last_force_logout_at is distinct from old.last_force_logout_at then
    raise exception 'El cierre de sesión forzado solo lo gestiona el super administrador';
  end if;
  if new.id = auth.uid() and new.status is distinct from old.status then
    raise exception 'No puedes cambiar tu propio estado de cuenta';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_perfil on public.perfiles;
create trigger trg_proteger_perfil
  before update on public.perfiles
  for each row
  execute function public.proteger_perfil();

-- ----------------------------------------------------------------------------
-- 5. Auditoría de cambios de suscripción
-- ----------------------------------------------------------------------------
create table if not exists public.suscripcion_eventos (
  id               uuid primary key default gen_random_uuid(),
  local_id         uuid not null references public.locales (id) on delete cascade,
  estado_anterior  text,
  estado_nuevo     text not null,
  vence_anterior   timestamptz,
  vence_nuevo      timestamptz,
  cambiado_por     uuid references auth.users (id) on delete set null,
  fecha            timestamptz not null default now()
);

comment on table public.suscripcion_eventos is 'Historial de cambios de estado/vencimiento de la suscripción de cada local (solo lo ve el super_admin)';

alter table public.suscripcion_eventos enable row level security;
drop policy if exists "Eventos de suscripción: solo super_admin" on public.suscripcion_eventos;
create policy "Eventos de suscripción: solo super_admin" on public.suscripcion_eventos
  for select using (public.es_super_admin());

-- ----------------------------------------------------------------------------
-- 6. RPC
-- ----------------------------------------------------------------------------
-- 6.1 Estado de la cuenta del usuario actual (para el guard del cliente y la página de suspensión).
--     Disponible para cualquier usuario autenticado; no expone datos de negocio.
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
  elsif perfil.rol::text = 'super_admin' then
    motivo := 'ok';
  elsif perfil.rol::text = 'administrador' then
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

-- 6.2 Cambiar el estado de la suscripción de un local (solo super_admin)
create or replace function public.cambiar_suscripcion_local(
  p_local uuid,
  p_estado text,
  p_vence timestamptz default null,
  p_cambiar_vencimiento boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  anterior public.locales;
begin
  if not public.es_super_admin() then
    raise exception 'Solo el super administrador puede cambiar suscripciones';
  end if;
  if p_estado not in ('ACTIVE', 'SUSPENDED', 'PAST_DUE') then
    raise exception 'Estado de suscripción inválido: %', p_estado;
  end if;

  select * into anterior from public.locales where id = p_local for update;
  if not found then
    raise exception 'El local no existe';
  end if;

  update public.locales
  set subscription_status = p_estado,
      subscription_expires_at = case when p_cambiar_vencimiento then p_vence else subscription_expires_at end
  where id = p_local;

  insert into public.suscripcion_eventos (local_id, estado_anterior, estado_nuevo, vence_anterior, vence_nuevo, cambiado_por)
  values (
    p_local,
    anterior.subscription_status,
    p_estado,
    anterior.subscription_expires_at,
    case when p_cambiar_vencimiento then p_vence else anterior.subscription_expires_at end,
    auth.uid()
  );
end;
$$;

-- 6.3 Usuarios del sistema con su local y última actividad (solo super_admin)
create or replace function public.usuarios_sistema()
returns table (
  id uuid,
  email text,
  nombre text,
  rol text,
  status text,
  local_id uuid,
  local_nombre text,
  subscription_status text,
  last_sign_in_at timestamptz,
  last_force_logout_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_super_admin() then
    raise exception 'Solo el super administrador puede ver esta lista';
  end if;

  return query
  select p.id, p.email, p.nombre, p.rol::text, p.status, p.local_id, l.nombre, l.subscription_status,
         u.last_sign_in_at, p.last_force_logout_at
  from public.perfiles p
  left join public.locales l on l.id = p.local_id
  left join auth.users u on u.id = p.id
  order by (p.rol::text = 'super_admin') desc, l.nombre nulls first, p.nombre;
end;
$$;

-- 6.4 Cierre de sesión forzado de un usuario (solo super_admin)
create or replace function public.cerrar_sesion_forzada(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_super_admin() then
    raise exception 'Solo el super administrador puede cerrar sesiones';
  end if;
  if not exists (select 1 from public.perfiles where id = p_usuario) then
    raise exception 'El usuario no existe';
  end if;

  update public.perfiles set last_force_logout_at = now() where id = p_usuario;
  delete from auth.refresh_tokens where user_id = p_usuario::text;
  delete from auth.sessions where user_id = p_usuario;
end;
$$;

-- 6.5 Cierre de sesión forzado de todos los empleados de un local (el super_admin no se incluye)
create or replace function public.cerrar_sesiones_local(p_local uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  afectados uuid[];
begin
  if not public.es_super_admin() then
    raise exception 'Solo el super administrador puede cerrar sesiones';
  end if;

  select coalesce(array_agg(id), '{}') into afectados
  from public.perfiles
  where local_id = p_local and rol::text <> 'super_admin';

  update public.perfiles set last_force_logout_at = now() where id = any (afectados);
  delete from auth.refresh_tokens where user_id = any (select unnest(afectados)::text);
  delete from auth.sessions where user_id = any (afectados);

  return coalesce(array_length(afectados, 1), 0);
end;
$$;

revoke all on function public.cambiar_suscripcion_local(uuid, text, timestamptz, boolean) from public, anon;
revoke all on function public.usuarios_sistema() from public, anon;
revoke all on function public.cerrar_sesion_forzada(uuid) from public, anon;
revoke all on function public.cerrar_sesiones_local(uuid) from public, anon;
revoke all on function public.estado_cuenta() from public, anon;
grant execute on function public.estado_cuenta() to authenticated;
grant execute on function public.cambiar_suscripcion_local(uuid, text, timestamptz, boolean) to authenticated;
grant execute on function public.usuarios_sistema() to authenticated;
grant execute on function public.cerrar_sesion_forzada(uuid) to authenticated;
grant execute on function public.cerrar_sesiones_local(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Designar al super_admin (una sola vez, en el SQL Editor; usa una cuenta distinta de la del gerente):
--   update public.perfiles set rol = 'super_admin' where email = 'tu-correo@dominio.com';
-- Probar un bloqueo:
--   select public.cambiar_suscripcion_local('00000000-0000-4000-8000-000000000002', 'SUSPENDED');  -- como super_admin
-- ----------------------------------------------------------------------------
