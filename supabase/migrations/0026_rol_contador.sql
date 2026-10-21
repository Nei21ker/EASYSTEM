-- ============================================================================
-- Nómina (1/2): rol CONTADOR.
--
-- Agrega 'contador' al enum public.rol_usuario. El contador solo ve el módulo de Nómina (de los 3 locales);
-- no ve ventas, stock, clientes ni catálogo. Lo crea y lo elimina únicamente el administrador.
--
-- IMPORTANTE: un valor nuevo de un enum no se puede usar en la misma transacción donde se crea,
-- por eso esta migración va SOLA: ejecútala primero y, cuando termine, ejecuta 0027_nomina.sql.
-- Es idempotente.
-- ============================================================================

alter type public.rol_usuario add value if not exists 'contador';
