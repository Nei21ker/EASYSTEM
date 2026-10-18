-- ============================================================================
-- Multi-local (1/2): nuevos roles.
--
-- Agrega dos roles al enum public.rol_usuario:
--   · 'encargado' (gerente de un local): administra su local (entradas de stock,
--     devoluciones, reportes y ventas de ese local).
--   · 'tecnico'   (servicio técnico): trabaja las órdenes de servicio de su local.
-- Los roles existentes se conservan: 'administrador' (acceso global a todos los
-- locales) y 'vendedor' (cajero de un local).
--
-- IMPORTANTE: en PostgreSQL un valor nuevo de un enum no se puede USAR dentro de
-- la misma transacción donde se crea. Por eso esta migración va SOLA: ejecútala
-- primero y, cuando termine, ejecuta 0016_multilocal.sql.
-- Es idempotente.
-- ============================================================================

alter type public.rol_usuario add value if not exists 'encargado';
alter type public.rol_usuario add value if not exists 'tecnico';
