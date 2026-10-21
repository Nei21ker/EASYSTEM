-- ============================================================================
-- El ENCARGADO crea y edita productos (módulo "Ingreso de mercancía").
--
-- Requiere 0023_jerarquia_roles.sql.
--
--  · Productos (insertar y actualizar), compatibilidades con modelos y fotos (Storage): ahora también
--    el encargado. ELIMINAR productos sigue siendo solo de administrador y gerente. El catálogo es
--    compartido por todos los locales, así que lo que cambie un encargado se ve en todos.
--  · inventario_local: el encargado puede dar de alta y fijar el stock mínimo de los productos de SU local.
--  · Candado de stock: el stock de un local solo cambia por movimientos (trigger SECURITY DEFINER). Para
--    que ningún rol pueda saltarse el kardex editando la tabla a mano, se quita el permiso de escribir
--    inventario_local.stock_actual al rol "authenticated": solo se puede escribir stock_minimo. El trigger
--    corre con permisos del dueño de la función, así que no le afecta.
--
-- Es idempotente.
-- ============================================================================

-- Administrador, gerente o encargado con sesión vigente
create or replace function public.es_gerencia()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.usuario_habilitado()
     and coalesce((select rol::text in ('administrador', 'gerente', 'encargado') from public.perfiles where id = auth.uid()), false);
$$;

grant execute on function public.es_gerencia() to authenticated;

-- ----------------------------------------------------------------------------
-- Catálogo
-- ----------------------------------------------------------------------------
drop policy if exists "Administradores insertan productos" on public.productos;
drop policy if exists "Administradores actualizan productos" on public.productos;
create policy "Administradores insertan productos" on public.productos
  for insert with check (public.es_gerencia() and public.catalogo_accesible());
create policy "Administradores actualizan productos" on public.productos
  for update using (public.es_gerencia() and public.catalogo_accesible())
  with check (public.es_gerencia() and public.catalogo_accesible());
-- (eliminar: sigue "Administradores eliminan productos" = administrador y gerente)

drop policy if exists "Administradores insertan compatibilidades" on public.compatibilidades;
drop policy if exists "Administradores actualizan compatibilidades" on public.compatibilidades;
drop policy if exists "Administradores eliminan compatibilidades" on public.compatibilidades;
create policy "Administradores insertan compatibilidades" on public.compatibilidades
  for insert with check (public.es_gerencia() and public.catalogo_accesible());
create policy "Administradores actualizan compatibilidades" on public.compatibilidades
  for update using (public.es_gerencia() and public.catalogo_accesible())
  with check (public.es_gerencia() and public.catalogo_accesible());
-- Editar un producto reescribe sus compatibilidades (borra y vuelve a insertar)
create policy "Administradores eliminan compatibilidades" on public.compatibilidades
  for delete using (public.es_gerencia() and public.catalogo_accesible());

-- Fotos de productos
drop policy if exists "Fotos de productos: subir (solo administrador)" on storage.objects;
drop policy if exists "Fotos de productos: reemplazar (solo administrador)" on storage.objects;
drop policy if exists "Fotos de productos: borrar (solo administrador)" on storage.objects;
create policy "Fotos de productos: subir (solo administrador)" on storage.objects
  for insert with check (
    bucket_id = 'productos'
    and public.es_gerencia()
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );
create policy "Fotos de productos: reemplazar (solo administrador)" on storage.objects
  for update using (bucket_id = 'productos' and public.es_gerencia())
  with check (bucket_id = 'productos' and public.es_gerencia());
create policy "Fotos de productos: borrar (solo administrador)" on storage.objects
  for delete using (bucket_id = 'productos' and public.es_gerencia());

-- ----------------------------------------------------------------------------
-- inventario_local: el encargado maneja el alta y el mínimo de SU local
-- ----------------------------------------------------------------------------
drop policy if exists "Inventario: el encargado da de alta en su local" on public.inventario_local;
drop policy if exists "Inventario: el encargado fija mínimos en su local" on public.inventario_local;
create policy "Inventario: el encargado da de alta en su local" on public.inventario_local
  for insert with check (public.rol_actual()::text = 'encargado' and public.local_accesible(local_id));
create policy "Inventario: el encargado fija mínimos en su local" on public.inventario_local
  for update using (public.rol_actual()::text = 'encargado' and public.local_accesible(local_id))
  with check (public.rol_actual()::text = 'encargado' and public.local_accesible(local_id));

-- Candado de stock: desde la API solo se escribe el mínimo; el stock cambia únicamente por movimientos
revoke insert, update on public.inventario_local from authenticated;
grant insert (local_id, producto_id, stock_minimo) on public.inventario_local to authenticated;
grant update (stock_minimo) on public.inventario_local to authenticated;
