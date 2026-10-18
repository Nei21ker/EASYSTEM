-- ============================================================================
-- Pagos múltiples: un cliente puede pagar una venta con varios tipos de cobro.
--
-- 1. public.ventas.pagos (jsonb): el detalle de lo que se cobró con cada tipo de
--    cobro: [{ metodo, monto_usd, monto_bs }]. monto_usd es el valor en dólares
--    (la suma de todos es el total de la venta) y monto_bs lo que se recibió en
--    bolívares (null en los cobros en dólares/USDT).
-- 2. Cuando se usa más de un tipo de cobro, ventas.metodo_pago vale 'MIXTO'.
--    ventas.total_bs pasa a ser la suma de lo cobrado en bolívares.
-- 3. Las ventas ya registradas se completan con un único pago (su método y total),
--    así los reportes por tipo de cobro tratan igual las ventas viejas y las nuevas.
--
-- Requiere las migraciones 0011 y 0012. Es idempotente.
-- ============================================================================

alter table public.ventas add column if not exists pagos jsonb check (pagos is null or jsonb_typeof(pagos) = 'array');

comment on column public.ventas.pagos is '[{ metodo, monto_usd, monto_bs }] cobrado con cada tipo de cobro; suma de monto_usd = total';

-- metodo_pago admite además 'MIXTO' (varios tipos de cobro en una misma venta)
alter table public.ventas drop constraint if exists ventas_metodo_pago_check;
alter table public.ventas add constraint ventas_metodo_pago_check check (metodo_pago in (
  'BS_PAGO_MOVIL', 'BS_PUNTO_VENTA', 'BS_EFECTIVO', 'USD_EFECTIVO', 'BINANCE_USDT', 'MIXTO'));

-- Ventas anteriores: un solo pago por el total
update public.ventas
set pagos = jsonb_build_array(jsonb_build_object('metodo', metodo_pago, 'monto_usd', total, 'monto_bs', total_bs))
where pagos is null and metodo_pago <> 'MIXTO';
