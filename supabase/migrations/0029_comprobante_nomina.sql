-- ============================================================================
-- Nómina: captura (comprobante) opcional del pago.
--
-- Requiere 0027_nomina.sql.
--
--  · nominas.comprobante_path: ruta de la imagen en el bucket "comprobantes-nomina" (o null si no hay).
--  · Bucket PRIVADO "comprobantes-nomina" (una captura de pago es un dato sensible: no hay URL pública, la
--    aplicación pide un enlace firmado de 1 hora cada vez que se abre). Las rutas son
--    "<local_id>/<archivo>.jpg" y las políticas usan ese primer nivel para aplicar el mismo acceso que la
--    nómina: administrador siempre; gerente y contador mientras el local tenga la suscripción vigente.
--    Encargado, vendedor y técnico no ven ni suben nada.
--  · Solo se pueden subir imágenes jpg, jpeg, png o webp.
--
-- Es idempotente.
-- ============================================================================

alter table public.nominas add column if not exists comprobante_path text
  check (comprobante_path is null or char_length(comprobante_path) <= 300);

comment on column public.nominas.comprobante_path is 'Ruta de la captura del pago en el bucket privado comprobantes-nomina (opcional)';

insert into storage.buckets (id, name, public)
values ('comprobantes-nomina', 'comprobantes-nomina', false)
on conflict (id) do update set public = false;

-- Acceso al archivo: el primer nivel de la ruta es el local
create or replace function public.comprobante_accesible(ruta text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case
      when (storage.foldername(ruta))[1] ~ '^[0-9a-fA-F-]{36}$' then public.nomina_accesible(((storage.foldername(ruta))[1])::uuid)
      else false
    end,
    false
  );
$$;

grant execute on function public.comprobante_accesible(text) to authenticated;

drop policy if exists "Comprobantes de nómina: ver" on storage.objects;
drop policy if exists "Comprobantes de nómina: subir" on storage.objects;
drop policy if exists "Comprobantes de nómina: borrar" on storage.objects;

create policy "Comprobantes de nómina: ver" on storage.objects
  for select using (bucket_id = 'comprobantes-nomina' and public.comprobante_accesible(name));

create policy "Comprobantes de nómina: subir" on storage.objects
  for insert with check (
    bucket_id = 'comprobantes-nomina'
    and public.comprobante_accesible(name)
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );

-- Borrar sirve para limpiar al reemplazar o quitar la captura de un pago pendiente
create policy "Comprobantes de nómina: borrar" on storage.objects
  for delete using (bucket_id = 'comprobantes-nomina' and public.comprobante_accesible(name));
