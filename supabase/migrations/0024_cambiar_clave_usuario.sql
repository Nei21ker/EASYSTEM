-- ============================================================================
-- Cambiar la contraseña de un usuario desde el módulo Usuarios.
--
-- Requiere 0023_jerarquia_roles.sql.
--
--  · public.cambiar_clave_usuario(usuario, clave): fija una contraseña nueva.
--      - administrador: a cualquier usuario (incluida la suya).
--      - gerente: a encargados, vendedores y técnicos, y a sí mismo.
--      - el resto: nada.
--    La contraseña se guarda cifrada (bcrypt, como hace Supabase Auth) y NUNCA se puede volver a leer:
--    por eso la pantalla muestra la clave solo mientras se escribe y en el momento de guardarla.
--    Al cambiarla a OTRO usuario se cierran sus sesiones abiertas (auth.sessions / refresh_tokens),
--    así que tiene que entrar con la nueva.
--
-- Es idempotente.
-- ============================================================================

create or replace function public.cambiar_clave_usuario(p_usuario uuid, p_clave text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  objetivo public.perfiles;
begin
  select * into objetivo from public.perfiles where id = p_usuario;
  if not found then
    raise exception 'El usuario no existe';
  end if;

  if public.es_administrador() then
    null;
  elsif public.es_global() and public.catalogo_accesible()
        and (p_usuario = auth.uid() or objetivo.rol::text in ('encargado', 'vendedor', 'tecnico')) then
    null;
  else
    raise exception 'No tienes permiso para cambiar la contraseña de este usuario';
  end if;

  if p_clave is null or char_length(p_clave) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres';
  end if;

  update auth.users
  set encrypted_password = crypt(p_clave, gen_salt('bf')),
      updated_at = now()
  where id = p_usuario;

  -- A otro usuario se le cierran las sesiones abiertas: debe entrar con la contraseña nueva
  if p_usuario <> auth.uid() then
    delete from auth.refresh_tokens where user_id = p_usuario::text;
    delete from auth.sessions where user_id = p_usuario;
  end if;
end;
$$;

revoke all on function public.cambiar_clave_usuario(uuid, text) from public, anon;
grant execute on function public.cambiar_clave_usuario(uuid, text) to authenticated;
