# KRIS DIAMOND SHOP

## Vercel and Supabase setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor. For the admin product, gallery, category, website-copy, and voucher tools, also run `supabase/admin-features.sql`.
2. In Vercel, add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` for Production (and Preview if needed). Use the Supabase project URL and a server-only service role/secret key; never expose that key in frontend code.
3. Deploy the project with Vercel. The game catalog is seeded automatically on its first API request.
4. Open `/admin` and enter the configured admin username and password. Customers can look up an order by its ID; the status page refreshes every 10 seconds while open.

The payment proof bucket is private and accepts JPG, PNG, WEBP, and PDF files up to 5 MB. Supabase-backed database and storage are required because Vercel Functions do not provide persistent local disk or long-lived Socket.IO connections.

The admin dashboard can manage products and their variants, upload/select product images, change product and homepage banner images, maintain categories and vouchers, edit storefront and dashboard text, export orders as CSV, and delete orders only when their status is `Gagal`, `Refund`, or `Dibatalkan`. Product images are stored in the public `product-images` bucket; payment proofs remain private.

For local development, copy `.env.example` to `.env` and set values from your Supabase project before running `npm start`.
