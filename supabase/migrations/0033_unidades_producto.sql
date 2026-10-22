-- ============================================================================
-- Código único por UNIDAD física.
--
-- Hasta ahora todas las unidades de un producto compartían el código del producto. Ahora cada unidad
-- tiene su propio código (EAN-13 con prefijo 21, que leen todos los lectores y la cámara):
--
--   · Una ENTRADA de N unidades crea N filas en `unidades_producto` (una etiqueta única por unidad).
--   · Una SALIDA (venta, repuesto, ajuste) marca unidades como VENDIDA: las que se indiquen en
--     `movimientos_inventario.unidad_codigos` (el POS las manda al escanear) y, si faltan, las más
--     antiguas disponibles del local (FIFO). Así una unidad no se puede vender dos veces.
--   · Una ENTRADA que lista códigos (devolución) reactiva esas unidades vendidas; el resto de la cantidad
--     crea unidades nuevas.
--   · La columna `unidad_codigos` del movimiento queda con TODOS los códigos que movió (para el ticket,
--     las etiquetas y la devolución).
--
-- Invariante: para cada producto y local, unidades DISPONIBLES = inventario_local.stock_actual. Las
-- unidades solo cambian por este trigger (nadie escribe la tabla directamente), igual que el stock.
--
-- Las unidades que ya existen en stock reciben su código aquí mismo (idempotente: solo crea las que
-- falten). Después hay que imprimir y pegar las etiquetas nuevas (Ingreso → etiquetas pendientes).
--
-- Requiere 0016+ (multi-local), 0023 (local_accesible) y 0025 (es_gerencia). Es idempotente.
-- ============================================================================

create sequence if not exists public.unidad_codigo_seq;

-- EAN-13 de uso interno de unidad: prefijo 21 + secuencia de 10 dígitos + dígito verificador.
-- Misma regla que src/utils/codigos.ts (construirCodigoUnidad). Distinto del prefijo 20 de los productos.
create or replace function public.ean13_unidad(secuencia bigint)
returns text
language sql
immutable
as $$
  select b.base || (((10 - (
    (select sum((substr(b.base, i, 1))::int * case when i % 2 = 1 then 1 else 3 end)
     from generate_series(1, 12) as i) % 10
  )) % 10))::text
  from (select '21' || lpad(secuencia::text, 10, '0') as base) b;
$$;

create table if not exists public.unidades_producto (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos (id) on delete cascade,
  local_id    uuid not null references public.locales (id),
  codigo      text not null unique,
  estado      text not null default 'DISPONIBLE' check (estado in ('DISPONIBLE', 'VENDIDA')),
  created_at  timestamptz not null default now(),
  vendida_en  timestamptz,
  -- Cuándo se imprimió su etiqueta (null = aún no tiene etiqueta pegada)
  impresa_en  timestamptz
);

comment on table public.unidades_producto is 'Una fila por unidad física, con su código único. Solo cambia por movimientos (trigger).';

create index if not exists unidades_producto_disponibles_idx
  on public.unidades_producto (producto_id, local_id, estado, created_at);
create index if not exists unidades_producto_local_idx on public.unidades_producto (local_id, estado);

alter table public.movimientos_inventario add column if not exists unidad_codigos text[];

-- ----------------------------------------------------------------------------
-- Lectura por RLS; escritura solo por el trigger (SECURITY DEFINER) y la función de impresión
-- ----------------------------------------------------------------------------
alter table public.unidades_producto enable row level security;

drop policy if exists "Unidades: ver las de su local" on public.unidades_producto;
create policy "Unidades: ver las de su local" on public.unidades_producto
  for select using (public.local_accesible(local_id));

revoke all on public.unidades_producto from anon;
revoke insert, update, delete, truncate on public.unidades_producto from authenticated;
grant select on public.unidades_producto to authenticated;

-- ----------------------------------------------------------------------------
-- Trigger: mueve las unidades junto con el movimiento
-- ----------------------------------------------------------------------------
create or replace function public.preparar_unidades_movimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigos  text[] := coalesce(new.unidad_codigos, '{}');
  v_cuantos  integer := cardinality(coalesce(new.unidad_codigos, '{}'));
  v_filas    integer;
  v_extra    text[];
  v_faltan   integer;
begin
  if v_cuantos > new.cantidad then
    raise exception 'Se indicaron % códigos de unidad para un movimiento de % unidades.', v_cuantos, new.cantidad;
  end if;
  if (select count(distinct c) from unnest(v_codigos) as c) <> v_cuantos then
    raise exception 'Hay códigos de unidad repetidos en el movimiento.';
  end if;

  if new.tipo = 'ENTRADA' then
    -- Devolución de unidades ya vendidas: vuelven a estar disponibles (en el local del movimiento)
    if v_cuantos > 0 then
      update public.unidades_producto
      set estado = 'DISPONIBLE', local_id = new.local_id, vendida_en = null
      where codigo = any (v_codigos) and producto_id = new.producto_id and estado = 'VENDIDA';
      get diagnostics v_filas = row_count;
      if v_filas <> v_cuantos then
        raise exception 'Alguna de las unidades indicadas no está vendida o no pertenece a este producto.';
      end if;
    end if;

    -- El resto de la cantidad son unidades nuevas, cada una con su código
    v_faltan := new.cantidad - v_cuantos;
    if v_faltan > 0 then
      with nuevas as (
        insert into public.unidades_producto (producto_id, local_id, codigo)
        select new.producto_id, new.local_id, public.ean13_unidad(nextval('public.unidad_codigo_seq'))
        from generate_series(1, v_faltan)
        returning codigo
      )
      select coalesce(array_agg(codigo), '{}') into v_extra from nuevas;
      v_codigos := v_codigos || v_extra;
    end if;
  else
    -- Unidades pedidas (las que se escanearon): deben estar disponibles en ESTE local
    if v_cuantos > 0 then
      update public.unidades_producto
      set estado = 'VENDIDA', vendida_en = now()
      where codigo = any (v_codigos) and producto_id = new.producto_id and local_id = new.local_id and estado = 'DISPONIBLE';
      get diagnostics v_filas = row_count;
      if v_filas <> v_cuantos then
        raise exception 'Alguna de las unidades escaneadas ya no está disponible (se vendió, es de otro local o de otro producto).';
      end if;
    end if;

    -- El resto sale por orden de llegada. Si no alcanzan (no debería: unidades = stock) el trigger de
    -- stock rechaza el movimiento con su mensaje de siempre.
    v_faltan := new.cantidad - v_cuantos;
    if v_faltan > 0 then
      with elegidas as (
        select id from public.unidades_producto
        where producto_id = new.producto_id and local_id = new.local_id and estado = 'DISPONIBLE'
          and not (codigo = any (v_codigos))
        order by created_at, id
        limit v_faltan
        for update
      ),
      marcadas as (
        update public.unidades_producto u
        set estado = 'VENDIDA', vendida_en = now()
        from elegidas e
        where u.id = e.id
        returning u.codigo
      )
      select coalesce(array_agg(codigo), '{}') into v_extra from marcadas;
      v_codigos := v_codigos || v_extra;
    end if;
  end if;

  new.unidad_codigos := v_codigos;
  return new;
end;
$$;

drop trigger if exists trg_preparar_unidades_movimiento on public.movimientos_inventario;
create trigger trg_preparar_unidades_movimiento
  before insert on public.movimientos_inventario
  for each row
  execute function public.preparar_unidades_movimiento();

-- ----------------------------------------------------------------------------
-- Etiquetas impresas: administrador, gerente y encargado marcan lo que ya imprimieron
-- ----------------------------------------------------------------------------
create or replace function public.marcar_unidades_impresas(p_codigos text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas integer;
begin
  if not public.es_gerencia() then
    raise exception 'Solo administrador, gerente o encargado pueden imprimir etiquetas.';
  end if;
  update public.unidades_producto
  set impresa_en = now()
  where codigo = any (p_codigos) and public.local_accesible(local_id);
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke all on function public.marcar_unidades_impresas(text[]) from public, anon;
grant execute on function public.marcar_unidades_impresas(text[]) to authenticated;

-- ----------------------------------------------------------------------------
-- Unidades de lo que ya hay en stock: una por cada unidad (solo las que falten)
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select i.local_id, i.producto_id, i.stock_actual - coalesce(u.n, 0) as faltan
    from public.inventario_local i
    left join (
      select producto_id, local_id, count(*)::integer as n
      from public.unidades_producto
      where estado = 'DISPONIBLE'
      group by producto_id, local_id
    ) u on u.producto_id = i.producto_id and u.local_id = i.local_id
    where i.stock_actual > coalesce(u.n, 0)
    order by i.local_id, i.producto_id
  loop
    insert into public.unidades_producto (producto_id, local_id, codigo)
    select r.producto_id, r.local_id, public.ean13_unidad(nextval('public.unidad_codigo_seq'))
    from generate_series(1, r.faltan);
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- Actualización en vivo (se agrega al final: así la carga inicial no genera miles de avisos)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'unidades_producto'
     ) then
    alter publication supabase_realtime add table public.unidades_producto;
  end if;
end
$$;
