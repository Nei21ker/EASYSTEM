-- ============================================================================
-- Jerarquía de roles (2/2): administrador > gerente > encargado > vendedor.
--
-- Requiere 0022_rol_gerente.sql ejecutada ANTES (y terminada), y 0021_suscripciones.sql.
-- Reemplaza el modelo "super_admin" de 0020/0021: ese poder pasa al ADMINISTRADOR.
--
--  · administrador: acceso total (todos los locales, aunque estén suspendidos), crea usuarios de
--    cualquier rol, los elimina, suspende/activa locales, cierra sesiones y ve la auditoría.
--    Nunca queda bloqueado por una suscripción.
--  · gerente: acceso global al negocio (todos los locales con suscripción vigente: catálogo,
--    entradas, devoluciones, reportes) pero NO administra suscripciones ni sesiones. En usuarios solo
--    puede crear y eliminar ENCARGADOS, VENDEDORES y TÉCNICOS (y cambiarles el local y el estado).
--  · encargado / vendedor / tecnico: como antes; no gestionan usuarios.
--
-- Los perfiles que hubieran quedado como 'super_admin' pasan a 'administrador'. Si en tu base el
-- dueño del negocio cliente figura como 'administrador', cámbialo a gerente:
--   update public.perfiles set rol = 'gerente' where email = 'dueno@cliente.com';
--
-- Es idempotente.
-- ============================================================================

-- Los super_admin de 0020/0021 (si los hubo) son ahora administradores
update public.perfiles set rol = 'administrador' where rol::text = 'super_admin';

-- ----------------------------------------------------------------------------
-- 1. Funciones de acceso
-- ----------------------------------------------------------------------------
create or replace function public.es_administrador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.usuario_habilitado()
     and coalesce((select rol::text = 'administrador' from public.perfiles where id = auth.uid()), false);
$$;

-- Administrador o gerente: acceso global al negocio (todos los locales)
create or replace function public.es_global()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.usuario_habilitado()
     and coalesce((select rol::text in ('administrador', 'gerente') from public.perfiles where id = auth.uid()), false);
$$;

-- Acceso a los datos de un local. El administrador entra siempre; el gerente a cualquier local con
-- suscripción vigente; el resto solo a su local si está vigente.
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
         and (
           p.rol::text = 'administrador'
           or (p.rol::text = 'gerente' and public.local_vigente(p_local))
           or (p.rol::text not in ('administrador', 'gerente') and p.local_id = p_local and public.local_vigente(p_local))
         )
     );
$$;

-- Acceso al catálogo compartido (productos, modelos, tasa)
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
         and (
           p.rol::text = 'administrador'
           or (p.rol::text = 'gerente' and exists (select 1 from public.locales l where public.local_vigente(l.id)))
           or (p.rol::text not in ('administrador', 'gerente') and p.local_id is not null and public.local_vigente(p.local_id))
         )
     );
$$;

grant execute on function public.es_administrador(), public.es_global() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Políticas de negocio: administrador y gerente son "globales"
-- ----------------------------------------------------------------------------
drop policy if exists "Administradores insertan productos" on public.productos;
drop policy if exists "Administradores actualizan productos" on public.productos;
drop policy if exists "Administradores eliminan productos" on public.productos;
create policy "Administradores insertan productos" on public.productos
  for insert with check (public.es_global() and public.catalogo_accesible());
create policy "Administradores actualizan productos" on public.productos
  for update using (public.es_global() and public.catalogo_accesible())
  with check (public.es_global() and public.catalogo_accesible());
create policy "Administradores eliminan productos" on public.productos
  for delete using (public.es_global() and public.catalogo_accesible());

drop policy if exists "Administradores insertan modelos" on public.modelos_telefono;
drop policy if exists "Administradores actualizan modelos" on public.modelos_telefono;
drop policy if exists "Administradores eliminan modelos" on public.modelos_telefono;
create policy "Administradores insertan modelos" on public.modelos_telefono
  for insert with check (public.es_global() and public.catalogo_accesible());
create policy "Administradores actualizan modelos" on public.modelos_telefono
  for update using (public.es_global() and public.catalogo_accesible())
  with check (public.es_global() and public.catalogo_accesible());
create policy "Administradores eliminan modelos" on public.modelos_telefono
  for delete using (public.es_global() and public.catalogo_accesible());

drop policy if exists "Administradores insertan compatibilidades" on public.compatibilidades;
drop policy if exists "Administradores actualizan compatibilidades" on public.compatibilidades;
drop policy if exists "Administradores eliminan compatibilidades" on public.compatibilidades;
create policy "Administradores insertan compatibilidades" on public.compatibilidades
  for insert with check (public.es_global() and public.catalogo_accesible());
create policy "Administradores actualizan compatibilidades" on public.compatibilidades
  for update using (public.es_global() and public.catalogo_accesible())
  with check (public.es_global() and public.catalogo_accesible());
create policy "Administradores eliminan compatibilidades" on public.compatibilidades
  for delete using (public.es_global() and public.catalogo_accesible());

-- Fotos de productos (Storage)
drop policy if exists "Fotos de productos: subir (solo administrador)" on storage.objects;
drop policy if exists "Fotos de productos: reemplazar (solo administrador)" on storage.objects;
drop policy if exists "Fotos de productos: borrar (solo administrador)" on storage.objects;
create policy "Fotos de productos: subir (solo administrador)" on storage.objects
  for insert with check (
    bucket_id = 'productos'
    and public.es_global()
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );
create policy "Fotos de productos: reemplazar (solo administrador)" on storage.objects
  for update using (bucket_id = 'productos' and public.es_global())
  with check (bucket_id = 'productos' and public.es_global());
create policy "Fotos de productos: borrar (solo administrador)" on storage.objects
  for delete using (bucket_id = 'productos' and public.es_global());

drop policy if exists "Inventario: solo administrador escribe directo" on public.inventario_local;
create policy "Inventario: solo administrador escribe directo" on public.inventario_local
  for all using (public.es_global() and public.local_accesible(local_id))
  with check (public.es_global() and public.local_accesible(local_id));

drop policy if exists "Movimientos: registrar en su local" on public.movimientos_inventario;
create policy "Movimientos: registrar en su local" on public.movimientos_inventario
  for insert with check (
    auth.role() = 'authenticated'
    and public.local_accesible(local_id)
    and (tipo = 'SALIDA' or public.rol_actual()::text in ('administrador', 'gerente', 'encargado'))
  );

drop policy if exists "Ventas: ver las de su local" on public.ventas;
create policy "Ventas: ver las de su local" on public.ventas
  for select using (
    public.local_accesible(local_id)
    and (public.rol_actual()::text in ('administrador', 'gerente', 'encargado') or vendedor_id = auth.uid())
  );

drop policy if exists "Devoluciones: ver las de las ventas visibles" on public.devoluciones;
drop policy if exists "Devoluciones: registrar (administrador o encargado del local)" on public.devoluciones;
create policy "Devoluciones: ver las de las ventas visibles" on public.devoluciones
  for select using (
    public.local_accesible(local_id)
    and (public.es_global() or exists (select 1 from public.ventas v where v.id = devoluciones.venta_id))
  );
create policy "Devoluciones: registrar (administrador o encargado del local)" on public.devoluciones
  for insert with check (
    registrado_por = auth.uid()
    and public.local_accesible(local_id)
    and public.rol_actual()::text in ('administrador', 'gerente', 'encargado')
  );

-- ----------------------------------------------------------------------------
-- 3. locales, auditoría y perfiles
-- ----------------------------------------------------------------------------
drop policy if exists "Locales: ver el propio (el administrador ve todos)" on public.locales;
drop policy if exists "Locales: solo super_admin escribe" on public.locales;
drop policy if exists "Locales: solo administrador escribe" on public.locales;
create policy "Locales: ver el propio (el administrador ve todos)" on public.locales
  for select using (
    public.es_administrador()
    or (public.usuario_habilitado() and (public.es_global() or id = public.local_actual()))
  );
create policy "Locales: solo administrador escribe" on public.locales
  for all using (public.es_administrador()) with check (public.es_administrador());

drop policy if exists "Eventos de suscripción: solo super_admin" on public.suscripcion_eventos;
drop policy if exists "Eventos de suscripción: solo administrador" on public.suscripcion_eventos;
create policy "Eventos de suscripción: solo administrador" on public.suscripcion_eventos
  for select using (public.es_administrador());

-- Perfiles: el administrador ve y edita todos; el gerente ve a todos menos a los administradores y
-- solo edita encargados, vendedores y técnicos (y solo puede dejarlos con uno de esos tres roles).
drop policy if exists "Los administradores ven todos los perfiles" on public.perfiles;
drop policy if exists "Los administradores actualizan cualquier perfil" on public.perfiles;
drop policy if exists "Perfiles: ver según la jerarquía" on public.perfiles;
drop policy if exists "Perfiles: actualizar según la jerarquía" on public.perfiles;

create policy "Perfiles: ver según la jerarquía" on public.perfiles
  for select using (
    public.catalogo_accesible()
    and (public.es_administrador() or (public.es_global() and rol::text <> 'administrador'))
  );
create policy "Perfiles: actualizar según la jerarquía" on public.perfiles
  for update using (
    public.catalogo_accesible()
    and (public.es_administrador() or (public.es_global() and rol::text in ('encargado', 'vendedor', 'tecnico')))
  )
  with check (public.es_administrador() or rol::text in ('encargado', 'vendedor', 'tecnico'));

-- Autorizar correos para crear cuentas (paso 1 del alta de usuarios): administrador y gerente
drop policy if exists "Administradores ven autorizaciones" on public.usuarios_autorizados;
drop policy if exists "Administradores crean autorizaciones" on public.usuarios_autorizados;
drop policy if exists "Administradores borran autorizaciones" on public.usuarios_autorizados;
create policy "Administradores ven autorizaciones" on public.usuarios_autorizados
  for select using (public.es_global());
create policy "Administradores crean autorizaciones" on public.usuarios_autorizados
  for insert with check (public.es_global());
create policy "Administradores borran autorizaciones" on public.usuarios_autorizados
  for delete using (public.es_global());

-- Candado de columnas sensibles (solo para quien llega con una sesión de la app; el SQL Editor pasa)
create or replace function public.proteger_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Nadie cambia su propio rol ni su propio estado (evita quedarse fuera por error)
  if new.id = auth.uid() and (new.rol is distinct from old.rol or new.status is distinct from old.status) then
    raise exception 'No puedes cambiar tu propio rol ni tu propio estado de cuenta';
  end if;

  if public.es_administrador() then
    return new;
  end if;

  if new.rol::text = 'administrador' or old.rol::text = 'administrador' then
    raise exception 'Solo el administrador puede asignar o modificar ese rol';
  end if;
  if new.rol is distinct from old.rol and new.rol::text not in ('encargado', 'vendedor', 'tecnico') then
    raise exception 'Solo puedes asignar los roles encargado, vendedor y técnico';
  end if;
  if new.last_force_logout_at is distinct from old.last_force_logout_at then
    raise exception 'El cierre de sesión forzado solo lo gestiona el administrador';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. RPC (solo administrador, salvo estado_cuenta y eliminar_usuario)
-- ----------------------------------------------------------------------------
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
  elsif perfil.rol::text = 'gerente' then
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
  if not public.es_administrador() then
    raise exception 'Solo el administrador puede cambiar suscripciones';
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
  if not public.es_administrador() then
    raise exception 'Solo el administrador puede ver esta lista';
  end if;

  return query
  select p.id, p.email, p.nombre, p.rol::text, p.status, p.local_id, l.nombre, l.subscription_status,
         u.last_sign_in_at, p.last_force_logout_at
  from public.perfiles p
  left join public.locales l on l.id = p.local_id
  left join auth.users u on u.id = p.id
  order by (p.rol::text = 'administrador') desc, (p.rol::text = 'gerente') desc, l.nombre nulls first, p.nombre;
end;
$$;

create or replace function public.cerrar_sesion_forzada(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_administrador() then
    raise exception 'Solo el administrador puede cerrar sesiones';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'No puedes cerrar tu propia sesión desde aquí';
  end if;
  if not exists (select 1 from public.perfiles where id = p_usuario) then
    raise exception 'El usuario no existe';
  end if;

  update public.perfiles set last_force_logout_at = now() where id = p_usuario;
  delete from auth.refresh_tokens where user_id = p_usuario::text;
  delete from auth.sessions where user_id = p_usuario;
end;
$$;

-- Todos los empleados de un local (los administradores no se incluyen)
create or replace function public.cerrar_sesiones_local(p_local uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  afectados uuid[];
begin
  if not public.es_administrador() then
    raise exception 'Solo el administrador puede cerrar sesiones';
  end if;

  select coalesce(array_agg(id), '{}') into afectados
  from public.perfiles
  where local_id = p_local and rol::text <> 'administrador';

  update public.perfiles set last_force_logout_at = now() where id = any (afectados);
  delete from auth.refresh_tokens where user_id = any (select unnest(afectados)::text);
  delete from auth.sessions where user_id = any (afectados);

  return coalesce(array_length(afectados, 1), 0);
end;
$$;

-- Eliminar un usuario: el administrador a cualquiera (menos a sí mismo); el gerente solo a encargados
-- y vendedores. Borra la cuenta de acceso (y su perfil); las ventas y órdenes que registró se conservan
-- con su nombre (las referencias quedan en blanco).
create or replace function public.eliminar_usuario(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  objetivo public.perfiles;
begin
  select * into objetivo from public.perfiles where id = p_usuario;
  if not found then
    raise exception 'El usuario no existe';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'No puedes eliminar tu propio usuario';
  end if;

  if public.es_administrador() then
    null;
  elsif public.es_global() and public.catalogo_accesible() and objetivo.rol::text in ('encargado', 'vendedor', 'tecnico') then
    null;
  else
    raise exception 'No tienes permiso para eliminar a este usuario';
  end if;

  delete from auth.users where id = p_usuario;
end;
$$;

revoke all on function public.eliminar_usuario(uuid) from public, anon;
grant execute on function public.eliminar_usuario(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Retirar el helper del modelo anterior (ya nada lo usa)
-- ----------------------------------------------------------------------------
drop function if exists public.es_super_admin();
