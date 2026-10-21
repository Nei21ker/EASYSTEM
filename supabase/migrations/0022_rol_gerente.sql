-- ============================================================================
-- Jerarquía de roles (1/2): rol GERENTE.
--
--   administrador (dueño del servicio SaaS: todo, incluye suscripciones y sesiones)
--     └ gerente (dueño del negocio cliente: todos los locales; crea/elimina encargados, vendedores y técnicos)
--         └ encargado (un local)
--             └ vendedor / tecnico (un local)
--
-- IMPORTANTE: un valor nuevo de un enum no se puede usar en la misma transacción donde se crea,
-- por eso esta migración va SOLA: ejecútala y, cuando termine, ejecuta 0023_jerarquia_roles.sql.
-- Es idempotente.
-- ============================================================================

alter type public.rol_usuario add value if not exists 'gerente';
