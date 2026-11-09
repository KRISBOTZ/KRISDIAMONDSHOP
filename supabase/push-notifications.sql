create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.web_push_order_subscriptions (
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subscription_id, order_id)
);

create index if not exists web_push_order_subscriptions_order_idx
  on public.web_push_order_subscriptions (order_id);

create table if not exists public.admin_push_devices (
  id uuid primary key default gen_random_uuid(),
  fcm_token text not null unique,
  admin_username text not null,
  device_name text not null default 'Android admin',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.web_push_subscriptions enable row level security;
alter table public.web_push_order_subscriptions enable row level security;
alter table public.admin_push_devices enable row level security;

revoke all on public.web_push_subscriptions, public.web_push_order_subscriptions, public.admin_push_devices
  from anon, authenticated;
grant all on public.web_push_subscriptions, public.web_push_order_subscriptions, public.admin_push_devices
  to service_role;
