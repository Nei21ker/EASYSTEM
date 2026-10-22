-- ============================================================================
-- Nómina: trabajadores INDEPENDIENTES (pago diario por reventa).
--
-- Requiere 0027_nomina.sql (y 0029 para el comprobante, 0030 para la actualización en vivo).
--
-- Hay dos tipos de trabajador:
--   · FIJO: como hasta ahora, cobra cada quincena (salario mensual / 2 + bonos - deducciones).
--   · INDEPENDIENTE: no tiene salario ni quincena. Revende productos y se le paga POR DÍA: ese día se arma
--     la lista de lo que revendió (producto, cantidad, precio de lista y precio al que lo vendió) y su
--     pago es la GANANCIA sobre el precio de lista: Σ cantidad × (precio vendido − precio de lista),
--     más bonos y menos deducciones. La lista NO descuenta stock: es solo el registro para pagarle.
--
-- Cada día de cada independiente es una fila de public.nominas (período = ese día, inicio = fin), así que
-- sigue valiendo todo lo de la nómina: estado PENDIENTE/PAGADO, un PAGADO no se toca, captura del pago, el
-- acceso por local (administrador, gerente y contador) y la actualización en vivo. La lista vive en
-- public.nomina_reventas.
--
-- Las listas se guardan con la función guardar_pago_independiente (una sola transacción: valida, calcula
-- el pago a partir de la lista, reemplaza las líneas y, si se pide, marca el pago como PAGADO). No hay
-- permisos de escritura directa sobre las líneas. Como el contador no puede leer el catálogo de productos,
-- la función catalogo_reventa le da, solo a los roles de nómina, lo mínimo para armar la lista
-- (nombre, código, categoría y precio de venta; nunca costos ni existencias).
--
-- Es idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tipo de trabajador
-- ----------------------------------------------------------------------------
alter table public.empleados add column if not exists tipo text not null default 'FIJO';

alter table public.empleados drop constraint if exists empleados_tipo_check;
alter table public.empleados add constraint empleados_tipo_check check (tipo in ('FIJO', 'INDEPENDIENTE'));

alter table public.empleados drop constraint if exists empleados_frecuencia_pago_check;
alter table public.empleados add constraint empleados_frecuencia_pago_check check (frecuencia_pago in ('QUINCENAL', 'DIARIO'));

alter table public.empleados drop constraint if exists empleados_tipo_frecuencia_coherente;
alter table public.empleados add constraint empleados_tipo_frecuencia_coherente check (
  (tipo = 'FIJO' and frecuencia_pago = 'QUINCENAL')
  or (tipo = 'INDEPENDIENTE' and frecuencia_pago = 'DIARIO')
);

comment on column public.empleados.tipo is 'FIJO (cobra por quincena) o INDEPENDIENTE (cobra por día según lo que revendió)';

-- ----------------------------------------------------------------------------
-- 2. Lista de lo revendido en el día
-- ----------------------------------------------------------------------------
create table if not exists public.nomina_reventas (
  id              uuid primary key default gen_random_uuid(),
  nomina_id       uuid not null references public.nominas (id) on delete cascade,
  local_id        uuid not null references public.locales (id),
  producto_id     uuid references public.productos (id) on delete set null,
  -- Datos del producto al momento de la reventa (el catálogo puede cambiar después)
  producto_nombre text not null check (char_length(btrim(producto_nombre)) between 1 and 200),
  producto_codigo text check (producto_codigo is null or char_length(producto_codigo) <= 60),
  cantidad        integer not null check (cantidad > 0),
  precio_lista    numeric(12, 2) not null check (precio_lista >= 0),
  precio_vendido  numeric(12, 2) not null check (precio_vendido >= 0),
  created_at      timestamptz not null default now(),
  constraint nomina_reventas_no_bajo_lista check (precio_vendido >= precio_lista)
);

comment on table public.nomina_reventas is 'Productos que un trabajador independiente revendió en un día; su ganancia (vendido - lista) es su pago';

create index if not exists nomina_reventas_nomina_idx on public.nomina_reventas (nomina_id);

alter table public.nomina_reventas enable row level security;

drop policy if exists "Reventas: ver (administrador, gerente, contador)" on public.nomina_reventas;
create policy "Reventas: ver (administrador, gerente, contador)" on public.nomina_reventas
  for select using (public.nomina_accesible(local_id));
-- (sin políticas de insertar/editar/borrar: solo la función guardar_pago_independiente escribe aquí)

-- ----------------------------------------------------------------------------
-- 3. Guardar el día de un independiente (lista + pago) en una sola transacción
-- ----------------------------------------------------------------------------
create or replace function public.guardar_pago_independiente(
  p_empleado uuid,
  p_dia date,
  p_lineas jsonb,
  p_bonos numeric default 0,
  p_deducciones numeric default 0,
  p_notas text default null,
  p_comprobante text default null,
  p_quitar_comprobante boolean default false,
  p_pagar boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.empleados;
  nom public.nominas;
  linea jsonb;
  v_cantidad integer;
  v_lista numeric(12, 2);
  v_vendido numeric(12, 2);
  v_base numeric(12, 2) := 0;
  v_bonos numeric(12, 2) := round(coalesce(p_bonos, 0), 2);
  v_deducciones numeric(12, 2) := round(coalesce(p_deducciones, 0), 2);
  v_total numeric(12, 2);
  v_lineas jsonb := coalesce(p_lineas, '[]'::jsonb);
  v_producto uuid;
  v_nombre text;
  v_ruta text;
  v_notas text := nullif(btrim(coalesce(p_notas, '')), '');
begin
  select * into emp from public.empleados where id = p_empleado;
  if not found then
    raise exception 'El trabajador no existe';
  end if;
  if not public.nomina_accesible(emp.local_id) then
    raise exception 'No tienes permiso para registrar pagos en este local';
  end if;
  if emp.tipo <> 'INDEPENDIENTE' then
    raise exception 'Este trabajador es fijo: su pago es quincenal';
  end if;
  if jsonb_typeof(v_lineas) <> 'array' then
    raise exception 'La lista de productos no es válida';
  end if;
  if v_bonos < 0 or v_deducciones < 0 then
    raise exception 'Los bonos y las deducciones no pueden ser negativos';
  end if;

  select * into nom
  from public.nominas
  where empleado_id = p_empleado and periodo_inicio = p_dia and periodo_fin = p_dia
  for update;

  if found and nom.estado_pago = 'PAGADO' then
    raise exception 'El pago de ese día ya está registrado como PAGADO y no se puede modificar';
  end if;
  if not found and emp.estado <> 'ACTIVO' then
    raise exception 'El trabajador está inactivo';
  end if;

  -- Validar la lista y calcular la ganancia (Σ cantidad × (vendido − lista))
  for linea in select value from jsonb_array_elements(v_lineas) loop
    v_nombre := btrim(coalesce(linea ->> 'producto_nombre', ''));
    if v_nombre = '' then
      raise exception 'Cada línea debe tener el nombre del producto';
    end if;
    v_cantidad := (linea ->> 'cantidad')::integer;
    v_lista := round((linea ->> 'precio_lista')::numeric, 2);
    v_vendido := round((linea ->> 'precio_vendido')::numeric, 2);
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad de "%" debe ser mayor a 0', v_nombre;
    end if;
    if v_lista is null or v_lista < 0 or v_vendido is null then
      raise exception 'Los precios de "%" no son válidos', v_nombre;
    end if;
    if v_vendido < v_lista then
      raise exception '"%" no puede venderse por debajo de su precio ($% < $%)', v_nombre, v_vendido, v_lista;
    end if;
    v_base := v_base + v_cantidad * (v_vendido - v_lista);
  end loop;

  v_base := round(v_base, 2);
  v_total := v_base + v_bonos - v_deducciones;
  if v_total < 0 then
    raise exception 'Las deducciones no pueden superar la ganancia más los bonos';
  end if;
  if p_pagar and jsonb_array_length(v_lineas) = 0 then
    raise exception 'Agrega al menos un producto a la lista antes de registrar el pago';
  end if;

  -- La captura del pago debe estar en la carpeta del local del trabajador
  v_ruta := nullif(btrim(coalesce(p_comprobante, '')), '');
  if v_ruta is not null and left(v_ruta, 37) <> emp.local_id::text || '/' then
    raise exception 'La captura del pago no corresponde a este local';
  end if;

  if nom.id is null then
    insert into public.nominas
      (empleado_id, local_id, periodo_inicio, periodo_fin, pago_base, bonos, deducciones, total_pagado, estado_pago, notas, comprobante_path)
    values
      (p_empleado, emp.local_id, p_dia, p_dia, v_base, v_bonos, v_deducciones, v_total, 'PENDIENTE', v_notas, v_ruta)
    returning * into nom;
  else
    update public.nominas n
    set pago_base = v_base,
        bonos = v_bonos,
        deducciones = v_deducciones,
        total_pagado = v_total,
        notas = v_notas,
        comprobante_path = case when v_ruta is not null then v_ruta when p_quitar_comprobante then null else n.comprobante_path end
    where n.id = nom.id
    returning * into nom;
  end if;

  -- Reemplazar la lista (un día PENDIENTE se puede rehacer cuantas veces haga falta)
  delete from public.nomina_reventas r where r.nomina_id = nom.id;
  for linea in select value from jsonb_array_elements(v_lineas) loop
    v_producto := null;
    if nullif(linea ->> 'producto_id', '') is not null
       and exists (select 1 from public.productos p where p.id = (linea ->> 'producto_id')::uuid) then
      v_producto := (linea ->> 'producto_id')::uuid;
    end if;
    insert into public.nomina_reventas
      (nomina_id, local_id, producto_id, producto_nombre, producto_codigo, cantidad, precio_lista, precio_vendido)
    values
      (nom.id, emp.local_id, v_producto, btrim(linea ->> 'producto_nombre'), nullif(btrim(coalesce(linea ->> 'producto_codigo', '')), ''),
       (linea ->> 'cantidad')::integer, round((linea ->> 'precio_lista')::numeric, 2), round((linea ->> 'precio_vendido')::numeric, 2));
  end loop;

  -- Por último, si se pidió, se marca como pagado (a partir de aquí ya no se modifica)
  if p_pagar then
    update public.nominas n set estado_pago = 'PAGADO' where n.id = nom.id;
  end if;

  return nom.id;
end;
$$;

revoke all on function public.guardar_pago_independiente(uuid, date, jsonb, numeric, numeric, text, text, boolean, boolean) from public, anon;
grant execute on function public.guardar_pago_independiente(uuid, date, jsonb, numeric, numeric, text, text, boolean, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Productos para armar la lista (el contador no lee el catálogo directamente)
-- ----------------------------------------------------------------------------
create or replace function public.catalogo_reventa(p_busqueda text default null, p_limite integer default 30)
returns table (id uuid, codigo_barras text, nombre text, categoria text, precio_venta numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  texto text := lower(btrim(coalesce(p_busqueda, '')));
begin
  if not public.usuario_habilitado()
     or coalesce((select pf.rol::text from public.perfiles pf where pf.id = auth.uid()), '') not in ('administrador', 'gerente', 'contador') then
    raise exception 'No tienes permiso para consultar productos de reventa';
  end if;
  if texto = '' then
    return;
  end if;

  return query
  select p.id, p.codigo_barras, p.nombre, p.categoria, p.precio_venta
  from public.productos p
  where position(texto in lower(p.nombre)) > 0
     or position(texto in lower(p.codigo_barras)) > 0
     or position(texto in lower(p.categoria)) > 0
  order by (p.codigo_barras = btrim(coalesce(p_busqueda, ''))) desc, p.nombre
  limit greatest(1, least(coalesce(p_limite, 30), 60));
end;
$$;

revoke all on function public.catalogo_reventa(text, integer) from public, anon;
grant execute on function public.catalogo_reventa(text, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Actualización en vivo de las listas
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nomina_reventas'
  ) then
    alter publication supabase_realtime add table public.nomina_reventas;
  end if;
end
$$;
