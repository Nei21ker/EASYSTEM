-- ============================================================================
-- Cuadre de caja diario (módulo "Reportes y cuadre").
--
-- Al cerrar el día, el encargado de cada local (o el administrador / gerente) compara lo que el sistema
-- espera haber cobrado con cada tipo de cobro contra lo que realmente hay (efectivo contado, capturas de
-- pagos móviles y de Binance, cierre del punto de venta) y adjunta las fotos de respaldo.
--
--  · Un cuadre por local y día (UNIQUE local_id + fecha). Estados: ABIERTO (borrador) → CERRADO.
--    Un cuadre CERRADO ya no se modifica; solo el administrador o el gerente pueden reabrirlo.
--  · `esperado` es la foto de lo que decía el sistema al guardar (por tipo de cobro, en $ y en Bs);
--    `contado` lo que se declaró (en la moneda de cada tipo); `fotos` las rutas de las imágenes.
--  · Acceso: administrador, gerente y encargado (cada encargado solo el de SU local, y todo mientras la
--    suscripción del local esté vigente: local_accesible). Vendedor y técnico no ven nada.
--  · Fotos en el bucket PRIVADO "cuadres-caja", ruta "<local_id>/<aaaa-mm-dd>/<tipo>-<hora>.jpg": la
--    aplicación pide un enlace firmado de 1 hora cada vez. Con el cuadre cerrado ya no se suben ni se
--    borran fotos (salvo el administrador / gerente).
--
-- Requiere 0023 (local_accesible, es_global), 0025 (es_gerencia) y 0030 (publicación realtime).
-- Es idempotente.
-- ============================================================================

create table if not exists public.cuadres_caja (
  id                uuid primary key default gen_random_uuid(),
  local_id          uuid not null references public.locales (id),
  fecha             date not null,
  estado            text not null default 'ABIERTO' check (estado in ('ABIERTO', 'CERRADO')),
  -- [{ metodo, ventas, usd, bs }] lo que el sistema esperaba al guardar
  esperado          jsonb not null default '[]'::jsonb check (jsonb_typeof(esperado) = 'array'),
  -- [{ metodo, monto }] lo declarado, en la moneda de cada tipo (Bs en los BS_*, $ en los demás)
  contado           jsonb not null default '[]'::jsonb check (jsonb_typeof(contado) = 'array'),
  -- [{ tipo, path }] tipo ∈ PAGO_MOVIL | BINANCE | EFECTIVO | CIERRE_PUNTO
  fotos             jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array'),
  notas             text check (notas is null or char_length(notas) <= 1000),
  registrado_por    uuid references auth.users (id) on delete set null,
  registrado_nombre text,
  cerrado_en        timestamptz,
  cerrado_por       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (local_id, fecha)
);

comment on table public.cuadres_caja is 'Cuadre de caja diario por local: esperado vs contado, con fotos de respaldo.';

create index if not exists cuadres_caja_fecha_idx on public.cuadres_caja (fecha desc, local_id);

-- ----------------------------------------------------------------------------
-- Reglas del cuadre
-- ----------------------------------------------------------------------------
create or replace function public.preparar_cuadre_caja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fecha > current_date + 1 then
    raise exception 'No se puede hacer el cuadre de un día futuro.';
  end if;
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.registrado_por := auth.uid();
    new.cerrado_en := case when new.estado = 'CERRADO' then now() else null end;
    return new;
  end if;

  -- El local, el día y quién lo creó no cambian nunca
  new.local_id := old.local_id;
  new.fecha := old.fecha;
  new.registrado_por := old.registrado_por;

  if old.estado = 'CERRADO' then
    if new.estado = 'ABIERTO' then
      if not public.es_global() then
        raise exception 'Solo el administrador o el gerente pueden reabrir un cuadre cerrado.';
      end if;
      new.cerrado_en := null;
      new.cerrado_por := null;
    else
      raise exception 'Este cuadre ya está cerrado y no se puede modificar.';
    end if;
  elsif new.estado = 'CERRADO' then
    new.cerrado_en := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_preparar_cuadre_caja on public.cuadres_caja;
create trigger trg_preparar_cuadre_caja
  before insert or update on public.cuadres_caja
  for each row
  execute function public.preparar_cuadre_caja();

-- ----------------------------------------------------------------------------
-- RLS: administrador, gerente y encargado, solo de los locales a los que acceden
-- ----------------------------------------------------------------------------
alter table public.cuadres_caja enable row level security;

drop policy if exists "Cuadres: ver" on public.cuadres_caja;
drop policy if exists "Cuadres: crear" on public.cuadres_caja;
drop policy if exists "Cuadres: actualizar" on public.cuadres_caja;

create policy "Cuadres: ver" on public.cuadres_caja
  for select using (public.es_gerencia() and public.local_accesible(local_id));

create policy "Cuadres: crear" on public.cuadres_caja
  for insert with check (public.es_gerencia() and public.local_accesible(local_id));

create policy "Cuadres: actualizar" on public.cuadres_caja
  for update using (public.es_gerencia() and public.local_accesible(local_id))
  with check (public.es_gerencia() and public.local_accesible(local_id));
-- (sin política de borrado: los cuadres no se eliminan)

revoke all on public.cuadres_caja from anon;
revoke delete, truncate on public.cuadres_caja from authenticated;
grant select, insert, update on public.cuadres_caja to authenticated;

-- ----------------------------------------------------------------------------
-- Fotos (bucket privado "cuadres-caja")
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('cuadres-caja', 'cuadres-caja', false)
on conflict (id) do update set public = false;

-- ¿Puede el usuario ver las fotos de este local? (primer nivel de la ruta = local)
create or replace function public.cuadre_foto_accesible(ruta text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case
      when (storage.foldername(ruta))[1] ~ '^[0-9a-fA-F-]{36}$'
        then public.es_gerencia() and public.local_accesible(((storage.foldername(ruta))[1])::uuid)
      else false
    end,
    false
  );
$$;

-- ¿Se pueden subir / borrar fotos de ese día? Solo mientras el cuadre no esté cerrado (el administrador y el gerente, siempre)
create or replace function public.cuadre_foto_editable(ruta text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.cuadre_foto_accesible(ruta)
     and (
       public.es_global()
       or not exists (
         select 1 from public.cuadres_caja c
         where c.estado = 'CERRADO'
           and c.local_id::text = (storage.foldername(ruta))[1]
           and c.fecha::text = (storage.foldername(ruta))[2]
       )
     );
$$;

grant execute on function public.cuadre_foto_accesible(text) to authenticated;
grant execute on function public.cuadre_foto_editable(text) to authenticated;

drop policy if exists "Cuadres de caja: ver fotos" on storage.objects;
drop policy if exists "Cuadres de caja: subir fotos" on storage.objects;
drop policy if exists "Cuadres de caja: borrar fotos" on storage.objects;

create policy "Cuadres de caja: ver fotos" on storage.objects
  for select using (bucket_id = 'cuadres-caja' and public.cuadre_foto_accesible(name));

create policy "Cuadres de caja: subir fotos" on storage.objects
  for insert with check (
    bucket_id = 'cuadres-caja'
    and public.cuadre_foto_editable(name)
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );

create policy "Cuadres de caja: borrar fotos" on storage.objects
  for delete using (bucket_id = 'cuadres-caja' and public.cuadre_foto_editable(name));

-- ----------------------------------------------------------------------------
-- Actualización en vivo
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cuadres_caja'
     ) then
    alter publication supabase_realtime add table public.cuadres_caja;
  end if;
end
$$;
