create table if not exists public.games (
  id text primary key,
  name text not null,
  category text not null,
  description text,
  logo text,
  banner text,
  status text not null default 'Tersedia',
  featured boolean not null default false,
  bestseller boolean not null default false,
  variants jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.orders (
  id text primary key,
  game_id text not null references public.games(id),
  game_name text not null,
  category text not null,
  variant_key text not null,
  variant_name text not null,
  price integer not null check (price >= 0),
  admin_fee integer not null default 0 check (admin_fee >= 0),
  discount_amount integer not null default 0 check (discount_amount >= 0),
  total_amount integer not null check (total_amount >= 0),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  user_id_input text not null,
  server_id text not null default '',
  payment_method text not null,
  voucher_code text not null default '',
  payment_proof text,
  note text not null default '',
  status text not null default 'Menunggu Pembayaran',
  user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id text primary key,
  user_id uuid not null,
  order_id text not null references public.orders(id) on delete cascade,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id text primary key,
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists order_status_history_order_id_idx on public.order_status_history (order_id, created_at);
create index if not exists notifications_user_id_created_at_idx on public.notifications (user_id, created_at desc);

alter table public.games enable row level security;
alter table public.orders enable row level security;
alter table public.order_status_history enable row level security;
alter table public.notifications enable row level security;
alter table public.contact_messages enable row level security;

revoke all on public.games, public.orders, public.order_status_history, public.notifications, public.contact_messages from anon, authenticated;
grant all on public.games, public.orders, public.order_status_history, public.notifications, public.contact_messages to service_role;
grant usage, select on sequence public.order_status_history_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;
