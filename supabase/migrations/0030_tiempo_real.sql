-- ============================================================================
-- Actualización en vivo entre dispositivos (Supabase Realtime).
--
-- Agrega las tablas que escucha la aplicación (src/lib/realtime.ts) a la publicación "supabase_realtime".
-- Así, cuando alguien registra una venta, ingresa mercancía, paga la nómina, cambia la tasa, etc., las demás
-- pantallas abiertas se actualizan solas.
--
-- Seguridad: Realtime respeta las políticas RLS al entregar los cambios: cada usuario solo recibe avisos de
-- filas que ya puede leer (un vendedor no recibe nada de la nómina, un local suspendido deja de recibir los
-- suyos). La aplicación ignora el contenido del aviso y vuelve a pedir los datos por los canales de siempre.
--
-- Requiere 0027 (nómina) y las anteriores. Es idempotente.
-- ============================================================================

do $$
declare
  tabla text;
begin
  -- En Supabase la publicación ya existe; si no (otro Postgres), se crea
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach tabla in array array[
    'productos', 'inventario_local', 'movimientos_inventario', 'ventas', 'devoluciones', 'ordenes_servicio',
    'tasas_cambio', 'empleados', 'nominas', 'locales', 'perfiles', 'modelos_telefono', 'compatibilidades'
  ]
  loop
    if to_regclass('public.' || tabla) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tabla
       ) then
      execute format('alter publication supabase_realtime add table public.%I', tabla);
    end if;
  end loop;
end
$$;
