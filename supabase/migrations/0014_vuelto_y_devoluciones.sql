-- ============================================================================
-- Vuelto y devoluciones / cambios de producto.
--
-- 1. public.ventas.vuelto (jsonb): si el cliente pagó de más y se le dio vuelto,
--    { metodo, monto_usd, monto_bs } con lo que se entregó. Regla: la suma de los
--    pagos recibidos (ventas.pagos) menos el vuelto es igual al total de la venta.
-- 2. public.devoluciones: cada devolución o cambio de producto de una venta. Guarda
--    lo devuelto, lo entregado a cambio (si hubo), la diferencia (positiva = el
--    cliente pagó más; negativa = se le reembolsó) y cómo se cobró o devolvió el
--    dinero. El inventario se ajusta con movimientos normales (ENTRADA lo devuelto,
--    SALIDA lo entregado a cambio), no desde aquí.
--
-- Permisos: solo un administrador registra devoluciones (devolver mercancía al
-- inventario es una ENTRADA, que ya es solo de administradores, y mover dinero
-- merece control). Quien puede ver una venta (el administrador o el vendedor que la
-- hizo) puede ver sus devoluciones. Nadie edita ni borra devoluciones.
--
-- Requiere las migraciones 0011 a 0013. Es idempotente.
-- ============================================================================

alter table public.ventas add column if not exists vuelto jsonb check (vuelto is null or jsonb_typeof(vuelto) = 'object');

comment on column public.ventas.vuelto is '{ metodo, monto_usd, monto_bs } entregado como vuelto; sum(pagos.monto_usd) - vuelto.monto_usd = total';

create table if not exists public.devoluciones (
  id                uuid primary key default gen_random_uuid(),
  folio             bigint generated always as identity unique,
  fecha             timestamptz not null default now(),
  venta_id          uuid not null references public.ventas (id) on delete restrict,
  venta_folio       bigint not null,
  motivo            text not null check (char_length(btrim(motivo)) between 3 and 200),
  -- [{ producto_id, nombre, codigo_barras, cantidad, precio_unitario }]
  items_devueltos   jsonb not null check (jsonb_typeof(items_devueltos) = 'array' and jsonb_array_length(items_devueltos) > 0),
  items_nuevos      jsonb not null default '[]'::jsonb check (jsonb_typeof(items_nuevos) = 'array'),
  total_devuelto    numeric(12, 2) not null check (total_devuelto >= 0),
  total_nuevo       numeric(12, 2) not null default 0 check (total_nuevo >= 0),
  -- total_nuevo - total_devuelto: > 0 el cliente paga la diferencia, < 0 se le reembolsa
  diferencia        numeric(12, 2) not null,
  tasa_cambio       numeric(14, 4) check (tasa_cambio > 0),
  pagos             jsonb check (pagos is null or jsonb_typeof(pagos) = 'array'),
  vuelto            jsonb check (vuelto is null or jsonb_typeof(vuelto) = 'object'),
  reembolso         jsonb check (reembolso is null or jsonb_typeof(reembolso) = 'object'),
  registrado_por    uuid default auth.uid() references auth.users (id) on delete set null,
  registrado_nombre text
);

comment on table public.devoluciones is 'Devoluciones y cambios de producto sobre ventas del POS (el stock se mueve vía movimientos_inventario)';

create index if not exists devoluciones_venta_id_idx on public.devoluciones (venta_id);
create index if not exists devoluciones_fecha_idx on public.devoluciones (fecha desc);

alter table public.devoluciones enable row level security;

drop policy if exists "Devoluciones: ver las de las ventas visibles" on public.devoluciones;
drop policy if exists "Devoluciones: solo administrador registra" on public.devoluciones;

-- El subselect sobre ventas ya aplica la regla de ventas (vendedor = solo las suyas)
create policy "Devoluciones: ver las de las ventas visibles" on public.devoluciones
  for select using (
    public.rol_actual() = 'administrador'
    or exists (select 1 from public.ventas v where v.id = devoluciones.venta_id)
  );

create policy "Devoluciones: solo administrador registra" on public.devoluciones
  for insert with check (public.rol_actual() = 'administrador' and registrado_por = auth.uid());
