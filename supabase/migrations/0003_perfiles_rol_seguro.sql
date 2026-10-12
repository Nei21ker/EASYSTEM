-- ============================================================================
-- Seguridad: el rol de un perfil nuevo SIEMPRE es 'vendedor'.
--
-- La versión de 0002 leía el rol de raw_user_meta_data, que el cliente controla:
-- cualquiera podía llamar a la API de Auth con la anon key y registrarse como
-- 'administrador'. Ahora el rol solo lo cambia un administrador existente
-- (política RLS "Los administradores actualizan cualquier perfil").
-- ============================================================================

create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, email, nombre, rol)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    'vendedor'
  );
  return new;
end;
$$;

-- Auditoría recomendada: revisa que nadie haya quedado como administrador
-- sin que tú lo hayas decidido.
--   select email, rol, created_at from public.perfiles order by created_at;
