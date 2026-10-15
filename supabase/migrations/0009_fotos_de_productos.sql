-- ============================================================================
-- Fotos de productos.
--
-- 1. Columna productos.imagen_url (URL pública de la foto; null = sin foto).
-- 2. Bucket de Supabase Storage "productos" (público: las fotos se muestran en
--    el POS y en las listas sin necesidad de firmar URLs).
-- 3. Permisos: cualquiera puede VER las fotos (bucket público); solo un
--    administrador puede subir, reemplazar o borrar, y solo imágenes
--    jpg / jpeg / png / webp.
--
-- Es idempotente: se puede ejecutar más de una vez.
-- ============================================================================

alter table public.productos add column if not exists imagen_url text;

comment on column public.productos.imagen_url is 'URL pública de la foto del producto (Supabase Storage, bucket "productos")';

-- Bucket público
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do update set public = true;

-- Políticas sobre storage.objects, solo para este bucket
drop policy if exists "Fotos de productos: lectura" on storage.objects;
drop policy if exists "Fotos de productos: subir (solo administrador)" on storage.objects;
drop policy if exists "Fotos de productos: reemplazar (solo administrador)" on storage.objects;
drop policy if exists "Fotos de productos: borrar (solo administrador)" on storage.objects;

create policy "Fotos de productos: lectura" on storage.objects
  for select using (bucket_id = 'productos');

create policy "Fotos de productos: subir (solo administrador)" on storage.objects
  for insert with check (
    bucket_id = 'productos'
    and public.rol_actual() = 'administrador'
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );

create policy "Fotos de productos: reemplazar (solo administrador)" on storage.objects
  for update using (bucket_id = 'productos' and public.rol_actual() = 'administrador')
  with check (bucket_id = 'productos' and public.rol_actual() = 'administrador');

create policy "Fotos de productos: borrar (solo administrador)" on storage.objects
  for delete using (bucket_id = 'productos' and public.rol_actual() = 'administrador');
