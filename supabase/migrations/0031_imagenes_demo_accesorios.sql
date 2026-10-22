-- ============================================================================
-- Imágenes de PRUEBA para los productos del Local Accesorios.
--
-- Pone en `productos.imagen_url` una ilustración de relleno (archivos del propio sitio en /img/demo/, ya
-- incluidos en el despliegue) a cada producto que el LOCAL ACCESORIOS maneja y que todavía no tiene foto.
-- La ilustración se elige por el nombre:
--   forro MagSafe / de silicona / antigolpes / transparente · cargador inalámbrico · de carro · cargador ·
--   cable · popsocket · audífonos · (cualquier otro) genérica.
--
-- NO pisa fotos reales: solo toca productos sin imagen. Cuando subas la foto real con "Editar", esa queda.
-- Es idempotente (volver a ejecutarla no cambia nada) y no toca los productos de los otros locales.
--
-- La misma regla está en src/lib/imagenes-demo.ts (modo demostración): si cambias una, cambia la otra.
-- ============================================================================

update public.productos p
set imagen_url = '/img/demo/' || case
    when p.nombre ilike 'forro%magsafe%'      then 'forro-magsafe'
    when p.nombre ilike 'forro%silicona%'     then 'forro-silicona'
    when p.nombre ilike 'forro%antigolpes%'   then 'forro-antigolpes'
    when p.nombre ilike 'forro%transparente%' then 'forro-transparente'
    when p.categoria ilike 'forros'           then 'forro-silicona'
    when p.nombre ilike '%inal_mbric%'        then 'cargador-inalambrico'
    when p.nombre ilike '%carro%'             then 'cargador-carro'
    when p.nombre ilike 'cable%'              then 'cable'
    when p.nombre ilike '%popsocket%' or p.categoria ilike 'popsocket%' then 'popsocket'
    when p.nombre ilike '%aud_fonos%'         then 'audifonos'
    when p.nombre ilike 'cargador%' or p.categoria ilike 'cargadores' then 'cargador'
    else 'generico'
  end || '.svg'
where (p.imagen_url is null or btrim(p.imagen_url) = '')
  and exists (
    select 1
    from public.inventario_local i
    where i.producto_id = p.id
      and i.local_id = '00000000-0000-4000-8000-000000000001'
  );
