-- ============================================================================
-- Tasa de cambio del dólar (Bs por $) y ventas con monto en bolívares.
--
-- Los precios del catálogo están en dólares; los bolívares se calculan con la tasa
-- del día (precio $ × tasa). La tasa se registra manualmente al entrar al sistema
-- por primera vez cada día y se guarda como HISTORIAL (cada cambio es una fila,
-- nunca se edita): la tasa vigente es la última registrada.
--
-- 1. public.tasas_cambio: cualquier usuario autenticado puede ver y registrar la
--    tasa (así nadie queda bloqueado esperando al administrador), siempre a su
--    nombre. No se permite editar ni borrar.
-- 2. public.ventas gana tasa_cambio y total_bs: la tasa usada en la venta y, si el
--    cobro fue en bolívares, el monto cobrado en Bs (queda fijo aunque la tasa cambie).
--
-- Requiere haber ejecutado antes la migración 0011 (tabla ventas).
-- Es idempotente: se puede ejecutar más de una vez.
-- ============================================================================

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
