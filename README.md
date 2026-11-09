# KRIS DIAMOND SHOP

## Vercel and Supabase setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor. Then run the current `supabase/admin-features.sql` for admin controls, customer voucher audiences, and one-time account redemptions. Run the updated SQL again after schema changes.
2. In Vercel, add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` for Production (and Preview if needed). The anon key is public and used by customer sign-up/login; the service role/secret key is server-only and must never be exposed in frontend code.
3. Deploy the project with Vercel. The game catalog is seeded automatically on its first API request.
4. Open `/admin` and enter the configured admin username and password. Customers can look up an order by its ID; the status page refreshes every 10 seconds while open.
5. In Supabase Authentication, enable email confirmations and configure the production website URL (and any Preview URLs you use) in the allowed redirect URLs. Customer registration and voucher redemption require a verified email. If confirmation email delivery is unavailable, configure a working SMTP provider in Supabase before enabling customer sign-up.

The payment proof bucket is private and accepts JPG, PNG, WEBP, and PDF files up to 5 MB. Public product, gallery, banner, and logo image uploads accept JPG, PNG, or WEBP up to 15 MB; PNG transparency is preserved. Supabase-backed database and storage are required because Vercel Functions do not provide persistent local disk or long-lived Socket.IO connections.

The admin dashboard can manage products and their variants and prices, activate/deactivate products, categories, and customer accounts, configure the checkout admin fee, upload/select product, payment, logo, multi-image rotating hero, and About-section banner images, manage WhatsApp/email/Instagram contact links and visitor messages, maintain payment methods and vouchers, change the admin password, edit storefront and dashboard text, control transaction/full-site maintenance, export orders as CSV, and delete orders only when their status is `Gagal`, `Refund`, or `Dibatalkan`. Inactive products/categories are hidden from the public catalog and rejected during order creation. Public vouchers appear automatically in the storefront for visitors eligible under the voucher's audience setting; guests can see vouchers targeted to everyone but must log in with a verified email to redeem. A customer can redeem each voucher only once, enforced by the database. New-account eligibility is based on the account registration time compared with the voucher start time (or creation time when no start time is set). Private vouchers remain usable only by eligible customers who know the code. Payment instructions accept wallet numbers and bank account details; payment images are optional (typically for QRIS). Admin sessions persist across storefront and dashboard navigation and expire after seven days. Product/payment images are stored in the public `product-images` bucket; payment proofs remain private.

For local development, copy `.env.example` to `.env` and set values from your Supabase project before running `npm start`.

## Panduan lengkap notifikasi push dan APK admin Android

Fitur ini memiliki dua jalur notifikasi yang dikonfigurasi terpisah:

- **Admin:** APK Android menampilkan dashboard admin dalam WebView. Firebase Cloud Messaging (FCM) mengirim peringatan saat ada pesanan baru.
- **Pembeli:** browser mengirim push saat admin mengubah status pesanan. Pembeli harus mengaktifkan notifikasi sebelum membuat pesanan, dari perangkat/browser yang sama.

### 1. Prasyarat dan rilis kode

Pastikan perubahan aplikasi yang berisi `server.js`, `public/sw.js`, folder `android/`, file SQL migrasi, dan workflow GitHub sudah masuk ke repository dan sudah ter-deploy ke Vercel. Aplikasi pembeli menggunakan HTTPS; jangan menguji push dari alamat HTTP selain `localhost`.

Siapkan akses ke project Supabase, Vercel, GitHub repository, Firebase Console, dan perangkat Android untuk pengujian. Jangan mengirim private key, service-account JSON, password, atau token ke chat, dan jangan menyimpannya di repository.

### 2. Siapkan database Supabase

Di Supabase Dashboard, buka **SQL Editor → New query**, lalu jalankan file-file ini berurutan:

1. `supabase/schema.sql` (tabel utama, jika belum pernah dijalankan).
2. `supabase/admin-features.sql` (fitur admin, akun pelanggan, dan voucher, jika belum pernah dijalankan).
3. `supabase/push-notifications.sql` (tabel untuk subscription browser dan token perangkat admin).

Jalankan sebagai pemilik project melalui SQL Editor Supabase. Bila query menampilkan error, hentikan setup dan selesaikan error migrasi terlebih dahulu; jangan menghapus tabel yang sudah berisi data.

### 3. Buat kunci VAPID untuk push pembeli

Di folder proyek, jalankan `npm install` untuk memasang dependency yang tercantum di `package.json`. Setelah selesai, jalankan:

```powershell
node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"
```

Perintah menampilkan pasangan `publicKey` dan `privateKey`. Simpan keduanya di password manager sementara konfigurasi. **Jangan bagikan atau commit private key.** Jika terminal lokal tidak dapat memasang dependency, jalankan perintah ini pada komputer lain yang memiliki Node.js/npm dan akses internet.

### 4. Atur environment variables Vercel

Di Vercel Dashboard, buka **Project → Settings → Environment Variables**. Tambahkan variabel berikut ke environment **Production** (tambahkan ke Preview hanya bila ingin menguji preview deployment):

| Nama | Nilai |
|---|---|
| `SUPABASE_URL` | Project URL dari Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | Publishable/anon key Supabase; boleh digunakan frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret/service-role key Supabase; **rahasia, server-only** |
| `ADMIN_USERNAME` | Username admin yang diinginkan |
| `ADMIN_PASSWORD` | Password admin yang kuat |
| `VAPID_PUBLIC_KEY` | Nilai `publicKey` hasil langkah 3 |
| `VAPID_PRIVATE_KEY` | Nilai `privateKey` hasil langkah 3; **rahasia** |
| `VAPID_SUBJECT` | Alamat kontak, misalnya `mailto:email-anda@example.com` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Seluruh isi JSON service account Firebase dalam satu baris; **rahasia** |

Setelah menyimpan atau mengubah environment variables, buka **Deployments** dan redeploy deployment Production terbaru agar variabel baru diterapkan. Jangan menaruh service-role key, VAPID private key, atau Firebase service-account JSON pada `public/`, source frontend, atau GitHub Actions variable biasa.

### 5. Siapkan Firebase Cloud Messaging untuk APK

1. Buka [Firebase Console](https://console.firebase.google.com/) dan buat/pilih Firebase project.
2. Tambahkan aplikasi **Android**. Package name harus persis `com.krisdiamondshop.admin`.
3. Unduh `google-services.json`, lalu letakkan secara lokal di `android/app/google-services.json`. File ini dikecualikan Git oleh `.gitignore`; jangan mengubah pengecualian itu.
4. Di Firebase Console, buka **Project settings → Service accounts** dan buat/gunakan private key service account. Masukkan seluruh JSON tersebut ke environment variable Vercel `FIREBASE_SERVICE_ACCOUNT_JSON` pada langkah sebelumnya. Simpan file dengan aman dan jangan commit atau mengirimkannya.
5. Pastikan **Firebase Cloud Messaging** aktif untuk project. Jangan menukar file `google-services.json` dengan service-account JSON: keduanya berbeda. `google-services.json` dipakai saat build APK; service-account JSON dipakai server untuk mengirim FCM.

### 6. Build dan unduh APK

**Build melalui GitHub Actions (disarankan):**

1. Encode file `google-services.json` di PowerShell dari folder root repository:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("android\app\google-services.json"))
   ```

2. Salin hasilnya ke GitHub **Settings → Secrets and variables → Actions → New repository secret** dengan nama `FIREBASE_GOOGLE_SERVICES_JSON_BASE64`. Base64 bukan enkripsi; perlakukan hasilnya sebagai data konfigurasi privat dan simpan hanya sebagai GitHub **secret**.
3. Pastikan workflow `.github/workflows/build-android-admin.yml` sudah ada di branch GitHub yang ingin dibangun.
4. Di repository GitHub, buka **Actions → Build Android admin app → Run workflow** dan pilih branch tersebut.
5. Setelah workflow sukses, buka run yang selesai dan unduh artifact `kris-diamond-admin-android`. Ekstrak ZIP; file APK-nya bernama `app-debug.apk`.
6. Pindahkan APK ke ponsel Android dan izinkan pemasangan aplikasi dari sumber tersebut bila diminta. Instal dan buka aplikasi **KRIS DIAMOND Admin**.

**Build melalui Android Studio:** salin juga `google-services.json` ke `android/app/`, buka folder `android` di Android Studio, biarkan Gradle Sync selesai, lalu jalankan task `app → Tasks → build → assembleDebug`. APK debug berada di `android/app/build/outputs/apk/debug/app-debug.apk`. Bila Android Studio meminta SDK, pasang Android SDK Platform 35 dan Build Tools 35.0.0.

Jangan membangun APK tanpa `google-services.json` bila ingin menguji notifikasi admin: APK tanpa konfigurasi tersebut masih dapat membuka dashboard, tetapi tidak dapat mendaftarkan token FCM.

### 7. Aktifkan dan uji notifikasi admin

1. Pastikan deployment Vercel sudah memiliki environment Firebase dan migrasi Supabase pada langkah 2 sudah dijalankan.
2. Buka APK dengan koneksi internet, izinkan notifikasi Android, lalu login menggunakan akun admin website. Token perangkat didaftarkan setelah login.
3. Di dashboard admin, pastikan pesan perangkat/notifikasi menunjukkan berhasil tersambung. Bila tidak, lihat bagian pemecahan masalah di bawah.
4. Dari storefront, buat satu pesanan uji. Periksa apakah APK menerima notifikasi order baru.
5. Ulangi uji saat APK berada di background atau sudah ditutup. Ketuk notifikasi untuk membuka dashboard admin.

### 8. Aktifkan dan uji notifikasi pembeli

1. Buka website di browser pada perangkat pembeli yang akan dipakai untuk menerima notifikasi.
2. Di checkout, tekan **Aktifkan notifikasi status pesanan**, lalu pilih **Izinkan** pada dialog browser.
3. **Setelah mengaktifkan notifikasi**, buat pesanan di browser/perangkat yang sama. Subscription notifikasi akan dihubungkan ke pesanan tersebut saat order dibuat.
4. Dari APK/dashboard admin, ubah status pesanan uji.
5. Pastikan browser/perangkat menerima pemberitahuan. Uji lagi setelah browser ditutup; notifikasi memerlukan izin perangkat dan koneksi internet.

Di iPhone, browser push memerlukan iOS 16.4 atau lebih baru: tambahkan website ke Home Screen, buka website dari ikon tersebut, lalu aktifkan notifikasi. Ketersediaan izin pemasangan bergantung pada versi iOS/browser. Pembeli tidak perlu membuat akun untuk menerima notifikasi; fitur ini hanya terkait dengan pesanan yang dibuat setelah subscription aktif.

### 9. Pemecahan masalah

- **Pembeli melihat pesan VAPID belum dikonfigurasi:** periksa `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, dan `VAPID_SUBJECT` di Vercel, lalu redeploy.
- **Pembeli mengizinkan notifikasi tetapi tidak mendapat update:** pastikan izin OS/browser masih aktif, subscription diaktifkan sebelum order dibuat, dan order tersebut memang dibuat di browser/perangkat itu. Periksa status notifikasi push dan log Function Vercel.
- **APK terbuka tetapi tidak menerima order:** pastikan APK dibuat dengan `google-services.json` untuk package ID yang tepat, izin notifikasi Android diaktifkan, admin login, `FIREBASE_SERVICE_ACCOUNT_JSON` terpasang di Vercel, migrasi push sudah dijalankan, lalu redeploy.
- **Perubahan Vercel tidak berefek:** pastikan environment yang diubah adalah Production dan lakukan redeploy setelah perubahan.
- **Build GitHub Actions gagal:** pastikan secret `FIREBASE_GOOGLE_SERVICES_JSON_BASE64` ada dan berisi Base64 dari file JSON yang valid; periksa log workflow untuk error Gradle/SDK.
- **Build APK tanpa secret Firebase:** workflow dapat menghasilkan APK tanpa FCM; APK tersebut hanya dapat membuka dashboard dan bukan bukti bahwa push sudah siap.

Notifikasi push adalah tambahan untuk notifikasi di dalam website. Push tidak dijamin diterima jika pengguna menolak izin, mematikan notifikasi aplikasi/browser, perangkat offline, atau layanan push Firebase/browser sedang tidak tersedia.
