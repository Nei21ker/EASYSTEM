-- ============================================================================
-- SaaS por suscripción (1/2): rol SUPER_ADMIN.
--
-- Agrega 'super_admin' al enum public.rol_usuario: la persona dueña/desarrolladora del
-- servicio, que administra las suscripciones de los locales y puede cerrar sesiones.
-- (El 'administrador' existente pasa a ser el "Gerente": el dueño del negocio cliente.)
--
-- IMPORTANTE: un valor nuevo de un enum no se puede usar en la misma transacción donde se
-- crea, por eso esta migración va SOLA: ejecútala primero y, cuando termine, ejecuta
-- 0021_suscripciones.sql.
--
-- Después, designa a tu usuario (reemplaza el correo por el tuyo):
--   update public.perfiles set rol = 'super_admin' where email = 'tu-correo@dominio.com';
-- Es idempotente.
-- ============================================================================

alter type public.rol_usuario add value if not exists 'super_admin';
