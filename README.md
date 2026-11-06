# KRIS DIAMOND SHOP

## Vercel and Supabase setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor. Run the current `supabase/admin-features.sql` for the admin product, gallery, category, website-copy, voucher, payment-method, and activation controls. Run the updated SQL again after changes that add columns such as category/product activation.
2. In Vercel, add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` for Production (and Preview if needed). Use the Supabase project URL and a server-only service role/secret key; never expose that key in frontend code.
3. Deploy the project with Vercel. The game catalog is seeded automatically on its first API request.
4. Open `/admin` and enter the configured admin username and password. Customers can look up an order by its ID; the status page refreshes every 10 seconds while open.

The payment proof bucket is private and accepts JPG, PNG, WEBP, and PDF files up to 5 MB. Public product, gallery, banner, and logo image uploads accept JPG, PNG, or WEBP up to 15 MB; PNG transparency is preserved. Supabase-backed database and storage are required because Vercel Functions do not provide persistent local disk or long-lived Socket.IO connections.

The admin dashboard can manage products and their variants and prices, activate/deactivate products and categories, configure the checkout admin fee, upload/select product, payment, logo, and banner images, manage WhatsApp/email/Instagram contact links and visitor messages, maintain payment methods and vouchers, change the admin password, edit storefront and dashboard text, control transaction/full-site maintenance, export orders as CSV, and delete orders only when their status is `Gagal`, `Refund`, or `Dibatalkan`. Inactive products/categories are hidden from the public catalog and rejected during order creation. Public vouchers appear automatically in the storefront, including scheduled or unavailable vouchers with their status; private vouchers remain usable only by customers who know the code. The storefront keeps its voucher call-to-action visible even when no public vouchers are configured. Payment instructions accept wallet numbers and bank account details; payment images are optional (typically for QRIS). Admin sessions persist across storefront and dashboard navigation and expire after seven days. Product/payment images are stored in the public `product-images` bucket; payment proofs remain private.

For local development, copy `.env.example` to `.env` and set values from your Supabase project before running `npm start`.
