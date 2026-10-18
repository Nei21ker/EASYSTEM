-- ============================================================================
-- Ventas con datos del cliente y tipo de cobro.
--
-- Hasta ahora una venta del POS solo dejaba movimientos SALIDA sueltos. Ahora cada
-- venta del POS guarda además un registro en public.ventas: folio consecutivo,
-- cédula, nombre y teléfono del cliente, tipo de cobro, total y el detalle de
-- productos vendidos (con el precio del momento).
--
-- Privacidad: son datos personales del cliente, así que un vendedor solo ve las
-- ventas que él mismo registró; el administrador ve todas. Nadie puede editar ni
-- borrar una venta desde la aplicación (solo insertar), para conservar el historial.
--
-- Es idempotente: se puede ejecutar más de una vez.
-- ============================================================================

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
