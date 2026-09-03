-- ============================================================
--  Textile Manager — схема базы данных (Supabase / PostgreSQL)
--  Версия 2.6 · 03.09.2026
--
--  Файл можно выполнять повторно: он безопасно доводит до 2.6
--  как пустой проект, так и базу, развёрнутую по схеме 2.3.
--  Выполнить целиком в SQL Editor проекта Supabase.
--
--  Что добавлено против 2.3:
--    · цвет и признак «Без пошива» у швей          (раздел 34)
--    · шестое состояние позиции «Заменить»         (раздел 37)
--    · связи «заменена → замена» между позициями   (раздел 37)
--    · пометка позиций, добавленных после сборки   (раздел 38)
--    · признак «чек идёт без пошива» у чека        (раздел 34.4)
--    · лента комментариев к чеку и к позиции       (раздел 36)
--    · этап «Требуется замена» в списке этапов     (раздел 37.2)
-- ============================================================

-- ---------- 1. Справочники ----------

create table if not exists stores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid unique references auth.users(id) on delete set null,
  full_name   text not null unique,
  role        text not null default 'manager' check (role in ('manager','admin')),
  is_owner    boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
-- владелец в сети только один
create unique index if not exists users_single_owner on users (is_owner) where is_owner;

create table if not exists seamstresses (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null unique,
  phone       text,
  color       text,                                  -- HEX, раздел 34.2
  no_sewing   boolean not null default false,        -- служебная запись «Без пошива»
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
-- для баз, развёрнутых по 2.3
alter table seamstresses add column if not exists color     text;
alter table seamstresses add column if not exists no_sewing boolean not null default false;

-- «Без пошива» существует ровно в одном экземпляре и цвета не имеет
create unique index if not exists seamstresses_single_nosew on seamstresses (no_sewing) where no_sewing;
alter table seamstresses drop constraint if exists seamstresses_nosew_no_color;
alter table seamstresses add  constraint seamstresses_nosew_no_color
  check (not no_sewing or color is null);

-- ---------- 2. Номенклатура и остатки ----------

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  unit        text not null default 'м' check (unit in ('м','шт')),
  created_at  timestamptz not null default now()
);

-- остаток хранится кусками: pieces = {5,7,25}; итог = сумма
create table if not exists stocks (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  store_id    uuid not null references stores(id)   on delete cascade,
  pieces      numeric[] not null default '{}',
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  unique (product_id, store_id)
);

create table if not exists stock_moves (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  store_id      uuid not null references stores(id)   on delete cascade,
  delta         numeric not null,
  pieces_before numeric[],
  reason        text not null check (reason in ('sale','transfer_out','receipt','correction','undo','import')),
  order_id      uuid,
  performed_by  uuid references users(id),
  performed_at  timestamptz not null default now()
);

-- ---------- 3. Чеки ----------

create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id),
  receipt_number text not null unique,          -- сквозная нумерация, решение Р1
  client_name   text,
  comment       text,                           -- 2.3; с 2.6 переехало в order_comments
  seamstress_id uuid references seamstresses(id),
  skipped_sewing boolean not null default false, -- «Без пошива»: этапы 6–7 пропускаются
  current_stage text not null default 'awaiting_check',
  availability_confirmed    boolean not null default false,
  availability_confirmed_by uuid references users(id),
  availability_confirmed_at timestamptz,
  assembled_by      uuid references users(id), assembled_at      timestamptz,
  sent_to_sewing_by uuid references users(id), sent_to_sewing_at timestamptz,
  completed_by      uuid references users(id), completed_at      timestamptz,
  issued_by         uuid references users(id), issued_at         timestamptz,
  cancelled_by      uuid references users(id), cancelled_at      timestamptz,
  cancel_reason     text,
  created_by        uuid references users(id),
  created_at        timestamptz not null default now()
);
alter table orders add column if not exists skipped_sewing boolean not null default false;

-- список этапов закрыт: опечатка в коде не создаст несуществующий этап
alter table orders drop constraint if exists orders_stage_check;
alter table orders add  constraint orders_stage_check check (current_stage in (
  'awaiting_check','needs_replacement','needs_order','needs_transfer','awaiting_delivery',
  'ready_to_assemble','assembled','in_sewing','ready_to_issue','issued','cancelled'));

create table if not exists order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  product_marking text not null,
  quantity        numeric not null check (quantity > 0),
  from_qty        numeric,                       -- «получено 5 из 8» (раздел 17)
  unit            text not null default 'м' check (unit in ('м','шт')),
  status          text not null,
  prev_status     text,                          -- состояние до пометки «Заменить»
  replaced_by     uuid references order_items(id) on delete set null,
  replaces        uuid references order_items(id) on delete set null,
  added_late      boolean not null default false, -- добавлена после сборки (раздел 38)
  source_store_id uuid references stores(id),
  deducted_from   uuid references stores(id),    -- откуда списан остаток
  created_by uuid references users(id), created_at timestamptz not null default now(),
  updated_by uuid references users(id), updated_at timestamptz not null default now()
);
alter table order_items add column if not exists prev_status text;
alter table order_items add column if not exists replaced_by uuid references order_items(id) on delete set null;
alter table order_items add column if not exists replaces    uuid references order_items(id) on delete set null;
alter table order_items add column if not exists added_late  boolean not null default false;

-- шестое состояние «Заменить» (раздел 37)
alter table order_items drop constraint if exists order_items_status_check;
alter table order_items add  constraint order_items_status_check
  check (status in ('В наличии','Заказать','Заказано','Переместить','Получено','Заменить'));

alter table order_items drop constraint if exists order_items_prev_status_check;
alter table order_items add  constraint order_items_prev_status_check
  check (prev_status is null or prev_status in ('В наличии','Заказать','Заказано','Переместить','Получено'));

-- позиция не может заменять сама себя
alter table order_items drop constraint if exists order_items_no_self_replace;
alter table order_items add  constraint order_items_no_self_replace
  check (replaced_by is null or replaced_by <> id);

create table if not exists order_actions (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references orders(id) on delete cascade,
  order_item_id uuid,
  action_type   text not null,
  old_status    text,
  new_status    text,
  performed_by  uuid references users(id),
  performed_at  timestamptz not null default now(),
  comment       text
);

-- ---------- 3а. Лента комментариев (раздел 36) ----------
-- item_id пуст  → комментарий к чеку целиком
-- item_id задан → комментарий к конкретной позиции
create table if not exists order_comments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id)      on delete cascade,
  item_id       uuid references order_items(id)          on delete cascade,
  body          text not null check (length(btrim(body)) > 0),
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_items_order    on order_items(order_id);
create index if not exists idx_actions_order  on order_actions(order_id);
create index if not exists idx_orders_stage   on orders(current_stage);
create index if not exists idx_comments_order on order_comments(order_id);

-- ---------- 4. Кто я: помощники ----------

create or replace function me() returns users language sql stable security definer as $$
  select * from users where auth_id = auth.uid() and is_active limit 1;
$$;

create or replace function my_id() returns uuid language sql stable security definer as $$
  select id from users where auth_id = auth.uid() and is_active limit 1;
$$;

create or replace function is_admin() returns boolean language sql stable security definer as $$
  select coalesce((select role = 'admin' from users where auth_id = auth.uid() and is_active), false);
$$;

create or replace function is_owner() returns boolean language sql stable security definer as $$
  select coalesce((select is_owner from users where auth_id = auth.uid() and is_active), false);
$$;

-- ---------- 5. Защита истории и подписи действий ----------
-- Раздел 34.3: имя исполнителя берётся сервером, а не из данных браузера.

create or replace function stamp_actor() returns trigger language plpgsql security definer as $$
begin
  new.performed_by := my_id();
  new.performed_at := now();
  return new;
end $$;

drop trigger if exists trg_stamp_action on order_actions;
create trigger trg_stamp_action before insert on order_actions
  for each row execute function stamp_actor();

drop trigger if exists trg_stamp_move on stock_moves;
create trigger trg_stamp_move before insert on stock_moves
  for each row execute function stamp_actor();

-- автор комментария тоже проставляется сервером (раздел 36.2)
-- Если действующего сотрудника нет, значит запись идёт не из браузера,
-- а из SQL Editor при обновлении схемы: тогда авторство сохраняем как есть.
-- Обычная вставка из приложения без сотрудника не проходит по правилам RLS.
create or replace function stamp_author() returns trigger language plpgsql security definer as $$
begin
  if my_id() is not null then
    new.created_by := my_id();
    new.created_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_comment on order_comments;
create trigger trg_stamp_comment before insert on order_comments
  for each row execute function stamp_author();

-- история неизменяема: только добавление (раздел 19)
create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'История операций не может изменяться или удаляться';
end $$;

drop trigger if exists trg_actions_immutable on order_actions;
create trigger trg_actions_immutable before update or delete on order_actions
  for each row execute function forbid_change();

drop trigger if exists trg_moves_immutable on stock_moves;
create trigger trg_moves_immutable before update or delete on stock_moves
  for each row execute function forbid_change();

-- Комментарий нельзя переписать: правка запрещена, удаление разрешено только
-- автору. Это нужно кнопке ↶ — она откатывает собственное действие целиком.
-- Сам факт «добавил комментарий» остаётся в order_actions и не стирается.
create or replace function comment_guard() returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Комментарий нельзя изменить — добавьте новый';
  end if;
  if my_id() is not null and old.created_by is distinct from my_id() then
    raise exception 'Удалить комментарий может только его автор';
  end if;
  return old;
end $$;

drop trigger if exists trg_comment_guard on order_comments;
create trigger trg_comment_guard before update or delete on order_comments
  for each row execute function comment_guard();

-- владельца нельзя понизить или удалить (решение Р8)
create or replace function protect_owner() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_owner then raise exception 'Владельца сети нельзя удалить'; end if;
    return old;
  end if;
  if old.is_owner and (new.is_owner = false or new.role <> 'admin') then
    raise exception 'Владельца сети нельзя понизить';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_owner on users;
create trigger trg_protect_owner before update or delete on users
  for each row execute function protect_owner();

-- служебную запись «Без пошива» удалять нельзя (раздел 34.4)
create or replace function protect_nosew() returns trigger language plpgsql as $$
begin
  if old.no_sewing then raise exception 'Запись «Без пошива» удалить нельзя'; end if;
  return old;
end $$;

drop trigger if exists trg_protect_nosew on seamstresses;
create trigger trg_protect_nosew before delete on seamstresses
  for each row execute function protect_nosew();

-- ---------- 6. Правила доступа (RLS) ----------

alter table stores         enable row level security;
alter table users          enable row level security;
alter table seamstresses   enable row level security;
alter table products       enable row level security;
alter table stocks         enable row level security;
alter table stock_moves    enable row level security;
alter table orders         enable row level security;
alter table order_items    enable row level security;
alter table order_actions  enable row level security;
alter table order_comments enable row level security;

-- всё видно только вошедшим сотрудникам
drop policy if exists read_all on stores;         create policy read_all on stores         for select using (my_id() is not null);
drop policy if exists read_all on users;          create policy read_all on users          for select using (my_id() is not null);
drop policy if exists read_all on seamstresses;   create policy read_all on seamstresses   for select using (my_id() is not null);
drop policy if exists read_all on products;       create policy read_all on products       for select using (my_id() is not null);
drop policy if exists read_all on stocks;         create policy read_all on stocks         for select using (my_id() is not null);
drop policy if exists read_all on stock_moves;    create policy read_all on stock_moves    for select using (my_id() is not null);
drop policy if exists read_all on orders;         create policy read_all on orders         for select using (my_id() is not null);
drop policy if exists read_all on order_items;    create policy read_all on order_items    for select using (my_id() is not null);
drop policy if exists read_all on order_actions;  create policy read_all on order_actions  for select using (my_id() is not null);
drop policy if exists read_all on order_comments; create policy read_all on order_comments for select using (my_id() is not null);

-- работа с чеками: любой сотрудник (решение Р3 — не привязан к магазину)
drop policy if exists write_orders on orders;      create policy write_orders on orders      for all using (my_id() is not null) with check (my_id() is not null);
drop policy if exists write_items  on order_items; create policy write_items  on order_items for all using (my_id() is not null) with check (my_id() is not null);
drop policy if exists write_stock  on stocks;      create policy write_stock  on stocks      for all using (my_id() is not null) with check (my_id() is not null);
drop policy if exists write_prod   on products;    create policy write_prod   on products    for all using (my_id() is not null) with check (my_id() is not null);

-- историю можно только дописывать
drop policy if exists append_actions on order_actions; create policy append_actions on order_actions for insert with check (my_id() is not null);
drop policy if exists append_moves   on stock_moves;   create policy append_moves   on stock_moves   for insert with check (my_id() is not null);

-- комментарии: писать может любой сотрудник, удалять — только свои
drop policy if exists append_comments on order_comments;
create policy append_comments on order_comments for insert with check (my_id() is not null);
drop policy if exists delete_own_comments on order_comments;
create policy delete_own_comments on order_comments for delete using (created_by = my_id());

-- справочники сети — администратор и владелец
drop policy if exists admin_stores on stores;       create policy admin_stores on stores       for all using (is_admin()) with check (is_admin());
drop policy if exists admin_sew    on seamstresses; create policy admin_sew    on seamstresses for all using (is_admin()) with check (is_admin());
drop policy if exists admin_users  on users;        create policy admin_users  on users        for all using (is_admin()) with check (is_admin());

-- ---------- 7. Первичное наполнение ----------

insert into stores (name, is_active) values
  ('17/77', true), ('Солнечный', true), ('Основа', true)
on conflict (name) do nothing;

-- служебная запись «Без пошива»: постоянный идентификатор, чтобы
-- на неё можно было сослаться из приложения без поиска по имени
insert into seamstresses (id, full_name, no_sewing, color) values
  ('00000000-0000-4000-8000-000000000000', 'Без пошива', true, null)
on conflict (full_name) do nothing;

-- швеи с цветами из палитры раздела 34.2
insert into seamstresses (full_name, color) values
  ('Элла','#6A1B9A'), ('Ниагара','#00838F'), ('О.Н.','#5D4037'),
  ('Анастасия','#283593'), ('Светлана','#558B2F')
on conflict (full_name) do nothing;

-- у швей из базы 2.3 цвета не было — раздаём из палитры по порядку
with palette as (
  select hex, row_number() over () as n
    from unnest(array['#6A1B9A','#00838F','#5D4037','#283593','#558B2F','#455A64']) as hex
), plain as (
  select id, row_number() over (order by created_at) as n
    from seamstresses where not no_sewing and color is null
)
update seamstresses s set color = p.hex
  from plain pl join palette p on p.n = ((pl.n - 1) % 6) + 1
 where s.id = pl.id;

-- Сотрудники. auth_id проставляется после создания учётных записей
-- в разделе Authentication (см. README, шаг 4).
insert into users (full_name, role, is_owner) values
  ('Артур',    'admin',   true),
  ('Ольга М.', 'admin',   false),
  ('Ольга К.', 'manager', false),
  ('Зинаида',  'manager', false),
  ('Елена',    'manager', false),
  ('Юлия',     'manager', false)
on conflict (full_name) do nothing;

-- ---------- 8. Перенос комментариев из 2.3 в ленту ----------
-- Одиночное поле orders.comment становится первой записью ленты.
-- Колонка остаётся на месте, но приложение 2.6 её больше не читает.
insert into order_comments (order_id, item_id, body, created_by, created_at)
select o.id, null, btrim(o.comment), o.created_by, o.created_at
  from orders o
 where o.comment is not null and btrim(o.comment) <> ''
   and not exists (select 1 from order_comments c where c.order_id = o.id);
