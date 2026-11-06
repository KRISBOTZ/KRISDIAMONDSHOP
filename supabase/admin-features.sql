create table if not exists public.categories (
  name text primary key,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.categories
  add column if not exists is_active boolean not null default true;

alter table public.games
  add column if not exists is_active boolean not null default true;

insert into public.categories (name)
select distinct category
from public.games
where category is not null and length(trim(category)) > 0
on conflict (name) do nothing;

create table if not exists public.site_content (
  source_text text primary key,
  replacement_text text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.vouchers (
  code text primary key,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value integer not null check (discount_value > 0),
  active boolean not null default true,
  is_public boolean not null default false,
  starts_at timestamptz,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now()
);

alter table public.vouchers
  add column if not exists is_public boolean not null default false;

create table if not exists public.payment_methods (
  id text primary key,
  name text not null unique,
  instructions text not null default '',
  image_url text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.vouchers (code, discount_type, discount_value, active)
values ('KRIS15', 'percent', 15, true)
on conflict (code) do nothing;

insert into public.payment_methods (id, name, instructions, active, sort_order)
values
  ('qris', 'QRIS', 'Scan QRIS yang ditampilkan setelah pesanan dibuat.', true, 0),
  ('dana', 'DANA', 'Selesaikan pembayaran menggunakan DANA.', true, 1),
  ('gopay', 'GoPay', 'Selesaikan pembayaran menggunakan GoPay.', true, 2),
  ('ovo', 'OVO', 'Selesaikan pembayaran menggunakan OVO.', true, 3),
  ('transfer-bank', 'Transfer Bank', 'Hubungi admin untuk mendapatkan detail rekening.', true, 4)
on conflict (id) do nothing;

alter table public.categories enable row level security;
alter table public.site_content enable row level security;
alter table public.site_settings enable row level security;
alter table public.vouchers enable row level security;
alter table public.payment_methods enable row level security;

revoke all on public.categories, public.site_content, public.site_settings, public.vouchers, public.payment_methods from anon, authenticated;
grant all on public.categories, public.site_content, public.site_settings, public.vouchers, public.payment_methods to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 15728640,
  allowed_mime_types = excluded.allowed_mime_types;
