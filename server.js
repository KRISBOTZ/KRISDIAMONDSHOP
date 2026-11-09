const express = require('express');
const multer = require('multer');
const path = require('path');
const { randomUUID, randomBytes, createHmac, scryptSync, timingSafeEqual } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const firebaseAdmin = require('firebase-admin');
const webPush = require('web-push');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)) {
      callback(new Error('Format bukti pembayaran harus JPG, PNG, WEBP, atau PDF.'));
      return;
    }
    callback(null, true);
  }
});
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
let supabaseConfigError = '';
if (!supabaseUrl) {
  supabaseConfigError = 'SUPABASE_URL belum diatur.';
} else {
  try {
    const parsedUrl = new URL(supabaseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      supabaseConfigError = 'SUPABASE_URL harus menggunakan HTTP atau HTTPS.';
    }
  } catch {
    supabaseConfigError = 'SUPABASE_URL harus berupa URL project Supabase yang valid.';
  }
}
if (!supabaseConfigError && !supabaseKey) {
  supabaseConfigError = 'SUPABASE_SERVICE_ROLE_KEY belum diatur.';
}
const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const vapidPublicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
const vapidPrivateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
let webPushReady = false;
if (vapidPublicKey && vapidPrivateKey) {
  try {
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@krisdiamondshop.vercel.app',
      vapidPublicKey,
      vapidPrivateKey
    );
    webPushReady = true;
  } catch (error) {
    console.error('Web push VAPID configuration error:', error.message);
  }
}

let firebaseMessaging = null;
try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    const firebaseApp = firebaseAdmin.apps[0] || firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount)
    });
    firebaseMessaging = firebaseAdmin.messaging(firebaseApp);
  }
} catch (error) {
  console.error('Firebase Admin configuration error:', error.message);
}

const STATUS_FLOW = [
  'Menunggu Pembayaran',
  'Menunggu Verifikasi',
  'Pembayaran Berhasil',
  'Sedang Diproses',
  'Berhasil',
  'Gagal',
  'Dibatalkan',
  'Refund'
];

const gamesSeed = [
  {
    id: 'mobile-legends',
    name: 'Mobile Legends',
    category: 'MOBA',
    description: 'Top up diamond Mobile Legends dengan proses cepat dan bonus menarik.',
    logo: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=500&q=80',
    banner: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80',
    status: 'Tersedia',
    featured: true,
    bestseller: true,
    variants: [
      { key: 'diamond-5', label: '5 Diamond', price: 2000 },
      { key: 'diamond-86', label: '86 Diamond', price: 33000 },
      { key: 'diamond-172', label: '172 Diamond', price: 65000 },
      { key: 'diamond-257', label: '257 Diamond', price: 96000 },
      { key: 'diamond-514', label: '514 Diamond', price: 186000 },
      { key: 'diamond-1032', label: '1032 Diamond', price: 350000 }
    ]
  },
  {
    id: 'free-fire',
    name: 'Free Fire',
    category: 'Battle Royale',
    description: 'Beli diamond FF dengan harga ekonomis dan pengiriman instan.',
    logo: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=500&q=80',
    banner: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80',
    status: 'Tersedia',
    featured: true,
    bestseller: true,
    variants: [
      { key: 'ff-5', label: '5 Diamond', price: 2500 },
      { key: 'ff-70', label: '70 Diamond', price: 20000 },
      { key: 'ff-140', label: '140 Diamond', price: 38000 },
      { key: 'ff-355', label: '355 Diamond', price: 94000 },
      { key: 'ff-720', label: '720 Diamond', price: 188000 },
      { key: 'ff-1400', label: '1400 Diamond', price: 340000 }
    ]
  },
  {
    id: 'pubg-mobile',
    name: 'PUBG Mobile',
    category: 'Battle Royale',
    description: 'Cek saldo UC dan event ulang tahun dengan proses cepat.',
    logo: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=500&q=80',
    banner: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=1200&q=80',
    status: 'Tersedia',
    featured: false,
    bestseller: true,
    variants: [
      { key: 'uc-60', label: '60 UC', price: 18000 },
      { key: 'uc-325', label: '325 UC', price: 94000 },
      { key: 'uc-660', label: '660 UC', price: 186000 },
      { key: 'uc-1800', label: '1800 UC', price: 470000 },
      { key: 'uc-3850', label: '3850 UC', price: 980000 }
    ]
  },
  {
    id: 'genshin-impact',
    name: 'Genshin Impact',
    category: 'RPG',
    description: 'Beli Genesis Crystal dan primogems untuk perjalanan petualanganmu.',
    logo: 'https://images.unsplash.com/photo-1511884642898-4c92249e20b6?auto=format&fit=crop&w=500&q=80',
    banner: 'https://images.unsplash.com/photo-1511884642898-4c92249e20b6?auto=format&fit=crop&w=1200&q=80',
    status: 'Tersedia',
    featured: true,
    bestseller: false,
    variants: [
      { key: 'gen-60', label: '60 Genesis Crystal', price: 20000 },
      { key: 'gen-300', label: '300 Genesis Crystal', price: 96000 },
      { key: 'gen-980', label: '980 Genesis Crystal', price: 310000 },
      { key: 'gen-1980', label: '1980 Genesis Crystal', price: 610000 },
      { key: 'gen-3280', label: '3280 Genesis Crystal', price: 980000 }
    ]
  },
  {
    id: 'honor-of-kings',
    name: 'Honor of Kings',
    category: 'MOBA',
    description: 'Top up skin dan diamond Honor of Kings dengan proses cepat.',
    logo: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=500&q=80',
    banner: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80',
    status: 'Tersedia',
    featured: false,
    bestseller: true,
    variants: [
      { key: 'hok-14', label: '14 Diamond', price: 4000 },
      { key: 'hok-90', label: '90 Diamond', price: 26000 },
      { key: 'hok-222', label: '222 Diamond', price: 64000 },
      { key: 'hok-555', label: '555 Diamond', price: 160000 },
      { key: 'hok-916', label: '916 Diamond', price: 270000 }
    ]
  },
  {
    id: 'valorant',
    name: 'Valorant',
    category: 'FPS',
    description: 'Beli points Valorant dan nikmati item premium dengan aman dan cepat.',
    logo: 'https://images.unsplash.com/photo-1528819622761-6bcf9a54e6a4?auto=format&fit=crop&w=500&q=80',
    banner: 'https://images.unsplash.com/photo-1528819622761-6bcf9a54e6a4?auto=format&fit=crop&w=1200&q=80',
    status: 'Tersedia',
    featured: false,
    bestseller: false,
    variants: [
      { key: 'val-420', label: '420 VP', price: 72000 },
      { key: 'val-1375', label: '1375 VP', price: 220000 },
      { key: 'val-2475', label: '2475 VP', price: 390000 },
      { key: 'val-4000', label: '4000 VP', price: 620000 },
      { key: 'val-6500', label: '6500 VP', price: 980000 }
    ]
  },
  {
    id: 'call-of-duty-mobile',
    name: 'Call of Duty Mobile',
    category: 'FPS',
    description: 'Top up CP CODM dengan proses aman dan pengiriman otomatis.',
    logo: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=500&q=80',
    banner: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80',
    status: 'Tersedia',
    featured: true,
    bestseller: false,
    variants: [
      { key: 'codm-11', label: '11 CP', price: 3500 },
      { key: 'codm-70', label: '70 CP', price: 20000 },
      { key: 'codm-310', label: '310 CP', price: 90000 },
      { key: 'codm-620', label: '620 CP', price: 180000 },
      { key: 'codm-1950', label: '1950 CP', price: 520000 }
    ]
  }
];

function dbOrError(res) {
  if (!supabase) {
    res.status(503).json({ message: `Backend belum dikonfigurasi: ${supabaseConfigError}` });
    return false;
  }
  return true;
}

const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

async function getAdminAuthState() {
  const { data, error } = await supabase.from('site_settings')
    .select('key,value')
    .in('key', ['admin_password_salt', 'admin_password_hash', 'admin_auth_version']);
  if (error) throw error;
  const settings = Object.fromEntries((data || []).map((item) => [item.key, item.value]));
  return {
    username: process.env.ADMIN_USERNAME || '',
    salt: settings.admin_password_salt || '',
    hash: settings.admin_password_hash || '',
    version: settings.admin_auth_version || 'initial'
  };
}

function signAdminSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', supabaseKey).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyAdminSession(token) {
  const [encoded, suppliedSignature, extra] = String(token || '').split('.');
  if (!encoded || !suppliedSignature || extra) return null;
  const expectedSignature = createHmac('sha256', supabaseKey).update(encoded).digest();
  let actualSignature;
  try {
    actualSignature = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.username || !payload.version || !Number.isInteger(payload.expiresAt) || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function adminOnlyAsync(req, res, next) {
  if (!dbOrError(res)) return;
  const state = await getAdminAuthState();
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const session = verifyAdminSession(token);
  if (!state.username || !session || session.username !== state.username || session.version !== state.version) {
    res.status(401).json({ message: 'Sesi admin tidak valid atau sudah berakhir. Silakan login kembali.' });
    return;
  }
  req.adminSession = session;
  next();
}

const adminOnly = asyncRoute(adminOnlyAsync);

function constantTimeEqual(expected, provided) {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function verifyAdminPassword(password, authState) {
  if (authState.hash && authState.salt) {
    const actualHash = scryptSync(password, authState.salt, 64);
    const expectedHash = Buffer.from(authState.hash, 'hex');
    return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
  }
  return Boolean(process.env.ADMIN_PASSWORD) && constantTimeEqual(process.env.ADMIN_PASSWORD, password);
}

function createAdminSession(username, version) {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
  return { token: signAdminSession({ username, version, expiresAt }), expiresAt };
}

async function saveAdminAuthSettings(settings) {
  const rows = Object.entries(settings).map(([key, value]) => ({
    key,
    value,
    updated_at: new Date().toISOString()
  }));
  const { error } = await supabase.from('site_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
}

app.post('/api/admin/login', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  const authState = await getAdminAuthState();
  if (!authState.username || !password || !constantTimeEqual(authState.username, username) || !verifyAdminPassword(password, authState)) {
    return res.status(401).json({ message: 'Username atau password admin tidak valid.' });
  }
  res.json({ ...createAdminSession(authState.username, authState.version), username: authState.username });
}));

app.post('/api/admin/change-password', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 12 || newPassword.length > 200) {
    return res.status(400).json({ message: 'Password baru harus terdiri dari 12 sampai 200 karakter.' });
  }
  const authState = await getAdminAuthState();
  if (!verifyAdminPassword(currentPassword, authState)) {
    return res.status(400).json({ message: 'Password saat ini tidak sesuai.' });
  }
  const salt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(newPassword, salt, 64).toString('hex');
  const version = randomUUID();
  await saveAdminAuthSettings({
    admin_password_salt: salt,
    admin_password_hash: passwordHash,
    admin_auth_version: version
  });
  res.json({
    ...createAdminSession(authState.username, version),
    username: authState.username,
    message: 'Password admin berhasil diubah.'
  });
}));

function normalizeGame(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    logo: row.logo,
    banner: row.banner,
    status: row.status,
    isActive: row.is_active !== false,
    featured: Boolean(row.featured),
    bestseller: Boolean(row.bestseller),
    variants: row.variants || [],
    metadata: row.metadata || {}
  };
}

function getOrderPayload(row, history = []) {
  return {
    id: row.id,
    gameId: row.game_id,
    gameName: row.game_name,
    category: row.category,
    variantKey: row.variant_key,
    variantName: row.variant_name,
    price: row.price,
    adminFee: row.admin_fee,
    discountAmount: row.discount_amount,
    totalAmount: row.total_amount,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    userIdInput: row.user_id_input,
    serverId: row.server_id,
    paymentMethod: row.payment_method,
    voucherCode: row.voucher_code,
    paymentProof: row.payment_proof,
    note: row.note,
    status: row.status,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orderHistory: history.map((entry) => ({
      id: entry.id,
      status: entry.status,
      note: entry.note,
      createdAt: entry.created_at
    }))
  };
}

async function ensureGames() {
  const { data, error } = await supabase.from('games').select('id').limit(1);
  if (error) throw error;
  if (!data.length) {
    const seed = gamesSeed.map((game) => ({
      ...game,
      metadata: { popular: game.featured, gameSlug: game.id, shortName: game.name }
    }));
    const { error: seedError } = await supabase.from('games').upsert(seed);
    if (seedError) throw seedError;
  }
}

async function getOrderById(orderId) {
  const { data: order, error } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const { data: history, error: historyError } = await supabase
    .from('order_status_history')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (historyError) throw historyError;
  const { data: paymentMethod, error: paymentError } = await supabase.from('payment_methods')
    .select('name,instructions,image_url')
    .eq('name', order.payment_method)
    .maybeSingle();
  if (paymentError) throw paymentError;
  return {
    ...getOrderPayload(order, history || []),
    paymentInstructions: paymentMethod?.instructions || '',
    paymentImageUrl: paymentMethod?.image_url || ''
  };
}

async function createNotification(userId, orderId, title, message) {
  const { error } = await supabase.from('notifications').insert({
    id: `ntf-${randomUUID()}`,
    user_id: userId,
    order_id: orderId,
    title,
    message
  });
  if (error) throw error;
}

async function sendCustomerPush(orderId, title, message) {
  if (!webPushReady) return;
  const { data: links, error: linksError } = await supabase.from('web_push_order_subscriptions')
    .select('subscription_id').eq('order_id', orderId);
  if (linksError) {
    console.error('Customer push subscription lookup error:', linksError);
    return;
  }
  const ids = [...new Set((links || []).map((link) => link.subscription_id))];
  if (!ids.length) return;
  const { data: subscriptions, error: subscriptionsError } = await supabase.from('web_push_subscriptions')
    .select('id,endpoint,p256dh,auth').in('id', ids);
  if (subscriptionsError) {
    console.error('Customer push device lookup error:', subscriptionsError);
    return;
  }
  const payload = JSON.stringify({
    title,
    body: message,
    url: `/?order_id=${encodeURIComponent(orderId)}#pesanan`
  });
  await Promise.all((subscriptions || []).map(async (subscription) => {
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      }, payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        const { error: deleteError } = await supabase.from('web_push_subscriptions').delete().eq('id', subscription.id);
        if (deleteError) console.error('Expired customer push cleanup error:', deleteError);
      } else {
        console.error('Customer push delivery error:', error.message);
      }
    }
  }));
}

async function saveCustomerPushSubscription(order, subscription) {
  const endpoint = String(subscription?.endpoint || '');
  const p256dh = String(subscription?.keys?.p256dh || '');
  const auth = String(subscription?.keys?.auth || '');
  if (!endpoint || endpoint.length > 4096
    || !/^[A-Za-z0-9_-]{32,200}$/.test(p256dh)
    || !/^[A-Za-z0-9_-]{16,100}$/.test(auth)) {
    throw new Error('Data langganan notifikasi tidak valid.');
  }
  const endpointUrl = new URL(endpoint);
  const host = endpointUrl.hostname.toLowerCase();
  const supportedHost = host === 'fcm.googleapis.com'
    || host === 'web.push.apple.com'
    || host === 'updates.push.services.mozilla.com'
    || host.endsWith('.push.services.mozilla.com')
    || host.endsWith('.notify.windows.com');
  if (endpointUrl.protocol !== 'https:' || (endpointUrl.port && endpointUrl.port !== '443')
    || endpointUrl.username || endpointUrl.password || !supportedHost) {
    throw new Error('Endpoint notifikasi browser tidak didukung.');
  }
  const { data: saved, error: saveError } = await supabase.from('web_push_subscriptions')
    .upsert({ endpoint, p256dh, auth, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' })
    .select('id').single();
  if (saveError) throw saveError;
  const { error: linkError } = await supabase.from('web_push_order_subscriptions')
    .upsert({ subscription_id: saved.id, order_id: order.id }, { onConflict: 'subscription_id,order_id', ignoreDuplicates: true });
  if (linkError) throw linkError;
}

async function sendAdminOrderPush(order) {
  if (!firebaseMessaging) return;
  const { data: devices, error } = await supabase.from('admin_push_devices').select('id,fcm_token');
  if (error) {
    console.error('Admin push device lookup error:', error);
    return;
  }
  const tokens = [...new Set((devices || []).map((device) => device.fcm_token))];
  for (let offset = 0; offset < tokens.length; offset += 500) {
    const batch = tokens.slice(offset, offset + 500);
    try {
      const result = await firebaseMessaging.sendEachForMulticast({
        tokens: batch,
        data: {
          title: 'Order diamond baru',
          body: `${order.id} · ${order.game_name}`,
          orderId: order.id,
          url: '/admin'
        },
        android: { priority: 'high' }
      });
      const invalidTokens = result.responses.flatMap((response, index) => {
        const code = response.error?.code || '';
        return ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(code)
          ? [batch[index]]
          : [];
      });
      if (invalidTokens.length) {
        const { error: deleteError } = await supabase.from('admin_push_devices').delete().in('fcm_token', invalidTokens);
        if (deleteError) console.error('Invalid admin push device cleanup error:', deleteError);
      }
      result.responses.forEach((response) => {
        if (response.error && !['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(response.error.code)) {
          console.error('Admin push delivery error:', response.error.message);
        }
      });
    } catch (pushError) {
      console.error('Admin push multicast error:', pushError);
    }
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function redeemVoucher(voucher) {
  let uses = Number(voucher.uses || 0);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase.from('vouchers')
      .update({ uses: uses + 1 })
      .eq('code', voucher.code)
      .eq('uses', uses)
      .select('uses')
      .maybeSingle();
    if (error) throw error;
    if (data) return true;

    const { data: current, error: currentError } = await supabase.from('vouchers')
      .select('uses,max_uses,active,expires_at,starts_at')
      .eq('code', voucher.code)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current || !current.active
      || (current.max_uses !== null && current.uses >= current.max_uses)
      || (current.expires_at && Date.parse(current.expires_at) <= Date.now())
      || (current.starts_at && Date.parse(current.starts_at) > Date.now())) return false;
    uses = Number(current.uses || 0);
  }
  return false;
}

function getVoucherUnavailableMessage(voucher, now = Date.now()) {
  if (!voucher) return 'Kode voucher tidak ditemukan.';
  if (!voucher.active) return 'Kode voucher sedang nonaktif.';
  if (voucher.starts_at && Date.parse(voucher.starts_at) > now) return 'Kode voucher belum memasuki masa berlaku.';
  if (voucher.expires_at && Date.parse(voucher.expires_at) <= now) return 'Kode voucher sudah kedaluwarsa.';
  if (voucher.max_uses !== null && Number(voucher.uses) >= Number(voucher.max_uses)) return 'Kuota kode voucher sudah habis.';
  return '';
}

function validateVoucherInput(body) {
  const code = String(body?.code || '').trim().toUpperCase();
  const discountType = String(body?.discountType || '');
  const discountValue = Number(body?.discountValue);
  const maxUses = body?.maxUses === '' || body?.maxUses == null ? null : Number(body.maxUses);
  const startsAt = body?.startsAt || null;
  const expiresAt = body?.expiresAt || null;
  const audience = String(body?.audience || 'everyone');

  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
    return { error: 'Kode voucher harus 3–30 karakter dan hanya boleh berisi huruf, angka, tanda hubung, atau garis bawah.' };
  }
  if (!['percent', 'fixed'].includes(discountType)) return { error: 'Pilih jenis diskon yang valid.' };
  if (!['everyone', 'registered', 'new_accounts', 'existing_accounts'].includes(audience)) {
    return { error: 'Pilih sasaran akun voucher yang valid.' };
  }
  if (!Number.isSafeInteger(discountValue) || discountValue < 1
    || (discountType === 'percent' && discountValue > 100)) {
    return { error: discountType === 'percent'
      ? 'Diskon persentase harus berupa bilangan bulat antara 1 dan 100.'
      : 'Potongan Rupiah harus berupa bilangan bulat lebih besar dari 0.' };
  }
  if (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses < 1)) {
    return { error: 'Batas pemakaian harus berupa bilangan bulat minimal 1, atau dikosongkan tanpa batas.' };
  }
  if ((startsAt && Number.isNaN(Date.parse(startsAt))) || (expiresAt && Number.isNaN(Date.parse(expiresAt)))) {
    return { error: 'Tanggal mulai atau berakhir tidak valid.' };
  }
  if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) {
    return { error: 'Waktu berakhir harus setelah waktu mulai.' };
  }

  return {
    voucher: {
      code,
      discount_type: discountType,
      discount_value: discountValue,
      active: body?.active !== false,
      is_public: body?.isPublic === true,
      audience,
      starts_at: startsAt,
      expires_at: expiresAt,
      max_uses: maxUses
    }
  };
}

function validateGameInput(body, id = body?.id) {
  const gameId = String(id || '').trim().toLowerCase();
  const name = String(body?.name || '').trim();
  const category = String(body?.category || '').trim();
  const variants = body?.variants;
  const imageUrls = [String(body?.logo || '').trim(), String(body?.banner || '').trim()];
  const validImageUrls = imageUrls.every((value) => {
    if (!value) return true;
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  });
  if (!validImageUrls) return { error: 'URL gambar harus menggunakan HTTP atau HTTPS.' };
  if (String(body?.description || '').length > 1000) return { error: 'Deskripsi maksimal 1.000 karakter.' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gameId) || !name || name.length > 100 || !category
    || category.length > 60 || !Array.isArray(variants) || !variants.length || variants.length > 100) {
    return { error: 'ID, nama, kategori, dan minimal satu nominal wajib diisi.' };
  }
  const normalizedVariants = [];
  const keys = new Set();
  for (const variant of variants) {
    const key = String(variant?.key || '').trim();
    const label = String(variant?.label || '').trim();
    const price = Number(variant?.price);
    if (!key || key.length > 80 || !label || label.length > 120 || !Number.isSafeInteger(price) || price < 0 || keys.has(key)) {
      return { error: 'Setiap nominal harus memiliki key unik, label, dan harga berupa angka non-negatif.' };
    }
    keys.add(key);
    normalizedVariants.push({ key, label, price });
  }
  return {
    game: {
      id: gameId,
      name,
      category,
      description: String(body.description || '').trim(),
      logo: String(body.logo || '').trim(),
      banner: String(body.banner || '').trim(),
      status: String(body.status || 'Tersedia').trim(),
      is_active: body.isActive !== false,
      featured: Boolean(body.featured),
      bestseller: Boolean(body.bestseller),
      variants: normalizedVariants,
      metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {}
    }
  };
}

app.get('/api/health', (req, res) => {
  res.status(supabase ? 200 : 503).json({
    ok: Boolean(supabase),
    message: supabase ? 'KRIS DIAMOND SHOP API is running' : `Backend belum dikonfigurasi: ${supabaseConfigError}`,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/customer-auth/config', (req, res) => {
  if (!supabase || !supabaseAnonKey) {
    return res.status(503).json({ message: 'Login pelanggan belum dikonfigurasi. Admin perlu mengatur SUPABASE_ANON_KEY.' });
  }
  res.json({ supabaseUrl, anonKey: supabaseAnonKey });
});

app.get('/api/push/config', (req, res) => {
  if (!webPushReady) {
    return res.status(503).json({ message: 'Notifikasi browser belum dikonfigurasi. Admin perlu mengatur kunci VAPID.' });
  }
  res.json({ vapidPublicKey });
});

async function getCustomerFromRequest(req) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { user: null, error: null };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: 'Sesi akun tidak valid atau sudah berakhir. Silakan login kembali.' };
  }
  if (data.user.banned_until && Date.parse(data.user.banned_until) > Date.now()) {
    return { user: null, error: 'Akun pelanggan ini telah dinonaktifkan.' };
  }
  if (!data.user.email_confirmed_at) {
    return { user: null, error: 'Verifikasi email akun sebelum melanjutkan.' };
  }
  return { user: data.user, error: null };
}

function isVoucherAudienceEligible(voucher, user, now = Date.now()) {
  const audience = voucher.audience || 'everyone';
  if (audience === 'everyone') return true;
  if (!user) return false;
  if (audience === 'registered') return true;
  const audienceStart = Date.parse(voucher.starts_at || voucher.created_at || '');
  if (!Number.isFinite(audienceStart)) return false;
  const registeredAt = Date.parse(user.created_at || '');
  if (!Number.isFinite(registeredAt)) return false;
  if (audience === 'new_accounts') return registeredAt >= audienceStart;
  if (audience === 'existing_accounts') return registeredAt < audienceStart;
  return false;
}

app.get('/api/games', async (req, res) => {
  if (!dbOrError(res)) return;
  try {
    await ensureGames();
    const [{ data, error }, { data: activeCategories, error: categoryError }] = await Promise.all([
      supabase.from('games').select('*').order('name'),
      supabase.from('categories').select('name').eq('is_active', true)
    ]);
    if (error) throw error;
    if (categoryError) throw categoryError;
    const activeCategoryNames = new Set((activeCategories || []).map((item) => item.name));
    const search = String(req.query.search || '').trim().toLowerCase();
    const category = String(req.query.category || 'all').trim();
    const sort = String(req.query.sort || 'featured');
    let games = data.filter((game) => game.is_active !== false && activeCategoryNames.has(game.category)).map(normalizeGame);

    if (search) games = games.filter((game) => `${game.name} ${game.description}`.toLowerCase().includes(search));
    if (category !== 'all') games = games.filter((game) => game.category === category);
    if (sort === 'price-low') {
      games.sort((a, b) => Math.min(...a.variants.map((item) => Number(item.price))) - Math.min(...b.variants.map((item) => Number(item.price))));
    } else if (sort === 'price-high') {
      games.sort((a, b) => Math.max(...b.variants.map((item) => Number(item.price))) - Math.max(...a.variants.map((item) => Number(item.price))));
    } else if (sort === 'name') {
      games.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      games.sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.bestseller) - Number(a.bestseller));
    }

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 9, 1), 50);
    res.json({
      items: games.slice((page - 1) * limit, page * limit),
      total: games.length,
      page,
      limit,
      categories: [...activeCategoryNames].sort()
    });
  } catch (error) {
    console.error('Games fetch error:', error);
    res.status(500).json({ message: 'Gagal mengambil data game.' });
  }
});

app.get('/api/games/:id', async (req, res) => {
  if (!dbOrError(res)) return;
  try {
    await ensureGames();
    const { data, error } = await supabase.from('games').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data || data.is_active === false) return res.status(404).json({ message: 'Game tidak ditemukan' });
    const { data: category, error: categoryError } = await supabase.from('categories')
      .select('is_active').eq('name', data.category).maybeSingle();
    if (categoryError) throw categoryError;
    if (category?.is_active === false) return res.status(404).json({ message: 'Game tidak ditemukan' });
    res.json(normalizeGame(data));
  } catch (error) {
    console.error('Game detail error:', error);
    res.status(500).json({ message: 'Gagal mengambil detail game.' });
  }
});

app.get('/api/site-content', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('site_content').select('source_text,replacement_text');
  if (error) throw error;
  res.json({ items: Object.fromEntries(data.map((item) => [item.source_text, item.replacement_text])) });
}));

app.get('/api/site-settings', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('site_settings')
    .select('key,value')
    .in('key', ['hero_banner_url', 'hero_banner_urls', 'about_banner_url', 'brand_logo_url', 'contact_links', 'maintenance_mode', 'maintenance_message', 'admin_fee']);
  if (error) throw error;
  const items = Object.fromEntries(data.map((item) => [item.key, item.value]));
  items.contact_links ||= JSON.stringify([
    { type: 'whatsapp', label: 'WhatsApp', value: '+62 857-8255-4720' },
    { type: 'email', label: 'Email support', value: 'krisdesign0@gmail.com' },
    { type: 'instagram', label: 'Instagram', value: 'krisdesignreal23' }
  ]);
  items.brand_logo_url ||= '';
  items.maintenance_mode ||= 'off';
  items.maintenance_message ||= '';
  items.admin_fee ||= '1500';
  items.hero_banner_urls ||= JSON.stringify(items.hero_banner_url ? [items.hero_banner_url] : []);
  items.about_banner_url ||= '';
  res.json({ items });
}));

app.get('/api/payment-methods', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('payment_methods')
    .select('id,name,instructions,image_url,sort_order')
    .eq('active', true)
    .order('sort_order')
    .order('name');
  if (error) throw error;
  res.json({ items: data });
}));

app.post('/api/vouchers/validate', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const code = String(req.body?.code || '').trim().toUpperCase();
  const price = Number(req.body?.price);
  if (!code || !Number.isSafeInteger(price) || price < 0) return res.status(400).json({ message: 'Kode voucher atau harga tidak valid.' });
  const { user, error: customerError } = await getCustomerFromRequest(req);
  if (customerError) return res.status(401).json({ message: customerError });
  if (!user) return res.status(401).json({ message: 'Login dan verifikasi email terlebih dahulu untuk menggunakan voucher.' });
  const { data, error } = await supabase.from('vouchers').select('*').eq('code', code).maybeSingle();
  if (error) throw error;
  const unavailableMessage = getVoucherUnavailableMessage(data);
  if (unavailableMessage) return res.status(400).json({ message: unavailableMessage });
  if (!isVoucherAudienceEligible(data, user)) {
    return res.status(403).json({ message: 'Voucher ini tidak berlaku untuk jenis akun Anda.' });
  }
  const { data: previousUse, error: redemptionError } = await supabase.from('voucher_redemptions')
    .select('id').eq('voucher_code', code).eq('customer_account_id', user.id).maybeSingle();
  if (redemptionError) throw redemptionError;
  if (previousUse) return res.status(400).json({ message: 'Voucher ini sudah pernah digunakan oleh akun Anda.' });
  const discount = data.discount_type === 'percent'
    ? Math.round(price * data.discount_value / 100)
    : Math.min(price, data.discount_value);
  res.json({ code, discount, message: 'Kode voucher berhasil digunakan.' });
}));

app.get('/api/public-vouchers', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { user, error: customerError } = await getCustomerFromRequest(req);
  if (customerError) return res.status(401).json({ message: customerError });
  const { data, error } = await supabase.from('vouchers')
    .select('code,discount_type,discount_value,active,starts_at,expires_at,max_uses,uses,audience,created_at')
    .eq('is_public', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const now = Date.now();
  const items = (data || []).filter((voucher) => isVoucherAudienceEligible(voucher, user, now)).map((voucher) => ({
    code: voucher.code,
    discount_type: voucher.discount_type,
    discount_value: voucher.discount_value,
    starts_at: voucher.starts_at,
    expires_at: voucher.expires_at,
    active: voucher.active,
    available: !getVoucherUnavailableMessage(voucher, now),
    status_message: getVoucherUnavailableMessage(voucher, now)
  }));
  res.json({ items });
}));

app.get('/api/categories', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('categories').select('name').eq('is_active', true).order('name');
  if (error) throw error;
  res.json({ items: data.map((item) => item.name) });
}));

app.get('/api/admin/categories', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('categories').select('name,is_active').order('name');
  if (error) throw error;
  res.json({ items: data.map((item) => ({ name: item.name, isActive: item.is_active !== false })) });
}));

app.get('/api/admin/games', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('games').select('*').order('name');
  if (error) throw error;
  res.json({ items: data.map(normalizeGame) });
}));

app.patch('/api/admin/games/:id/active', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ message: 'Status aktif produk tidak valid.' });
  if (req.body.isActive) {
    const { data: game, error: gameError } = await supabase.from('games').select('category').eq('id', req.params.id).maybeSingle();
    if (gameError) throw gameError;
    if (!game) return res.status(404).json({ message: 'Produk tidak ditemukan.' });
    const { data: category, error: categoryError } = await supabase.from('categories')
      .select('is_active').eq('name', game.category).maybeSingle();
    if (categoryError) throw categoryError;
    if (category?.is_active === false) return res.status(400).json({ message: 'Aktifkan kategori produk terlebih dahulu.' });
  }
  const { data, error } = await supabase.from('games').update({ is_active: req.body.isActive })
    .eq('id', req.params.id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ message: 'Produk tidak ditemukan.' });
  res.json({ item: normalizeGame(data), message: `Produk berhasil ${req.body.isActive ? 'diaktifkan' : 'dinonaktifkan'}.` });
}));

app.post('/api/admin/games', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { game, error: validationError } = validateGameInput(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  if (game.is_active) {
    const { data: category, error: categoryCheckError } = await supabase.from('categories')
      .select('is_active').eq('name', game.category).maybeSingle();
    if (categoryCheckError) throw categoryCheckError;
    if (category?.is_active === false) return res.status(400).json({ message: 'Aktifkan kategori produk terlebih dahulu.' });
  }
  const { error: categoryError } = await supabase.from('categories').upsert({ name: game.category }, { onConflict: 'name', ignoreDuplicates: true });
  if (categoryError) throw categoryError;
  const { error } = await supabase.from('games').insert(game);
  if (error?.code === '23505') return res.status(409).json({ message: 'ID produk sudah digunakan.' });
  if (error) throw error;
  res.status(201).json({ item: normalizeGame(game), message: 'Produk berhasil ditambahkan.' });
}));

app.put('/api/admin/games/:id', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { game, error: validationError } = validateGameInput(req.body, req.params.id);
  if (validationError) return res.status(400).json({ message: validationError });
  if (game.is_active) {
    const { data: category, error: categoryCheckError } = await supabase.from('categories')
      .select('is_active').eq('name', game.category).maybeSingle();
    if (categoryCheckError) throw categoryCheckError;
    if (category?.is_active === false) return res.status(400).json({ message: 'Aktifkan kategori produk terlebih dahulu.' });
  }
  const { error: categoryError } = await supabase.from('categories').upsert({ name: game.category }, { onConflict: 'name', ignoreDuplicates: true });
  if (categoryError) throw categoryError;
  const { data, error } = await supabase.from('games').update(game).eq('id', req.params.id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ message: 'Produk tidak ditemukan.' });
  res.json({ item: normalizeGame(data), message: 'Produk berhasil diperbarui.' });
}));

app.delete('/api/admin/games/:id', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { count, error: orderError } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('game_id', req.params.id);
  if (orderError) throw orderError;
  if (count) return res.status(409).json({ message: 'Produk tidak dapat dihapus karena sudah memiliki riwayat pesanan. Nonaktifkan produknya sebagai gantinya.' });
  const { error } = await supabase.from('games').delete().eq('id', req.params.id);
  if (error) throw error;
  res.json({ message: 'Produk berhasil dihapus.' });
}));

app.post('/api/admin/categories', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ message: 'Nama kategori wajib diisi.' });
  const { error } = await supabase.from('categories').insert({ name, is_active: true });
  if (error?.code === '23505') return res.status(409).json({ message: 'Kategori sudah ada.' });
  if (error) throw error;
  res.status(201).json({ item: { name, isActive: true }, message: 'Kategori berhasil ditambahkan.' });
}));

app.patch('/api/admin/categories/:name/active', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ message: 'Status aktif kategori tidak valid.' });
  const name = String(req.params.name || '').trim();
  const { data, error } = await supabase.from('categories').update({ is_active: req.body.isActive })
    .eq('name', name).select('name,is_active').maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ message: 'Kategori tidak ditemukan.' });
  res.json({ item: { name: data.name, isActive: data.is_active }, message: `Kategori berhasil ${data.is_active ? 'diaktifkan' : 'dinonaktifkan'}.` });
}));

app.delete('/api/admin/categories/:name', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const name = String(req.params.name || '').trim();
  const { count, error: gameError } = await supabase.from('games').select('id', { count: 'exact', head: true }).eq('category', name);
  if (gameError) throw gameError;
  if (count) return res.status(409).json({ message: 'Kategori masih digunakan produk. Pindahkan produk ke kategori lain terlebih dahulu.' });
  const { error } = await supabase.from('categories').delete().eq('name', name);
  if (error) throw error;
  res.json({ message: 'Kategori berhasil dihapus.' });
}));

app.get('/api/admin/gallery', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.storage.from('product-images').list('', {
    limit: 100,
    sortBy: { column: 'created_at', order: 'desc' }
  });
  if (error) throw error;
  const items = (data || []).filter((item) => item.id).map((item) => {
    const path = item.name;
    const { data: publicUrl } = supabase.storage.from('product-images').getPublicUrl(path);
    return { name: path, url: publicUrl.publicUrl };
  });
  res.json({ items });
}));

app.get('/api/admin/contact-messages', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('contact_messages')
    .select('id,name,email,message,created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  res.json({ items: data });
}));

app.delete('/api/admin/contact-messages/:id', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const id = String(req.params.id || '').trim();
  if (!id || id.length > 100) return res.status(400).json({ message: 'ID pesan tidak valid.' });
  const { data, error } = await supabase.from('contact_messages')
    .delete().eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ message: 'Pesan tidak ditemukan.' });
  res.json({ message: 'Pesan berhasil dihapus.' });
}));

app.post('/api/admin/gallery/upload-url', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const contentType = String(req.body?.contentType || '');
  const size = Number(req.body?.size);
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[contentType];
  if (!extension) return res.status(400).json({ message: 'Pilih gambar JPG, PNG, atau WEBP.' });
  if (!Number.isSafeInteger(size) || size <= 0 || size > 15 * 1024 * 1024) {
    return res.status(413).json({ message: 'Ukuran gambar maksimal 15 MB.' });
  }
  const imagePath = `${randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage.from('product-images').createSignedUploadUrl(imagePath);
  if (error) throw error;
  const { data: publicUrl } = supabase.storage.from('product-images').getPublicUrl(imagePath);
  res.status(201).json({
    item: { name: imagePath, path: data.path, signedUrl: data.signedUrl, url: publicUrl.publicUrl },
    message: 'URL unggah gambar berhasil dibuat.'
  });
}));

app.delete('/api/admin/gallery/:name', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const imageName = String(req.params.name || '');
  if (!/^[\w.-]+\.(?:jpg|png|webp)$/i.test(imageName)) return res.status(400).json({ message: 'Nama gambar tidak valid.' });
  const imagePattern = `%/${imageName}%`;
  const [gamesResult, paymentMethodsResult, settingsResult] = await Promise.all([
    supabase.from('games').select('id').or(`logo.ilike.${imagePattern},banner.ilike.${imagePattern}`),
    supabase.from('payment_methods').select('id').ilike('image_url', imagePattern),
    supabase.from('site_settings').select('key').eq('key', 'hero_banner_url').ilike('value', imagePattern)
  ]);
  if (gamesResult.error) throw gamesResult.error;
  if (paymentMethodsResult.error) throw paymentMethodsResult.error;
  if (settingsResult.error) throw settingsResult.error;
  if (gamesResult.data?.length || paymentMethodsResult.data?.length || settingsResult.data?.length) {
    return res.status(409).json({ message: 'Gambar masih digunakan. Ganti gambar pada produk, metode pembayaran, atau banner utama terlebih dahulu.' });
  }
  const { error } = await supabase.storage.from('product-images').remove([imageName]);
  if (error) throw error;
  res.json({ message: 'Gambar berhasil dihapus.' });
}));

app.patch('/api/admin/content', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 1000) return res.status(400).json({ message: 'Daftar teks tidak valid.' });
  const validItems = items
    .filter((item) => typeof item?.sourceText === 'string' && typeof item?.replacementText === 'string')
    .map((item) => ({
      source_text: item.sourceText.trim().slice(0, 500),
      replacement_text: item.replacementText.slice(0, 1000),
      updated_at: new Date().toISOString()
    }))
    .filter((item) => item.source_text);
  const normalized = validItems.filter((item) => item.replacement_text.trim() && item.source_text !== item.replacement_text);
  const resets = validItems.filter((item) => !item.replacement_text.trim() || item.source_text === item.replacement_text);
  if (!validItems.length) return res.json({ message: 'Tidak ada perubahan teks.' });
  if (resets.length) {
    const { error } = await supabase.from('site_content').delete().in('source_text', resets.map((item) => item.source_text));
    if (error) throw error;
  }
  if (normalized.length) {
    const { error } = await supabase.from('site_content').upsert(normalized, { onConflict: 'source_text' });
    if (error) throw error;
  }
  res.json({ message: normalized.length ? `${normalized.length} teks berhasil diperbarui.` : `${resets.length} teks berhasil direset.` });
}));

app.patch('/api/admin/site-settings', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const rows = [];
  const updated = {};
  const addImageSetting = (bodyKey, settingKey, label, responseKey, allowEmpty = false) => {
    if (!Object.hasOwn(req.body || {}, bodyKey)) return '';
    const url = String(req.body[bodyKey] || '').trim();
    if (!url && !allowEmpty) return `${label} wajib diisi.`;
    if (!url) {
      rows.push({ key: settingKey, value: '' });
      updated[responseKey] = '';
      return '';
    }
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid protocol');
    } catch {
      return `URL ${label.toLowerCase()} harus menggunakan HTTP atau HTTPS.`;
    }
    rows.push({ key: settingKey, value: url });
    updated[responseKey] = url;
    return '';
  };
  for (const [bodyKey, settingKey, label, responseKey] of [
    ['heroBannerUrl', 'hero_banner_url', 'URL gambar banner', 'heroBannerUrl'],
    ['brandLogoUrl', 'brand_logo_url', 'URL logo website', 'brandLogoUrl'],
    ['aboutBannerUrl', 'about_banner_url', 'URL gambar bagian Tentang', 'aboutBannerUrl', true]
  ]) {
    const validationMessage = addImageSetting(bodyKey, settingKey, label, responseKey, bodyKey === 'aboutBannerUrl');
    if (validationMessage) return res.status(400).json({ message: validationMessage });
  }
  if (Object.hasOwn(req.body || {}, 'heroBannerUrls')) {
    const urls = req.body.heroBannerUrls;
    if (!Array.isArray(urls) || urls.length > 10 || urls.some((value) => typeof value !== 'string')) {
      return res.status(400).json({ message: 'Banner utama harus berisi maksimal 10 URL gambar.' });
    }
    const normalized = [];
    for (const value of urls) {
      const url = value.trim();
      if (!url) continue;
      try {
        if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid protocol');
      } catch {
        return res.status(400).json({ message: 'Setiap URL banner harus menggunakan HTTP atau HTTPS.' });
      }
      normalized.push(url);
    }
    rows.push(
      { key: 'hero_banner_urls', value: JSON.stringify(normalized) },
      { key: 'hero_banner_url', value: normalized[0] || '' }
    );
    updated.heroBannerUrls = normalized;
    updated.heroBannerUrl = normalized[0] || '';
  }
  if (Object.hasOwn(req.body || {}, 'contactLinks')) {
    const items = req.body.contactLinks;
    if (!Array.isArray(items) || items.length > 12) {
      return res.status(400).json({ message: 'Daftar kontak tidak valid (maksimal 12 kontak).' });
    }
    const validTypes = new Set(['whatsapp', 'email', 'instagram']);
    const normalized = [];
    for (const item of items) {
      const type = String(item?.type || '');
      const label = String(item?.label || '').trim().slice(0, 60);
      let value = String(item?.value || '').trim().slice(0, 180);
      if (!validTypes.has(type) || !label || !value) {
        return res.status(400).json({ message: 'Setiap kontak harus memiliki jenis, label, dan nilai yang valid.' });
      }
      if (type === 'whatsapp') {
        const digits = value.replace(/\D/g, '');
        if (digits.length < 8 || digits.length > 15) return res.status(400).json({ message: `Nomor WhatsApp "${label}" tidak valid.` });
        value = digits;
      } else if (type === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return res.status(400).json({ message: `Alamat email "${label}" tidak valid.` });
      } else {
        value = value.replace(/^@+/, '');
        if (!/^[A-Za-z0-9._]{1,30}$/.test(value)) return res.status(400).json({ message: `Username Instagram "${label}" tidak valid.` });
      }
      normalized.push({ type, label, value });
    }
    rows.push({ key: 'contact_links', value: JSON.stringify(normalized) });
    updated.contactLinks = normalized;
  }
  if (Object.hasOwn(req.body || {}, 'maintenanceMode')) {
    const maintenanceMode = String(req.body.maintenanceMode || '');
    if (!['off', 'transactions', 'full'].includes(maintenanceMode)) {
      return res.status(400).json({ message: 'Pilih mode maintenance yang valid.' });
    }
    const maintenanceMessage = String(req.body.maintenanceMessage || '').trim();
    if (maintenanceMessage.length > 240) return res.status(400).json({ message: 'Pesan maintenance maksimal 240 karakter.' });
    rows.push(
      { key: 'maintenance_mode', value: maintenanceMode },
      { key: 'maintenance_message', value: maintenanceMessage }
    );
    updated.maintenanceMode = maintenanceMode;
    updated.maintenanceMessage = maintenanceMessage;
  }
  if (Object.hasOwn(req.body || {}, 'adminFee')) {
    const adminFee = Number(req.body.adminFee);
    if (!Number.isSafeInteger(adminFee) || adminFee < 0 || adminFee > 1000000) {
      return res.status(400).json({ message: 'Biaya admin harus berupa angka Rupiah dari 0 sampai 1.000.000.' });
    }
    rows.push({ key: 'admin_fee', value: String(adminFee) });
    updated.adminFee = adminFee;
  }
  if (!rows.length) return res.status(400).json({ message: 'Tidak ada pengaturan yang diperbarui.' });
  const { error } = await supabase.from('site_settings').upsert(rows.map((row) => ({
    ...row,
    updated_at: new Date().toISOString()
  })), { onConflict: 'key' });
  if (error) throw error;
  res.json({ message: 'Pengaturan website berhasil diperbarui.', item: updated });
}));

app.get('/api/admin/vouchers', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('vouchers').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  res.json({ items: data });
}));

app.get('/api/admin/payment-methods', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('payment_methods').select('*').order('sort_order').order('name');
  if (error) throw error;
  res.json({ items: data });
}));

app.get('/api/admin/customers', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  res.json({
    items: (data.users || []).map((user) => ({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || '',
      createdAt: user.created_at,
      isActive: !user.banned_until || Date.parse(user.banned_until) <= Date.now()
    }))
  });
}));

app.patch('/api/admin/customers/:id/active', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const userId = String(req.params.id || '');
  const isActive = req.body?.isActive;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    || typeof isActive !== 'boolean') {
    return res.status(400).json({ message: 'Akun pelanggan atau status aktif tidak valid.' });
  }
  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: isActive ? 'none' : '876000h'
  });
  if (error) throw error;
  if (!data.user) return res.status(404).json({ message: 'Akun pelanggan tidak ditemukan.' });
  res.json({ message: `Akun pelanggan berhasil ${isActive ? 'diaktifkan' : 'dinonaktifkan'}.` });
}));

function validatePaymentMethod(body, id) {
  const name = String(body?.name || '').trim().slice(0, 80);
  const instructions = String(body?.instructions || '').trim().slice(0, 1000);
  const imageUrl = String(body?.imageUrl || '').trim();
  const slug = String(id || body?.id || name).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!name || !slug) return { error: 'Nama metode pembayaran wajib diisi.' };
  if (imageUrl) {
    try {
      if (!['http:', 'https:'].includes(new URL(imageUrl).protocol)) throw new Error('invalid protocol');
    } catch {
      return { error: 'URL gambar pembayaran harus menggunakan HTTP atau HTTPS.' };
    }
  }
  return {
    method: {
      id: slug,
      name,
      instructions,
      image_url: imageUrl,
      active: body?.active !== false,
      sort_order: Number.isSafeInteger(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0,
      updated_at: new Date().toISOString()
    }
  };
}

app.post('/api/admin/payment-methods', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { method, error: validationError } = validatePaymentMethod(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  const { data, error } = await supabase.from('payment_methods').insert(method).select('*').single();
  if (error?.code === '23505') return res.status(409).json({ message: 'Nama atau ID metode pembayaran sudah digunakan.' });
  if (error) throw error;
  res.status(201).json({ item: data, message: 'Metode pembayaran berhasil ditambahkan.' });
}));

app.put('/api/admin/payment-methods/:id', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { method, error: validationError } = validatePaymentMethod(req.body, req.params.id);
  if (validationError) return res.status(400).json({ message: validationError });
  const { data, error } = await supabase.from('payment_methods').update(method)
    .eq('id', req.params.id).select('*').maybeSingle();
  if (error?.code === '23505') return res.status(409).json({ message: 'Nama metode pembayaran sudah digunakan.' });
  if (error) throw error;
  if (!data) return res.status(404).json({ message: 'Metode pembayaran tidak ditemukan.' });
  res.json({ item: data, message: 'Metode pembayaran berhasil diperbarui.' });
}));

app.delete('/api/admin/payment-methods/:id', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { error } = await supabase.from('payment_methods').delete().eq('id', req.params.id);
  if (error) throw error;
  res.json({ message: 'Metode pembayaran berhasil dihapus.' });
}));

app.post('/api/admin/vouchers', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { voucher, error: validationError } = validateVoucherInput(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  const { data, error } = await supabase.from('vouchers').insert(voucher).select('*').single();
  if (error?.code === '23505') return res.status(409).json({ message: 'Kode voucher sudah digunakan.' });
  if (error) throw error;
  res.status(201).json({ item: data, message: 'Voucher berhasil dibuat.' });
}));

app.put('/api/admin/vouchers/:code', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { voucher, error: validationError } = validateVoucherInput(req.body);
  if (validationError) return res.status(400).json({ message: validationError });
  const currentCode = String(req.params.code || '').trim().toUpperCase();
  const { data: current, error: currentError } = await supabase.from('vouchers')
    .select('uses').eq('code', currentCode).maybeSingle();
  if (currentError) throw currentError;
  if (!current) return res.status(404).json({ message: 'Voucher tidak ditemukan.' });
  if (voucher.max_uses !== null && voucher.max_uses < Number(current.uses || 0)) {
    return res.status(400).json({ message: `Batas pemakaian tidak boleh kurang dari jumlah yang sudah digunakan (${current.uses}).` });
  }
  const { data, error } = await supabase.from('vouchers').update(voucher)
    .eq('code', currentCode).select('*').maybeSingle();
  if (error?.code === '23505') return res.status(409).json({ message: 'Kode voucher baru sudah digunakan.' });
  if (error) throw error;
  if (!data) return res.status(404).json({ message: 'Voucher tidak ditemukan.' });
  res.json({ item: data, message: 'Voucher berhasil diperbarui.' });
}));

app.delete('/api/admin/vouchers/:code', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const code = String(req.params.code || '').toUpperCase();
  const { data, error } = await supabase.from('vouchers').delete().eq('code', code).select('code').maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ message: 'Voucher tidak ditemukan.' });
  res.json({ message: 'Voucher berhasil dihapus.' });
}));

app.post('/api/orders', async (req, res) => {
  if (!dbOrError(res)) return;
  let configuredAdminFee = 1500;
  try {
    const { data: maintenanceSettings, error: settingsError } = await supabase.from('site_settings')
      .select('key,value')
      .in('key', ['maintenance_mode', 'maintenance_message', 'admin_fee']);
    if (settingsError) throw settingsError;
    const settings = Object.fromEntries((maintenanceSettings || []).map((item) => [item.key, item.value]));
    if (settings.maintenance_mode && settings.maintenance_mode !== 'off') {
      return res.status(503).json({
        message: settings.maintenance_message || 'Transaksi sedang dihentikan sementara karena maintenance. Silakan coba kembali nanti.'
      });
    }
    if (settings.admin_fee !== undefined) {
      configuredAdminFee = Number(settings.admin_fee);
      if (!Number.isSafeInteger(configuredAdminFee) || configuredAdminFee < 0 || configuredAdminFee > 1000000) {
        return res.status(500).json({ message: 'Pengaturan biaya admin tidak valid. Hubungi admin toko.' });
      }
    }
  } catch (error) {
    console.error('Order maintenance check error:', error);
    return res.status(500).json({ message: 'Status maintenance tidak dapat diperiksa. Silakan coba kembali.' });
  }
  const {
    gameId, variantKey, customerName, customerPhone, customerEmail,
    userIdInput, serverId, paymentMethod, voucherCode, note
  } = req.body || {};
  if (!gameId || !variantKey || !customerName || !customerPhone || !customerEmail || !userIdInput) {
    return res.status(400).json({ message: 'Mohon lengkapi semua data pelanggan dan akun game yang dibutuhkan.' });
  }

  let orderCreated = false;
  let orderReady = false;
  let orderId = '';
  const rollbackOrder = async (id) => {
    const { error: redemptionCleanupError } = await supabase.from('voucher_redemptions').delete().eq('order_id', id);
    if (redemptionCleanupError) throw redemptionCleanupError;
    const { error: orderCleanupError } = await supabase.from('orders').delete().eq('id', id);
    if (orderCleanupError) throw orderCleanupError;
  };
  try {
    const { user: customerAccount, error: customerError } = await getCustomerFromRequest(req);
    if (customerError) return res.status(401).json({ message: customerError });
    await ensureGames();
    const { data: gameRow, error: gameError } = await supabase.from('games').select('*').eq('id', gameId).maybeSingle();
    if (gameError) throw gameError;
    if (!gameRow) return res.status(404).json({ message: 'Game tidak ditemukan' });
    if (gameRow.is_active === false) return res.status(400).json({ message: 'Produk sedang tidak tersedia.' });
    const { data: category, error: categoryError } = await supabase.from('categories')
      .select('is_active').eq('name', gameRow.category).maybeSingle();
    if (categoryError) throw categoryError;
    if (category?.is_active === false) return res.status(400).json({ message: 'Kategori produk sedang tidak tersedia.' });

    const game = normalizeGame(gameRow);
    const requestedPaymentMethod = String(paymentMethod || '').trim();
    const { data: activePaymentMethod, error: paymentMethodError } = await supabase.from('payment_methods')
      .select('name').eq('name', requestedPaymentMethod).eq('active', true).maybeSingle();
    if (paymentMethodError) throw paymentMethodError;
    if (!activePaymentMethod) return res.status(400).json({ message: 'Metode pembayaran tidak tersedia. Silakan pilih metode lain.' });
    const variant = game.variants.find((option) => option.key === variantKey);
    if (!variant) return res.status(400).json({ message: 'Pilihan nominal tidak valid' });

    const adminFee = configuredAdminFee;
    const voucher = String(voucherCode || '').trim().toUpperCase();
    let voucherRow = null;
    let discount = 0;
    if (voucher) {
      const { data, error: voucherError } = await supabase.from('vouchers').select('*').eq('code', voucher).maybeSingle();
      if (voucherError) throw voucherError;
      const unavailableMessage = getVoucherUnavailableMessage(data);
      if (unavailableMessage) return res.status(400).json({ message: unavailableMessage });
      if (!customerAccount) {
        return res.status(401).json({ message: 'Login dan verifikasi email terlebih dahulu untuk menggunakan voucher.' });
      }
      if (!isVoucherAudienceEligible(data, customerAccount)) {
        return res.status(403).json({ message: 'Voucher ini tidak berlaku untuk jenis akun Anda.' });
      }
      const { data: previousUse, error: redemptionError } = await supabase.from('voucher_redemptions')
        .select('id').eq('voucher_code', voucher).eq('customer_account_id', customerAccount.id).maybeSingle();
      if (redemptionError) throw redemptionError;
      if (previousUse) return res.status(400).json({ message: 'Voucher ini sudah pernah digunakan oleh akun Anda.' });
      voucherRow = data;
      discount = data.discount_type === 'percent'
        ? Math.round(Number(variant.price) * data.discount_value / 100)
        : Math.min(Number(variant.price), data.discount_value);
    }
    const now = new Date().toISOString();
    orderId = `KDS-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const userId = randomUUID();
    const orderRow = {
      id: orderId,
      game_id: game.id,
      game_name: game.name,
      category: game.category,
      variant_key: variant.key,
      variant_name: variant.label,
      price: Number(variant.price),
      admin_fee: adminFee,
      discount_amount: discount,
      total_amount: Math.max(Number(variant.price) + adminFee - discount, 0),
      customer_name: String(customerName).trim(),
      customer_email: String(customerAccount?.email || customerEmail).trim(),
      customer_phone: String(customerPhone).trim(),
      user_id_input: String(userIdInput).trim(),
      server_id: String(serverId || '').trim(),
      payment_method: activePaymentMethod.name,
      voucher_code: voucher,
      payment_proof: null,
      note: note || '',
      status: STATUS_FLOW[0],
      user_id: userId,
      customer_account_id: customerAccount?.id || null,
      created_at: now,
      updated_at: now
    };

    const { error: insertError } = await supabase.from('orders').insert(orderRow);
    if (insertError) throw insertError;
    orderCreated = true;

    const { error: historyError } = await supabase.from('order_status_history').insert({
      order_id: orderId,
      status: STATUS_FLOW[0],
      note: 'Pesanan dibuat dan menunggu pembayaran.',
      created_at: now
    });
    if (historyError) throw historyError;

    if (voucherRow) {
      const { error: redemptionError } = await supabase.from('voucher_redemptions').insert({
        voucher_code: voucherRow.code,
        customer_account_id: customerAccount.id,
        order_id: orderId
      });
      if (redemptionError?.code === '23505') {
        await rollbackOrder(orderId);
        return res.status(409).json({ message: 'Voucher ini sudah pernah digunakan oleh akun Anda.' });
      }
      if (redemptionError) throw redemptionError;
      const redeemed = await redeemVoucher(voucherRow);
      if (!redeemed) {
        await rollbackOrder(orderId);
        return res.status(409).json({ message: 'Kuota voucher baru saja habis. Silakan coba kode lain.' });
      }
    }

    let pushNotificationMessage = '';
    if (req.body?.pushSubscription) {
      try {
        if (!webPushReady) throw new Error('Kunci VAPID belum dikonfigurasi.');
        await saveCustomerPushSubscription(orderRow, req.body.pushSubscription);
        pushNotificationMessage = 'Notifikasi perubahan status aktif di perangkat ini.';
      } catch (pushError) {
        console.error('Customer push subscription save error:', pushError.message);
        pushNotificationMessage = 'Pesanan berhasil dibuat, tetapi notifikasi belum aktif. Coba aktifkan kembali dari halaman checkout.';
      }
    }

    orderReady = true;
    await createNotification(userId, orderId, STATUS_FLOW[0], `Pesanan ${orderId} telah dibuat. Silakan lakukan pembayaran untuk melanjutkan proses.`);
    await sendAdminOrderPush(orderRow);
    res.status(201).json({
      message: 'Pesanan berhasil dibuat.',
      pushNotificationMessage,
      order: getOrderPayload(orderRow, [{ status: STATUS_FLOW[0], note: 'Pesanan dibuat dan menunggu pembayaran.', created_at: now }])
    });
  } catch (error) {
    if (orderCreated && !orderReady) {
      try {
        await rollbackOrder(orderId);
      } catch (cleanupError) {
        console.error('Incomplete order cleanup error:', cleanupError);
      }
    }
    console.error('Order creation error:', error);
    res.status(500).json({ message: 'Gagal membuat pesanan.' });
  }
});

app.get(['/api/orders', '/api/orders/:id'], async (req, res) => {
  if (!dbOrError(res)) return;
  const orderId = req.params.id || req.query.orderId;
  if (!orderId) return res.status(400).json({ message: 'ID pesanan wajib diisi.' });
  try {
    const order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    res.json(order);
  } catch (error) {
    console.error('Order lookup error:', error);
    res.status(500).json({ message: 'Gagal memeriksa pesanan.' });
  }
});

app.post('/api/orders/:id/upload-proof', upload.single('proof'), asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  if (!req.file) return res.status(400).json({ message: 'Bukti pembayaran wajib diupload.' });
  const { data: order, error: orderError } = await supabase.from('orders').select('id,status').eq('id', req.params.id).maybeSingle();
  if (orderError) return res.status(500).json({ message: 'Gagal memeriksa pesanan.' });
  if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });

  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf'
  }[req.file.mimetype];
  const objectPath = `${req.params.id}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from('payment-proofs')
    .upload(objectPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (uploadError) {
    console.error('Proof upload error:', uploadError);
    return res.status(500).json({ message: 'Gagal mengupload bukti pembayaran.' });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase.from('orders').update({
    payment_proof: objectPath,
    status: 'Menunggu Verifikasi',
    updated_at: now
  }).eq('id', req.params.id);
  if (updateError) {
    await supabase.storage.from('payment-proofs').remove([objectPath]);
    console.error('Proof order update error:', updateError);
    return res.status(500).json({ message: 'Gagal memperbarui status pembayaran.' });
  }

  const noteText = 'Bukti pembayaran berhasil diupload dan menunggu verifikasi admin.';
  const { error: historyError } = await supabase.from('order_status_history').insert({
    order_id: req.params.id,
    status: 'Menunggu Verifikasi',
    note: noteText,
    created_at: now
  });
  if (historyError) {
    console.error('Proof history insert error:', historyError);
    return res.status(500).json({ message: 'Bukti tersimpan, tetapi riwayat status gagal diperbarui.' });
  }
  res.json({ message: 'Bukti pembayaran berhasil diupload. Silakan menunggu verifikasi admin.', order: await getOrderById(req.params.id) });
}));

app.get('/api/notifications', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ message: 'ID pengguna wajib diisi.' });
  const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20);
  if (error) {
    console.error('Notifications fetch error:', error);
    return res.status(500).json({ message: 'Gagal mengambil notifikasi.' });
  }
  res.json({ items: data });
}));

app.patch('/api/notifications/:id/read', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', req.params.id);
  if (error) return res.status(500).json({ message: 'Gagal memperbarui notifikasi.' });
  res.json({ ok: true, message: 'Notifikasi ditandai telah dibaca' });
}));

app.post('/api/admin/push/devices', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  if (!firebaseMessaging) return res.status(503).json({ message: 'Notifikasi APK belum dikonfigurasi. Admin perlu mengatur kredensial Firebase di Vercel.' });
  const token = String(req.body?.token || '').trim();
  if (token.length < 20 || token.length > 4096) {
    return res.status(400).json({ message: 'Token perangkat tidak valid.' });
  }
  const { error } = await supabase.from('admin_push_devices').upsert({
    fcm_token: token,
    admin_username: req.adminSession.username,
    device_name: String(req.body?.deviceName || 'Android admin').trim().slice(0, 100),
    last_seen_at: new Date().toISOString()
  }, { onConflict: 'fcm_token' });
  if (error) throw error;
  res.json({ message: 'Perangkat aplikasi admin berhasil didaftarkan untuk notifikasi order.' });
}));

app.delete('/api/admin/push/devices', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ message: 'Token perangkat tidak valid.' });
  const { error } = await supabase.from('admin_push_devices').delete()
    .eq('fcm_token', token).eq('admin_username', req.adminSession.username);
  if (error) throw error;
  res.json({ message: 'Perangkat admin dihapus dari daftar notifikasi.' });
}));

app.get('/api/admin/orders', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Admin orders fetch error:', error);
    return res.status(500).json({ message: 'Gagal mengambil data admin.' });
  }
  res.json({ items: data.map((order) => getOrderPayload(order)) });
}));

app.patch('/api/admin/orders/:id/status', adminOnly, async (req, res) => {
  if (!dbOrError(res)) return;
  const { status, note } = req.body || {};
  if (!STATUS_FLOW.includes(status)) return res.status(400).json({ message: 'Status pesanan tidak valid.' });

  try {
    const { data: order, error: orderError } = await supabase.from('orders').select('*').eq('id', req.params.id).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });

    const now = new Date().toISOString();
    const statusNote = note || 'Status pesanan diperbarui.';
    const { error: updateError } = await supabase.from('orders').update({
      status,
      note: note || order.note || '',
      updated_at: now
    }).eq('id', req.params.id);
    if (updateError) throw updateError;

    const { error: historyError } = await supabase.from('order_status_history').insert({
      order_id: req.params.id,
      status,
      note: statusNote,
      created_at: now
    });
    if (historyError) throw historyError;
    const notificationTitle = `Status Pesanan ${status}`;
    const notificationMessage = `Pesanan ${order.id} kini berstatus ${status}.`;
    await createNotification(order.user_id, order.id, notificationTitle, notificationMessage);
    await sendCustomerPush(order.id, notificationTitle, notificationMessage);
    res.json({ message: 'Status pesanan berhasil diperbarui.', order: await getOrderById(req.params.id) });
  } catch (error) {
    console.error('Order status update error:', error);
    res.status(500).json({ message: 'Gagal mengubah status pesanan.' });
  }
});

app.delete('/api/admin/orders/:id', adminOnly, asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { data: order, error: orderError } = await supabase.from('orders')
    .select('id,status,payment_proof')
    .eq('id', req.params.id)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });
  if (!['Gagal', 'Refund', 'Dibatalkan'].includes(order.status)) {
    return res.status(409).json({ message: 'Hanya pesanan berstatus Gagal, Refund, atau Dibatalkan yang dapat dihapus.' });
  }
  if (order.payment_proof) {
    const { error: proofError } = await supabase.storage.from('payment-proofs').remove([order.payment_proof]);
    if (proofError) {
      console.error('Order proof cleanup error:', proofError);
      return res.status(500).json({ message: 'Bukti pembayaran gagal dihapus; pesanan tidak dihapus.' });
    }
  }
  const { error } = await supabase.from('orders').delete().eq('id', order.id);
  if (error) throw error;
  res.json({ message: 'Pesanan berhasil dihapus.' });
}));

app.post('/api/contact', asyncRoute(async (req, res) => {
  if (!dbOrError(res)) return;
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ message: 'Nama, email, dan pesan wajib diisi.' });
  const { error } = await supabase.from('contact_messages').insert({
    id: `msg-${randomUUID()}`,
    name,
    email,
    message
  });
  if (error) {
    console.error('Contact message insert error:', error);
    return res.status(500).json({ message: 'Gagal mengirim pesan.' });
  }
  res.status(201).json({ ok: true, message: 'Pesan berhasil dikirim. Tim kami akan segera membalas Anda.' });
}));

async function sendStorefrontPage(req, res, next) {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('site_settings').select('value')
        .eq('key', 'maintenance_mode').maybeSingle();
      if (error) throw error;
      if (data?.value === 'full') {
        return res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
      }
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (error) {
    console.error('Storefront maintenance check error:', error);
    next(error);
  }
}

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', sendStorefrontPage);
app.get('/index.html', sendStorefrontPage);
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  sendStorefrontPage(req, res, next);
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Ukuran bukti pembayaran maksimal 5 MB.' });
  }
  if (error.message?.startsWith('Format bukti pembayaran') || error.message?.startsWith('Format gambar')) {
    return res.status(400).json({ message: error.message });
  }
  console.error('Unhandled request error:', error);
  res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`KRIS DIAMOND SHOP running on http://localhost:${PORT}`));
}

module.exports = app;
