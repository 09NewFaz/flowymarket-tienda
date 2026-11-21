-- FlowyMarket · esquema de base de datos, seguridad (RLS) y funciones.
-- Ejecutar una sola vez en Supabase → SQL Editor. Es idempotente en lo posible.
--
-- Modelo de seguridad:
--   * Lectura pública: configuración de la tienda, categorías y productos visibles.
--   * Escritura: solo usuarios listados en public.admins (verificado en el servidor con is_admin()).
--   * Pedidos: nadie inserta directamente; solo la función place_order(), que recalcula
--     precios, opciones, envío, impuestos y descuentos, y descuenta stock de forma atómica.
--   * Códigos de descuento: nunca se exponen al público.

create extension if not exists pgcrypto;

-- ---------- administradores ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

-- ---------- configuración pública de la tienda ----------
create table if not exists public.shop_config (
  id int primary key default 1 check (id = 1),
  store jsonb not null default '{}',
  design jsonb not null default '{}',
  checkout jsonb not null default '{}',
  payments jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.stats (
  id int primary key default 1 check (id = 1),
  visits bigint not null default 0
);
insert into public.stats (id) values (1) on conflict do nothing;

-- ---------- catálogo ----------
create table if not exists public.categories (
  id text primary key check (id ~ '^[a-z0-9]{1,24}$'),
  name text not null check (char_length(name) between 1 and 80),
  parent text references public.categories(id) on delete cascade,
  position int not null default 0
);

create table if not exists public.products (
  id text primary key check (id ~ '^[a-z0-9]{1,24}$'),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 3000),
  price numeric(12,2) not null default 0 check (price >= 0),
  offer numeric(12,2) check (offer is null or offer >= 0),
  category_id text references public.categories(id) on delete set null,
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  hidden boolean not null default false,
  stock int not null default 99999 check (stock between 0 and 99999),
  cart boolean not null default true,
  img text not null default '' check (char_length(img) <= 500),
  imgs text[] not null default '{}' check (cardinality(imgs) <= 10),
  options jsonb not null default '[]' check (jsonb_typeof(options) = 'array'),
  position int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.promos (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{2,40}$'),
  type text not null check (type in ('pct', 'fix')),
  value numeric(12,2) not null check (value >= 0),
  active boolean not null default true,
  check (type <> 'pct' or value <= 100)
);
create unique index if not exists promos_code_lower on public.promos (lower(code));

-- ---------- pedidos ----------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  num bigint generated always as identity (start with 1001) unique,
  created_at timestamptz not null default now(),
  status text not null default 'Recibido' check (status in ('Recibido', 'En Preparación', 'Listo', 'Entregado', 'Cancelado')),
  paid boolean not null default false,  -- solo lo marca el administrador a mano
  customer jsonb not null default '{}',
  type text not null,
  address jsonb not null default '{}',
  pay text not null default '',
  answers jsonb not null default '[]',
  items jsonb not null,
  subtotal numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  promo text,
  client_ip text
);
create index if not exists orders_created_at on public.orders (created_at desc);

create table if not exists public.order_rate (
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists order_rate_ip_at on public.order_rate (ip, at);

-- ---------- RLS ----------
alter table public.admins      enable row level security;
alter table public.shop_config enable row level security;
alter table public.stats       enable row level security;
alter table public.categories  enable row level security;
alter table public.products    enable row level security;
alter table public.promos      enable row level security;
alter table public.orders      enable row level security;
alter table public.order_rate  enable row level security;

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated using (user_id = auth.uid());

drop policy if exists cfg_read on public.shop_config;
drop policy if exists cfg_insert on public.shop_config;
drop policy if exists cfg_update on public.shop_config;
create policy cfg_read   on public.shop_config for select to anon, authenticated using (true);
create policy cfg_insert on public.shop_config for insert to authenticated with check (public.is_admin());
create policy cfg_update on public.shop_config for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists stats_admin on public.stats;
create policy stats_admin on public.stats for select to authenticated using (public.is_admin());

drop policy if exists cat_read on public.categories;
drop policy if exists cat_admin on public.categories;
create policy cat_read  on public.categories for select to anon, authenticated using (true);
create policy cat_admin on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists prod_read on public.products;
drop policy if exists prod_admin on public.products;
create policy prod_read  on public.products for select to anon, authenticated using (not hidden or public.is_admin());
create policy prod_admin on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists promos_admin on public.promos;
create policy promos_admin on public.promos for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists ord_select on public.orders;
drop policy if exists ord_update on public.orders;
drop policy if exists ord_delete on public.orders;
create policy ord_select on public.orders for select to authenticated using (public.is_admin());
create policy ord_update on public.orders for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ord_delete on public.orders for delete to authenticated using (public.is_admin());
-- order_rate: sin políticas (solo accesible desde funciones security definer)

-- privilegios por columna: el administrador solo puede cambiar estado y pago de un pedido
revoke insert, update on public.orders from anon, authenticated;
grant update (status, paid) on public.orders to authenticated;
revoke all on public.order_rate from anon, authenticated;
revoke all on public.stats from anon;
revoke insert, update, delete on public.admins from anon, authenticated;

-- ---------- devolver stock al cancelar ----------
create or replace function public.orders_restock() returns trigger
language plpgsql security definer set search_path = public as $$
declare l jsonb;
begin
  if old.status <> 'Cancelado' and new.status = 'Cancelado' then
    for l in select * from jsonb_array_elements(old.items) loop
      update products set stock = least(stock + (l->>'q')::int, 99998)
       where id = l->>'id' and stock < 99999;
    end loop;
  elsif old.status = 'Cancelado' and new.status <> 'Cancelado' then
    raise exception 'pedido_cancelado';
  end if;
  return new;
end $$;
drop trigger if exists orders_restock on public.orders;
create trigger orders_restock before update of status on public.orders
  for each row execute function public.orders_restock();

-- ---------- crear pedido (única vía de inserción) ----------
create or replace function public.place_order(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ck jsonb; pm jsonb; v_ip text; v_admin boolean := public.is_admin();
  it jsonb; p record; grp jsonb; gi int; sel jsonb; picks int[]; pick int; opt jsonb;
  qty int; extra numeric; unit numeric; opts jsonb;
  lines jsonb := '[]'; totals jsonb := '{}'; pid text; tq int; cur_stock int;
  v_type text; v_pay text; v_sub numeric := 0; v_disc numeric := 0; v_tax numeric := 0; v_ship numeric := 0;
  pr record; v_promo text; cust jsonb; addr jsonb; ans jsonb := '[]'; f text; a text; i int; o record;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' or pg_column_size(payload) > 20000 then
    raise exception 'pedido_invalido';
  end if;

  -- límite de abuso: 5 pedidos cada 10 min por IP y 60 por minuto en total
  v_ip := coalesce(nullif(btrim(split_part(
            coalesce(current_setting('request.headers', true), '{}')::jsonb->>'x-forwarded-for', ',', 1)), ''), 'desconocida');
  if not v_admin then
    delete from order_rate where at < now() - interval '1 hour';
    if (select count(*) from order_rate r where r.ip = v_ip and r.at > now() - interval '10 minutes') >= 5
       or (select count(*) from order_rate r where r.at > now() - interval '1 minute') >= 60 then
      raise exception 'demasiados_pedidos';
    end if;
    insert into order_rate (ip) values (v_ip);
  end if;

  select checkout, payments into ck, pm from shop_config where id = 1;
  ck := coalesce(ck, '{}'); pm := coalesce(pm, '{}');
  if coalesce((ck->>'paused')::boolean, false) and not v_admin then raise exception 'tienda_pausada'; end if;

  if jsonb_typeof(payload->'items') is distinct from 'array'
     or jsonb_array_length(payload->'items') not between 1 and 50 then
    raise exception 'pedido_vacio';
  end if;

  -- bloquear filas en orden para evitar condiciones de carrera con el stock
  perform 1 from products
   where id in (select x->>'id' from jsonb_array_elements(payload->'items') x)
   order by id for update;

  for it in select * from jsonb_array_elements(payload->'items') loop
    select * into p from products where id = it->>'id';
    if not found or p.hidden or not p.cart then raise exception 'producto_no_disponible'; end if;

    if jsonb_typeof(it->'q') is distinct from 'number' then raise exception 'cantidad_invalida'; end if;
    if (it->>'q')::numeric < 1 or (it->>'q')::numeric > 999 or (it->>'q')::numeric <> trunc((it->>'q')::numeric) then
      raise exception 'cantidad_invalida';
    end if;
    qty := (it->>'q')::int;
    totals := jsonb_set(totals, array[p.id], to_jsonb(coalesce((totals->>p.id)::int, 0) + qty));

    sel := coalesce(it->'sel', '[]');
    if jsonb_typeof(sel) <> 'array' or jsonb_array_length(sel) > 40 then raise exception 'opciones_invalidas'; end if;
    -- toda selección debe ser [grupo, opción] con índices válidos
    if exists (select 1 from jsonb_array_elements(sel) s
                where jsonb_typeof(s) <> 'array' or jsonb_array_length(s) <> 2
                   or coalesce(s->>0, '') !~ '^\d{1,3}$' or coalesce(s->>1, '') !~ '^\d{1,3}$'
                   or (case when coalesce(s->>0, '') ~ '^\d{1,3}$' then (s->>0)::int else -1 end) >= jsonb_array_length(p.options)) then
      raise exception 'opciones_invalidas';
    end if;

    extra := 0; opts := '[]'; gi := 0;
    for grp in select * from jsonb_array_elements(p.options) loop
      select coalesce(array_agg(distinct (s->>1)::int), '{}') into picks
        from jsonb_array_elements(sel) s
       where (s->>0)::int = gi;
      if not coalesce((grp->>'multi')::boolean, false) and cardinality(picks) > 1 then
        raise exception 'opciones_invalidas';
      end if;
      foreach pick in array picks loop
        opt := grp->'items'->pick;
        if opt is null or not coalesce((opt->>'available')::boolean, true) then raise exception 'opcion_no_disponible'; end if;
        extra := extra + greatest(coalesce((opt->>'price')::numeric, 0), 0);
        opts := opts || to_jsonb(left(coalesce(opt->>'title', ''), 120));
      end loop;
      if coalesce((grp->>'required')::boolean, false) and cardinality(picks) = 0
         and exists (select 1 from jsonb_array_elements(grp->'items') x where coalesce((x->>'available')::boolean, true)) then
        raise exception 'falta_opcion_obligatoria';
      end if;
      gi := gi + 1;
    end loop;

    unit := round(coalesce(p.offer, p.price) + extra, 2);
    lines := lines || jsonb_build_object('id', p.id, 'title', p.title, 'q', qty, 'price', unit, 'opts', opts,
                                         'note', left(coalesce(it->>'note', ''), 300));
    v_sub := v_sub + unit * qty;
  end loop;

  -- stock: se valida el total por producto (varias líneas del mismo producto suman)
  for pid, tq in select key, value::int from jsonb_each_text(totals) loop
    select stock into cur_stock from products where id = pid;
    if cur_stock < 99999 then
      if cur_stock < tq then raise exception 'sin_stock'; end if;
      update products set stock = stock - tq where id = pid;
    end if;
  end loop;

  -- tipo de pedido y envío
  v_type := coalesce(payload->>'type', '');
  if v_type = 'Entrega a domicilio' and coalesce((ck->>'delivery')::boolean, false) then
    v_ship := round(greatest(coalesce((ck->>'deliveryPrice')::numeric, 0), 0), 2);
  elsif v_type = 'Recoger en sucursal' and coalesce((ck->>'pickup')::boolean, false) then null;
  elsif v_type = 'Pedido en mesa' and coalesce((ck->>'table')::boolean, false) then null;
  else raise exception 'tipo_invalido';
  end if;

  -- método de pago: solo los activos (no hay cobros en línea)
  v_pay := coalesce(payload->>'pay', '');
  if not ( (v_pay = 'Efectivo' and coalesce((pm->>'cash')::boolean, false))
        or (v_pay = 'Transferencia' and coalesce((pm->>'transfer')::boolean, false))
        or (coalesce((pm->>'custom')::boolean, false) and v_pay = coalesce(nullif(pm->>'customName', ''), 'Otro'))
        or (v_pay = '' and not coalesce((pm->>'cash')::boolean, false) and not coalesce((pm->>'transfer')::boolean, false)
                       and not coalesce((pm->>'custom')::boolean, false)) ) then
    raise exception 'pago_invalido';
  end if;

  -- descuento (el código nunca sale de la base de datos)
  if coalesce(payload->>'promo', '') <> '' then
    select * into pr from promos where lower(code) = lower(left(payload->>'promo', 40)) and active;
    if not found then raise exception 'codigo_invalido'; end if;
    v_disc := least(v_sub, case when pr.type = 'pct' then round(v_sub * pr.value / 100, 2) else pr.value end);
    v_promo := upper(pr.code);
  end if;

  if coalesce((ck->>'taxOn')::boolean, false) then
    v_tax := round((v_sub - v_disc) * least(greatest(coalesce((ck->>'taxPct')::numeric, 0), 0), 100) / 100, 2);
  end if;

  -- datos del cliente
  cust := jsonb_build_object(
    'name',  left(btrim(coalesce(payload#>>'{customer,name}', '')), 120),
    'phone', left(regexp_replace(coalesce(payload#>>'{customer,phone}', ''), '[^0-9+ ]', '', 'g'), 25),
    'email', left(btrim(coalesce(payload#>>'{customer,email}', '')), 160));
  if not v_admin then
    if coalesce((ck->>'askName')::boolean, true) and cust->>'name' = '' then raise exception 'falta_nombre'; end if;
    if coalesce((ck->>'askPhone')::boolean, true) and length(regexp_replace(cust->>'phone', '\D', '', 'g')) < 7 then
      raise exception 'falta_telefono';
    end if;
    if coalesce((ck->>'askEmail')::boolean, false) and (cust->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'falta_email';
    end if;
  end if;

  -- dirección (solo entrega a domicilio) o mesa
  addr := jsonb_build_object('text', left(btrim(coalesce(payload#>>'{address,text}', '')), 300));
  if v_type = 'Entrega a domicilio' then
    foreach f in array array['line1', 'line2', 'city', 'state', 'zip'] loop
      if coalesce((ck#>>array['addr', f, '0'])::boolean, false) then
        addr := addr || jsonb_build_object(f, left(btrim(coalesce(payload#>>array['address', f], '')), 150));
        if not v_admin and coalesce((ck#>>array['addr', f, '1'])::boolean, false) and addr->>f = '' then
          raise exception 'falta_direccion';
        end if;
      end if;
    end loop;
  end if;

  -- preguntas del checkout
  if coalesce((ck->>'questionsOn')::boolean, false) and jsonb_typeof(ck->'questions') = 'array' then
    for i in 0 .. jsonb_array_length(ck->'questions') - 1 loop
      a := left(btrim(coalesce(payload->'answers'->>i, '')), 300);
      if not v_admin and coalesce((ck->'questions'->i->>'required')::boolean, false) and a = '' then
        raise exception 'falta_respuesta';
      end if;
      ans := ans || jsonb_build_object('q', left(coalesce(ck->'questions'->i->>'text', ''), 200), 'a', a);
    end loop;
  end if;

  insert into orders (customer, type, address, pay, answers, items, subtotal, discount, tax, shipping, total, promo, client_ip)
  values (cust, v_type, addr, v_pay, ans, lines, round(v_sub, 2), v_disc, v_tax, v_ship,
          round(v_sub - v_disc + v_tax + v_ship, 2), v_promo, v_ip)
  returning * into o;

  return jsonb_build_object('num', o.num, 'items', o.items, 'subtotal', o.subtotal, 'discount', o.discount,
                            'tax', o.tax, 'shipping', o.shipping, 'total', o.total, 'type', o.type, 'pay', o.pay);
end $$;

-- contador de visitas (aproximado; cualquiera puede incrementarlo)
create or replace function public.register_visit() returns void
language sql security definer set search_path = public
as $$ update stats set visits = visits + 1 where id = 1 $$;

revoke execute on function public.place_order(jsonb) from public;
grant  execute on function public.place_order(jsonb) to anon, authenticated;
revoke execute on function public.register_visit() from public;
grant  execute on function public.register_visit() to anon, authenticated;
revoke execute on function public.orders_restock() from public, anon, authenticated;

-- ---------- imágenes ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "imagenes: admin sube" on storage.objects;
drop policy if exists "imagenes: admin cambia" on storage.objects;
drop policy if exists "imagenes: admin borra" on storage.objects;
create policy "imagenes: admin sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "imagenes: admin cambia" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin()) with check (bucket_id = 'product-images' and public.is_admin());
create policy "imagenes: admin borra" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- ---------- tiempo real ----------
do $$
declare t text;
begin
  foreach t in array array['products', 'categories', 'shop_config', 'orders'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
