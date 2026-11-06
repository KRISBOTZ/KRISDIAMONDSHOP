const state = {
  games: [],
  categories: [],
  selectedGame: null,
  selectedVariant: null,
  notifications: [],
  trackedOrderId: null,
  trackedOrderStatus: null,
  orderPollTimer: null,
  adminOrders: [],
  adminGames: [],
  paymentMethods: [],
  siteContent: {},
  siteSettings: {}
};

const API_BASE = '/api';

function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

async function loadPublicPaymentMethods() {
  const select = document.getElementById('payment-method');
  if (!select) return;
  try {
    const result = await fetchJson(`${API_BASE}/payment-methods`);
    state.paymentMethods = result.items || [];
    select.innerHTML = state.paymentMethods.length
      ? state.paymentMethods.map((method, index) => `<option value="${escapeHtml(method.name)}" ${index === 0 ? 'selected' : ''}>${escapeHtml(method.name)}</option>`).join('')
      : '<option value="">Metode pembayaran belum tersedia</option>';
    renderPaymentMethodPreview();
  } catch (error) {
    select.innerHTML = '<option value="">Metode pembayaran gagal dimuat</option>';
    console.error('Payment methods load error:', error);
  }
}

function renderPaymentMethodPreview() {
  const select = document.getElementById('payment-method');
  const container = document.getElementById('payment-method-preview');
  if (!select || !container) return;
  const method = state.paymentMethods.find((item) => item.name === select.value);
  if (!method) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  const image = method.image_url
    ? `<img src="${escapeHtml(method.image_url)}" alt="QR ${escapeHtml(method.name)}" loading="lazy" />`
    : '';
  container.innerHTML = `${image}${method.instructions ? `<p><strong>Nomor / detail pembayaran:</strong><br />${escapeHtml(method.instructions)}</p>` : ''}`;
  container.hidden = !image && !method.instructions;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getVisibleTextKey(value) {
  return String(value || '').trim();
}

function applySiteContentToNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    state.appliedContentTextNodes ||= new WeakSet();
    if (state.appliedContentTextNodes.has(node)) return;
    state.appliedContentTextNodes.add(node);
    const source = getVisibleTextKey(node.nodeValue);
    const replacement = state.siteContent[source];
    if (replacement !== undefined && source) {
      const leading = node.nodeValue.match(/^\s*/)?.[0] || '';
      const trailing = node.nodeValue.match(/\s*$/)?.[0] || '';
      node.nodeValue = `${leading}${replacement}${trailing}`;
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;
  state.appliedContentAttributes ||= new WeakMap();
  let appliedAttributes = state.appliedContentAttributes.get(node);
  if (!appliedAttributes) {
    appliedAttributes = new Set();
    state.appliedContentAttributes.set(node, appliedAttributes);
  }
  ['placeholder', 'title', 'aria-label', 'alt'].forEach((attribute) => {
    if (appliedAttributes.has(attribute)) return;
    appliedAttributes.add(attribute);
    const source = getVisibleTextKey(node.getAttribute(attribute));
    if (source && state.siteContent[source] !== undefined) {
      node.setAttribute(attribute, state.siteContent[source]);
    }
  });
  if (node.matches('script,style,noscript')) return;
  node.childNodes.forEach(applySiteContentToNode);
}

function applySiteContentToMetadata(page) {
  const title = getVisibleTextKey(page.title);
  if (title && state.siteContent[title] !== undefined) page.title = state.siteContent[title];
  const description = page.querySelector('meta[name="description"]');
  const source = getVisibleTextKey(description?.content);
  if (description && source && state.siteContent[source] !== undefined) {
    description.content = state.siteContent[source];
  }
}

function applySiteSettings(settings) {
  state.siteSettings = settings || {};
  const heroBanner = document.getElementById('hero-banner-image');
  if (heroBanner && state.siteSettings.hero_banner_url) {
    heroBanner.src = state.siteSettings.hero_banner_url;
  }
}

async function loadSiteContentOverrides() {
  try {
    const [content, settings] = await Promise.all([
      fetchJson(`${API_BASE}/site-content`),
      fetchJson(`${API_BASE}/site-settings`)
    ]);
    state.siteContent = content.items || {};
    applySiteSettings(settings.items || {});
    applySiteContentToMetadata(document);
    applySiteContentToNode(document.body);
    if (!state.siteContentObserver) {
      state.siteContentObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'characterData') applySiteContentToNode(mutation.target);
          mutation.addedNodes?.forEach(applySiteContentToNode);
        });
      });
      state.siteContentObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
    }
  } catch (error) {
    console.error('Site content load error:', error);
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchJson(url, options = {}) {
  const headers = { ...options.headers };
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (url.includes('/api/admin/')) {
    const token = localStorage.getItem('adminSessionToken');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && url.includes('/api/admin/') && !url.endsWith('/api/admin/login')) {
      localStorage.removeItem('adminSessionToken');
      localStorage.removeItem('adminUsername');
    }
    throw new Error(payload.message || 'Request failed');
  }
  return payload;
}

async function uploadImageFile(file) {
  if (!file) return '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Pilih gambar JPG, PNG, atau WEBP.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Ukuran gambar maksimal 5 MB.');
  }
  const formData = new FormData();
  formData.append('image', file);
  const result = await fetchJson(`${API_BASE}/admin/gallery`, { method: 'POST', body: formData });
  return result.item.url;
}

function getPageMode() {
  return window.location.pathname.includes('/admin') ? 'admin' : 'home';
}

async function loadPublicVouchers() {
  const promoList = document.getElementById('public-voucher-list');
  if (!promoList) return;
  const promoSection = document.getElementById('promo');
  const sidebarPromo = document.getElementById('sidebar-public-promo');
  const heroPromo = document.getElementById('hero-public-promo');
  try {
    const result = await fetchJson(`${API_BASE}/public-vouchers`);
    const vouchers = result.items || [];
    if (!vouchers.length) {
      promoSection.hidden = true;
      if (sidebarPromo) sidebarPromo.hidden = true;
      if (heroPromo) heroPromo.hidden = true;
      return;
    }
    promoSection.hidden = false;
    promoList.innerHTML = vouchers.map((voucher) => `
      <p class="public-voucher-item">Gunakan kode <strong>${escapeHtml(voucher.code)}</strong> untuk diskon
        <strong>${voucher.discount_type === 'percent' ? `${Number(voucher.discount_value)}%` : formatRupiah(voucher.discount_value)}</strong>.</p>
    `).join('');
    if (sidebarPromo) {
      sidebarPromo.hidden = false;
      const firstVoucher = vouchers[0];
      document.getElementById('sidebar-public-voucher').textContent =
        `Gunakan kode ${firstVoucher.code} untuk diskon ${firstVoucher.discount_type === 'percent' ? `${Number(firstVoucher.discount_value)}%` : formatRupiah(firstVoucher.discount_value)}.`;
    }
    if (heroPromo) {
      heroPromo.hidden = false;
      document.getElementById('hero-public-voucher').textContent = vouchers[0].code;
    }
  } catch (error) {
    console.error('Public voucher load failed:', error);
    promoSection.hidden = true;
    if (sidebarPromo) sidebarPromo.hidden = true;
    if (heroPromo) heroPromo.hidden = true;
  }
}

async function loadGames() {
  try {
    const result = await fetchJson(`${API_BASE}/games?sort=featured&limit=12`);
    state.games = result.items || [];
    state.categories = result.categories || [];
    renderPopularGames();
    renderCatalog();
    populateCategoryFilter();
    const count = document.getElementById('catalog-count');
    const variantCount = state.games.reduce((total, game) => total + (game.variants || []).length, 0);
    if (count) count.textContent = `${variantCount} nominal tersedia`;
    if (state.games.length > 0 && !state.selectedGame) {
      selectGame(state.games[0]);
    }
  } catch (error) {
    console.error('Failed to load games:', error);
    const container = document.getElementById('product-grid');
    const message = getErrorMessage(error, 'Katalog sedang tidak tersedia.');
    if (container) container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    const popular = document.getElementById('popular-games');
    if (popular) popular.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    const count = document.getElementById('catalog-count');
    if (count) count.textContent = 'Katalog tidak tersedia';
  }
}

function populateCategoryFilter() {
  const filter = document.getElementById('category-filter');
  if (!filter) return;

  const currentValue = filter.value;
  filter.innerHTML = '<option value="all">Semua kategori</option>';
  state.categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    if (category === currentValue) option.selected = true;
    filter.appendChild(option);
  });

  const categoryList = document.getElementById('category-list');
  if (categoryList) {
    categoryList.innerHTML = `
      <button class="category-button ${currentValue === 'all' ? 'active' : ''}" type="button" data-category="all"><span>✦</span> Semua game</button>
      ${state.categories.map((category) => `
        <button class="category-button ${category === currentValue ? 'active' : ''}" type="button" data-category="${escapeHtml(category)}"><span>◇</span> ${escapeHtml(category)}</button>
      `).join('')}
    `;
    categoryList.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', () => {
        filter.value = button.dataset.category;
        categoryList.querySelectorAll('.category-button').forEach((item) => item.classList.toggle('active', item === button));
        renderCatalog();
      });
    });
  }
}

function renderPopularGames() {
  const container = document.getElementById('popular-games');
  if (!container) return;

  const featured = state.games.slice(0, 7);
  if (!featured.length) {
    container.innerHTML = '<div class="empty-state">Data game belum tersedia.</div>';
    return;
  }

  container.innerHTML = featured.map((game) => {
    const firstVariant = game.variants[0] || { price: 0, label: 'Diamond' };
    return `
      <article class="game-card">
        <img src="${escapeHtml(game.banner || game.logo)}" alt="${escapeHtml(game.name)}" loading="lazy" />
        <div class="game-meta">
          <h3>${escapeHtml(game.name)}</h3>
          <span class="card-tag">${escapeHtml(game.category)}</span>
        </div>
        <div class="price-row">
          <span>Mulai dari</span>
          <strong>${formatRupiah(firstVariant.price)}</strong>
        </div>
        <button class="button button-primary" type="button" data-game-id="${escapeHtml(game.id)}">Top Up <span aria-hidden="true">→</span></button>
      </article>
    `;
  }).join('');

  container.querySelectorAll('[data-game-id]').forEach((button) => {
    button.addEventListener('click', () => selectGameById(button.dataset.gameId));
  });
}

function renderCatalog() {
  const container = document.getElementById('product-grid');
  if (!container) return;

  const searchValue = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
  const categoryFilter = document.getElementById('category-filter')?.value || 'all';
  const sortFilter = document.getElementById('sort-filter')?.value || 'featured';

  let products = state.games.flatMap((game) => (game.variants || []).map((variant) => ({ game, variant })));

  if (searchValue) {
    products = products.filter(({ game, variant }) =>
      `${game.name} ${game.description} ${variant.label}`.toLowerCase().includes(searchValue)
    );
  }
  if (categoryFilter !== 'all') products = products.filter(({ game }) => game.category === categoryFilter);

  if (sortFilter === 'price-low') {
    products.sort((a, b) => Number(a.variant.price) - Number(b.variant.price));
  } else if (sortFilter === 'price-high') {
    products.sort((a, b) => Number(b.variant.price) - Number(a.variant.price));
  } else if (sortFilter === 'name') {
    products.sort((a, b) => a.game.name.localeCompare(b.game.name) || a.variant.label.localeCompare(b.variant.label));
  } else {
    products.sort((a, b) => Number(Boolean(b.game.featured)) - Number(Boolean(a.game.featured)));
  }

  if (!products.length) {
    container.innerHTML = '<div class="empty-state">Produk yang Anda cari belum tersedia.</div>';
    return;
  }

  container.innerHTML = products.map(({ game, variant }) => {
    return `
      <article class="product-card">
        <div class="product-card-image">
          <img src="${escapeHtml(game.banner || game.logo)}" alt="${escapeHtml(game.name)}" loading="lazy" />
          <span class="product-game-label">${escapeHtml(game.name)}</span>
        </div>
        <div class="product-meta">
          <h3>${escapeHtml(variant.label)}</h3>
          ${variant.bonus ? `<span class="product-bonus">${escapeHtml(variant.bonus)}</span>` : ''}
        </div>
        <div class="price-row">
          <span>${escapeHtml(game.category)}</span>
          <span class="product-price">${formatRupiah(variant.price)}</span>
        </div>
        <button class="button button-primary" type="button" data-game-id="${escapeHtml(game.id)}" data-variant-key="${escapeHtml(variant.key)}"><span aria-hidden="true">🛒</span> Beli Sekarang</button>
      </article>
    `;
  }).join('');

  container.querySelectorAll('[data-game-id]').forEach((button) => {
    button.addEventListener('click', () => selectGameById(button.dataset.gameId, button.dataset.variantKey));
  });
}

async function selectGameById(gameId, variantKey) {
  try {
    const game = await fetchJson(`${API_BASE}/games/${encodeURIComponent(gameId)}`);
    selectGame(game, variantKey);
    document.getElementById('selected-product')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('Failed to select game:', error);
  }
}

function selectGame(game, variantKey) {
  state.selectedGame = game;
  state.selectedVariant = game.variants.find((variant) => variant.key === variantKey) || game.variants[0] || null;
  renderSelectedProduct();
  updateCheckoutSummary();
}

function renderSelectedProduct() {
  const container = document.getElementById('selected-product');
  if (!container || !state.selectedGame) return;

  const options = state.selectedGame.variants.map((option) => {
    const selectedClass = option.key === (state.selectedVariant?.key || state.selectedGame.variants[0].key) ? 'selected' : '';
    return `
      <button type="button" class="option-item ${selectedClass}" data-variant-key="${escapeHtml(option.key)}">
        <span><strong>${escapeHtml(option.label)}</strong><br /><small>${escapeHtml(option.bonus || 'Pilih nominal ini')}</small></span>
        <strong>${formatRupiah(option.price)}</strong>
      </button>
    `;
  }).join('');

  container.innerHTML = `
    <div class="detail-media">
      <img src="${escapeHtml(state.selectedGame.banner || state.selectedGame.logo)}" alt="${escapeHtml(state.selectedGame.name)}" loading="lazy" />
    </div>
    <div class="product-meta-line">
      <span class="meta-chip">${escapeHtml(state.selectedGame.category)}</span>
      <span class="meta-chip">${escapeHtml(state.selectedGame.status)}</span>
      <span class="meta-chip">Top Up Instant</span>
    </div>
    <h3>${escapeHtml(state.selectedGame.name)}</h3>
    <p class="card-body">${escapeHtml(state.selectedGame.description)}</p>
    <div class="option-list">${options}</div>
    <div class="order-summary">
      <div class="summary-row">
        <span>Nominal terpilih</span>
        <strong>${escapeHtml(state.selectedVariant?.label || state.selectedGame.variants[0].label)}</strong>
      </div>
      <div class="summary-row">
        <span>Harga</span>
        <strong>${formatRupiah(state.selectedVariant?.price || state.selectedGame.variants[0].price)}</strong>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-variant-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const selectedKey = button.dataset.variantKey;
      state.selectedVariant = state.selectedGame.variants.find((option) => option.key === selectedKey) || state.selectedGame.variants[0];
      renderSelectedProduct();
      updateCheckoutSummary();
      const checkoutVariantKey = document.getElementById('checkout-variant-key');
      if (checkoutVariantKey) checkoutVariantKey.value = state.selectedVariant.key;
    });
  });

  const checkoutGameId = document.getElementById('checkout-game-id');
  if (checkoutGameId) checkoutGameId.value = state.selectedGame.id;

  const checkoutVariantKey = document.getElementById('checkout-variant-key');
  if (checkoutVariantKey) checkoutVariantKey.value = state.selectedVariant.key;
}

let voucherValidationSequence = 0;
async function updateCheckoutSummary() {
  const summaryPrice = document.getElementById('summary-price');
  const summaryAdmin = document.getElementById('summary-admin');
  const summaryDiscount = document.getElementById('summary-discount');
  const summaryTotal = document.getElementById('summary-total');

  if (!summaryPrice) return;

  const price = Number(state.selectedVariant?.price || 0);
  const adminFee = 1500;
  const voucherCode = document.getElementById('voucher-code')?.value || '';
  const validationSequence = ++voucherValidationSequence;
  let discount = 0;
  const feedback = document.getElementById('checkout-voucher-feedback');
  if (feedback) {
    feedback.hidden = true;
    feedback.classList.remove('success');
  }
  const normalizedVoucherCode = voucherCode.trim().toUpperCase();
  if (normalizedVoucherCode && !/^[A-Z0-9_-]{3,30}$/.test(normalizedVoucherCode)) {
    if (feedback) {
      feedback.textContent = 'Kode voucher harus 3–30 karakter (huruf, angka, - atau _).';
      feedback.hidden = false;
    }
  } else if (normalizedVoucherCode) {
    try {
      const result = await fetchJson(`${API_BASE}/vouchers/validate`, {
        method: 'POST',
        body: JSON.stringify({ code: normalizedVoucherCode, price })
      });
      if (validationSequence !== voucherValidationSequence) return;
      discount = Number(result.discount || 0);
      if (feedback) {
        feedback.textContent = result.message;
        feedback.classList.add('success');
        feedback.hidden = false;
      }
    } catch (error) {
      if (validationSequence !== voucherValidationSequence) return;
      if (feedback) {
        feedback.textContent = getErrorMessage(error, 'Voucher tidak valid.');
        feedback.hidden = false;
      }
    }
  }
  if (validationSequence !== voucherValidationSequence) return;
  const total = Math.max(price + adminFee - discount, 0);

  summaryPrice.textContent = formatRupiah(price);
  summaryAdmin.textContent = formatRupiah(adminFee);
  summaryDiscount.textContent = formatRupiah(discount);
  summaryTotal.textContent = formatRupiah(total);
}

async function handleCheckoutSubmit(event) {
  event.preventDefault();

  const payload = {
    gameId: document.getElementById('checkout-game-id').value,
    variantKey: document.getElementById('checkout-variant-key').value,
    customerName: document.getElementById('customer-name').value,
    customerPhone: document.getElementById('customer-phone').value,
    customerEmail: document.getElementById('customer-email').value,
    userIdInput: document.getElementById('user-id-input').value,
    serverId: document.getElementById('server-id').value,
    paymentMethod: document.getElementById('payment-method').value,
    voucherCode: document.getElementById('voucher-code').value,
    note: 'Checkout dari landing page'
  };

  try {
    const result = await fetchJson(`${API_BASE}/orders`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const targetOrderId = result.order?.id || '';
    alert(`Pesanan berhasil dibuat. ID Pesanan: ${targetOrderId}`);
    document.getElementById('checkout-form').reset();
    if (targetOrderId) {
      document.getElementById('order-id-input').value = targetOrderId;
      await getOrderResult(targetOrderId);
      document.getElementById('pesanan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (error) {
    alert(getErrorMessage(error, 'Tidak dapat membuat pesanan.'));
  }
}

async function getOrderResult(orderId, { quiet = false } = {}) {
  const resultContainer = document.getElementById('order-result');
  if (!resultContainer) return;

  if (!orderId) {
    resultContainer.innerHTML = '<div class="empty-state">Masukkan ID pesanan untuk melihat status transaksi.</div>';
    return;
  }
  if (state.trackedOrderId && state.trackedOrderId !== orderId) {
    window.clearInterval(state.orderPollTimer);
    state.trackedOrderStatus = null;
  }

  try {
    const order = await fetchJson(`${API_BASE}/orders/${orderId}`);
    const statusChanged = state.trackedOrderId === order.id
      && state.trackedOrderStatus
      && state.trackedOrderStatus !== order.status;
    state.trackedOrderId = order.id;
    state.trackedOrderStatus = order.status;
    const history = (order.orderHistory || []).map((item) => `
      <li>${escapeHtml(item.status)} — ${escapeHtml(item.note || 'Tidak ada catatan')} (${new Date(item.createdAt).toLocaleString('id-ID')})</li>
    `).join('');

    const proofForm = order.status === 'Menunggu Pembayaran' ? `
      <form id="payment-proof-form" class="form-stack" style="margin-top: 18px;">
        <label for="payment-proof">Upload bukti pembayaran (JPG, PNG, WEBP, PDF; maks. 5 MB)</label>
        <input id="payment-proof" class="input" type="file" name="proof" accept="image/jpeg,image/png,image/webp,application/pdf" required />
        <button class="button button-primary" type="submit">Kirim Bukti Pembayaran</button>
      </form>
    ` : '';
    const paymentDetails = order.paymentImageUrl || order.paymentInstructions ? `
      <div class="payment-order-details">
        <h4>Nomor / detail pembayaran · ${escapeHtml(order.paymentMethod)}</h4>
        ${order.paymentImageUrl ? `<img src="${escapeHtml(order.paymentImageUrl)}" alt="Gambar pembayaran ${escapeHtml(order.paymentMethod)}" loading="lazy" />` : ''}
        ${order.paymentInstructions ? `<p>${escapeHtml(order.paymentInstructions)}</p>` : ''}
      </div>
    ` : '';
    resultContainer.innerHTML = `
      <div class="panel">
        <h3>Detail Pesanan ${escapeHtml(order.id)}</h3>
        ${statusChanged ? '<p class="badge">Status pesanan baru saja diperbarui.</p>' : ''}
        <div class="form-grid">
          <div><strong>Game:</strong> ${escapeHtml(order.gameName)}</div>
          <div><strong>Nominal:</strong> ${escapeHtml(order.variantName)}</div>
          <div><strong>User ID:</strong> ${escapeHtml(order.userIdInput)}</div>
          <div><strong>Server:</strong> ${escapeHtml(order.serverId || '-')}</div>
          <div><strong>Total:</strong> ${formatRupiah(order.totalAmount)}</div>
          <div><strong>Metode Pembayaran:</strong> ${escapeHtml(order.paymentMethod)}</div>
          <div><strong>Status Pesanan:</strong> <span class="status-pill status-${slugify(order.status)}">${escapeHtml(order.status)}</span></div>
          <div><strong>Tanggal:</strong> ${new Date(order.createdAt).toLocaleString('id-ID')}</div>
        </div>
        <div style="margin-top: 18px;">
          <h4>Riwayat Status</h4>
          <ul>${history || '<li>Belum ada riwayat status.</li>'}</ul>
        </div>
        ${proofForm}
      </div>
    `;
    if (!quiet) {
      window.clearInterval(state.orderPollTimer);
      state.orderPollTimer = window.setInterval(() => getOrderResult(order.id, { quiet: true }), 10000);
    }
  } catch (error) {
    if (!quiet) resultContainer.innerHTML = `<div class="empty-state">${escapeHtml(getErrorMessage(error, 'Pesanan tidak ditemukan.'))}</div>`;
  }
}

async function handlePaymentProofSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const orderId = state.trackedOrderId;
  const fileInput = form.querySelector('input[type="file"]');
  if (!orderId || !fileInput?.files?.length) return;

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const formData = new FormData(form);
    await fetchJson(`${API_BASE}/orders/${encodeURIComponent(orderId)}/upload-proof`, {
      method: 'POST',
      body: formData
    });
    await getOrderResult(orderId);
  } catch (error) {
    alert(error.message || 'Gagal mengirim bukti pembayaran.');
    button.disabled = false;
  }
}

async function loadNotifications(userId = 'demo-user-1') {
  const container = document.getElementById('notification-list');
  if (!container) return;

  try {
    const result = await fetchJson(`${API_BASE}/notifications?userId=${encodeURIComponent(userId)}`);
    state.notifications = result.items || [];

    if (!state.notifications.length) {
      container.innerHTML = '<div class="empty-state">Belum ada notifikasi.</div>';
      return;
    }

    container.innerHTML = state.notifications.map((notification) => `
      <article class="notification-card ${notification.is_read ? '' : 'unread'}">
        <strong>${escapeHtml(notification.title)}</strong>
        <p class="card-body">${escapeHtml(notification.message)}</p>
        <small>${new Date(notification.created_at).toLocaleString('id-ID')}</small>
      </article>
    `).join('');
  } catch (error) {
    console.error('Notification fetch failed:', error);
  }
}

async function initAdminPage() {
  const tableBody = document.getElementById('admin-order-table');
  if (!tableBody) return;
  const loginForm = document.getElementById('admin-login-form');
  const loginError = document.getElementById('admin-login-error');
  const dashboard = document.getElementById('admin-dashboard');
  const showLoginError = (message) => {
    loginError.textContent = message;
    loginError.hidden = !message;
  };

  const renderAdminOrders = (orders) => {
    tableBody.innerHTML = orders.length ? orders.map((order) => `
      <tr>
        <td><strong>${escapeHtml(order.id)}</strong><br /><small>${new Date(order.createdAt).toLocaleString('id-ID')}</small></td>
        <td>${escapeHtml(order.customerName)}<br /><small>${escapeHtml(order.customerPhone)}</small></td>
        <td>${escapeHtml(order.gameName)}<br /><small>${escapeHtml(order.variantName)}</small></td>
        <td><strong>${formatRupiah(order.totalAmount)}</strong></td>
        <td><span class="status-pill status-${slugify(order.status)}">${escapeHtml(order.status)}</span></td>
        <td>${escapeHtml(order.note || '-')}</td>
        <td>
          <select class="select" data-order-id="${escapeHtml(order.id)}" data-current-status="${escapeHtml(order.status)}" aria-label="Ubah status pesanan ${escapeHtml(order.id)}">
            ${['Menunggu Pembayaran','Menunggu Verifikasi','Pembayaran Berhasil','Sedang Diproses','Berhasil','Gagal','Dibatalkan','Refund'].map((status) => `
              <option value="${status}" ${status === order.status ? 'selected' : ''}>${status}</option>
            `).join('')}
          </select>
          ${['Gagal', 'Refund', 'Dibatalkan'].includes(order.status) ? `<button class="button button-danger button-small" type="button" data-delete-order="${escapeHtml(order.id)}">Hapus</button>` : ''}
        </td>
      </tr>
    `).join('') : '<tr><td colspan="7"><div class="empty-state">Belum ada pesanan yang cocok.</div></td></tr>';

    tableBody.querySelectorAll('select').forEach((select) => {
      select.addEventListener('change', async (event) => {
        const orderId = event.target.dataset.orderId;
        const nextStatus = event.target.value;
        const previousStatus = event.target.dataset.currentStatus;
        const note = prompt(`Catatan untuk status ${nextStatus}:`, 'Status diperbarui oleh admin.');
        if (note === null) {
          event.target.value = previousStatus;
          return;
        }
        try {
          event.target.disabled = true;
          await fetchJson(`${API_BASE}/admin/orders/${encodeURIComponent(orderId)}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: nextStatus, note: note || 'Status diperbarui oleh admin.' })
          });
          await refreshData();
        } catch (error) {
          alert(getErrorMessage(error, 'Gagal mengubah status pesanan.'));
          event.target.value = previousStatus;
          event.target.disabled = false;
        }
      });
    });
    tableBody.querySelectorAll('[data-delete-order]').forEach((button) => {
      button.addEventListener('click', async () => {
        const orderId = button.dataset.deleteOrder;
        if (!confirm(`Hapus pesanan ${orderId} secara permanen? Riwayat dan bukti pembayarannya juga akan dihapus.`)) return;
        button.disabled = true;
        try {
          await fetchJson(`${API_BASE}/admin/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
          await refreshData();
        } catch (error) {
          alert(getErrorMessage(error, 'Gagal menghapus pesanan.'));
          button.disabled = false;
        }
      });
    });
  };

  const drawRevenueChart = (orders) => {
    const chart = document.getElementById('admin-revenue-chart');
    const labels = document.getElementById('admin-chart-labels');
    if (!chart || !labels) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - index));
      return date;
    });
    const amounts = days.map((day) => orders.reduce((total, order) => {
      const orderDate = new Date(order.createdAt);
      return orderDate.toDateString() === day.toDateString() ? total + Number(order.totalAmount || 0) : total;
    }, 0));
    const max = Math.max(...amounts, 1);
    const points = amounts.map((amount, index) => {
      const x = 8 + (index * 84);
      const y = 110 - ((amount / max) * 90);
      return `${x},${y}`;
    }).join(' ');
    const polygonPoints = `8,118 ${points} 512,118`;

    chart.innerHTML = `
      <svg viewBox="0 0 520 126" role="img" aria-label="Grafik nilai pesanan tujuh hari terakhir">
        <defs>
          <linearGradient id="revenue-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#9865ff" stop-opacity=".38" />
            <stop offset="100%" stop-color="#713cff" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path d="M 8 28 H 512 M 8 72 H 512 M 8 116 H 512" stroke="rgba(174,157,220,.12)" stroke-dasharray="4 6" fill="none" />
        <polygon points="${polygonPoints}" fill="url(#revenue-fill)" />
        <polyline points="${points}" fill="none" stroke="#a57aff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${amounts.map((amount, index) => {
          const x = 8 + (index * 84);
          const y = 110 - ((amount / max) * 90);
          return `<circle cx="${x}" cy="${y}" r="3" fill="#d9c8ff" stroke="#8655fa" stroke-width="2" />`;
        }).join('')}
      </svg>
    `;
    labels.innerHTML = days.map((day) => `<span>${day.toLocaleDateString('id-ID', { weekday: 'short' })}</span>`).join('');
  };

  const renderLatestOrders = (orders) => {
    const container = document.getElementById('admin-latest-orders');
    if (!container) return;
    const latest = orders.slice(0, 4);
    if (!latest.length) {
      container.innerHTML = '<div class="empty-state">Belum ada pesanan masuk.</div>';
      return;
    }
    container.innerHTML = latest.map((order) => `
      <article class="latest-order">
        <span class="latest-order-icon" aria-hidden="true">✦</span>
        <span class="latest-order-detail"><strong>${escapeHtml(order.customerName)} · ${escapeHtml(order.gameName)}</strong><small>${escapeHtml(order.id)} · ${escapeHtml(order.status)}</small></span>
        <span class="latest-order-price">${formatRupiah(order.totalAmount)}</span>
      </article>
    `).join('');
  };

  const setFeatureFeedback = (id, message, success = false) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('success', success);
    element.hidden = !message;
  };

  const renderProductVariants = (variants = [{ key: '', label: '', price: '' }]) => {
    const list = document.getElementById('product-variant-list');
    if (!list) return;
    list.innerHTML = variants.map((variant) => `
      <div class="product-variant-row">
        <input type="hidden" data-variant-key value="${escapeHtml(variant.key || '')}" />
        <label>Nama nominal<input class="input" data-variant-label maxlength="120" placeholder="Contoh: 100 Diamond" value="${escapeHtml(variant.label || '')}" required /></label>
        <label>Harga (Rp)<input class="input" data-variant-price type="number" min="0" step="1" placeholder="15000" value="${escapeHtml(variant.price ?? '')}" required /></label>
        <button class="button button-danger button-small" type="button" data-remove-variant aria-label="Hapus nominal">Hapus</button>
      </div>
    `).join('');
  };
  renderProductVariants();

  const collectProductVariants = () => {
    const rows = [...document.querySelectorAll('#product-variant-list .product-variant-row')];
    if (!rows.length) {
      setFeatureFeedback('product-feedback', 'Tambahkan minimal satu nominal produk.');
      return null;
    }
    const usedKeys = new Set();
    const variants = [];
    for (const [index, row] of rows.entries()) {
      const label = row.querySelector('[data-variant-label]').value.trim();
      const price = Number(row.querySelector('[data-variant-price]').value);
      if (!label || !Number.isSafeInteger(price) || price < 0) {
        setFeatureFeedback('product-feedback', 'Isi nama nominal dan harga Rupiah dengan benar.');
        return null;
      }
      let key = row.querySelector('[data-variant-key]').value.trim();
      if (!key) {
        const base = `nominal-${slugify(label).slice(0, 60) || index + 1}`;
        key = base;
        let suffix = 2;
        while (usedKeys.has(key)) key = `${base}-${suffix++}`;
      }
      if (usedKeys.has(key)) {
        setFeatureFeedback('product-feedback', 'Setiap nominal harus memiliki identitas unik. Hapus lalu tambahkan ulang nominal yang duplikat.');
        return null;
      }
      usedKeys.add(key);
      variants.push({ key, label, price });
    }
    return variants;
  };

  const renderAdminProducts = () => {
    const table = document.getElementById('admin-product-table');
    if (!table) return;
    table.innerHTML = state.adminGames.length ? state.adminGames.map((game) => `
      <tr>
        <td><strong>${escapeHtml(game.name)}</strong><br /><small>${escapeHtml(game.id)}</small></td>
        <td>${escapeHtml(game.category)}</td>
        <td>${game.variants.length}</td>
        <td><span class="status-pill status-${slugify(game.status)}">${escapeHtml(game.status)}</span></td>
        <td><button class="button button-glass button-small" type="button" data-edit-product="${escapeHtml(game.id)}">Edit</button><button class="button button-danger button-small" type="button" data-delete-product="${escapeHtml(game.id)}">Hapus</button></td>
      </tr>
    `).join('') : '<tr><td colspan="5"><div class="empty-state">Belum ada produk.</div></td></tr>';

    table.querySelectorAll('[data-edit-product]').forEach((button) => {
      button.addEventListener('click', () => {
        const game = state.adminGames.find((item) => item.id === button.dataset.editProduct);
        if (!game) return;
        document.getElementById('product-original-id').value = game.id;
        document.getElementById('product-id').value = game.id;
        document.getElementById('product-id').disabled = true;
        document.getElementById('product-name').value = game.name;
        document.getElementById('product-category').value = game.category;
        document.getElementById('product-description').value = game.description || '';
        document.getElementById('product-logo').value = game.logo || '';
        document.getElementById('product-banner').value = game.banner || '';
        document.getElementById('product-status').value = game.status || 'Tersedia';
        renderProductVariants(game.variants);
        document.getElementById('product-featured').checked = Boolean(game.featured);
        document.getElementById('product-bestseller').checked = Boolean(game.bestseller);
        document.getElementById('save-product-button').textContent = 'Simpan perubahan';
        document.getElementById('admin-products').scrollIntoView({ behavior: 'smooth' });
      });
    });
    table.querySelectorAll('[data-delete-product]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!confirm(`Hapus produk ${button.dataset.deleteProduct}? Produk yang memiliki pesanan tidak bisa dihapus.`)) return;
        button.disabled = true;
        try {
          await fetchJson(`${API_BASE}/admin/games/${encodeURIComponent(button.dataset.deleteProduct)}`, { method: 'DELETE' });
          await loadAdminProducts();
        } catch (error) {
          alert(getErrorMessage(error, 'Gagal menghapus produk.'));
          button.disabled = false;
        }
      });
    });
  };

  const loadAdminProducts = async () => {
    const result = await fetchJson(`${API_BASE}/admin/games`);
    state.adminGames = result.items || [];
    renderAdminProducts();
  };

  const loadAdminCategories = async () => {
    const result = await fetchJson(`${API_BASE}/categories`);
    const categories = result.items || [];
    const list = document.getElementById('admin-category-list');
    const options = document.getElementById('admin-category-options');
    if (options) options.innerHTML = categories.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
    if (list) {
      list.innerHTML = categories.map((name) => `
        <div class="admin-category-chip"><span>${escapeHtml(name)}</span><button type="button" class="button button-danger button-small" data-delete-category="${escapeHtml(name)}">Hapus</button></div>
      `).join('') || '<div class="empty-state">Belum ada kategori.</div>';
      list.querySelectorAll('[data-delete-category]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!confirm(`Hapus kategori ${button.dataset.deleteCategory}?`)) return;
          try {
            await fetchJson(`${API_BASE}/admin/categories/${encodeURIComponent(button.dataset.deleteCategory)}`, { method: 'DELETE' });
            await loadAdminCategories();
          } catch (error) {
            setFeatureFeedback('category-feedback', getErrorMessage(error, 'Gagal menghapus kategori.'));
          }
        });
      });
    }
  };

  const loadAdminGallery = async () => {
    const container = document.getElementById('image-gallery');
    if (!container) return;
    const result = await fetchJson(`${API_BASE}/admin/gallery`);
    const images = result.items || [];
    container.innerHTML = images.length ? images.map((image) => `
      <article class="gallery-image-card">
        <img src="${escapeHtml(image.url)}" alt="Gambar ${escapeHtml(image.name)}" loading="lazy" />
        <small>${escapeHtml(image.name)}</small>
        <div><button class="button button-glass button-small" type="button" data-use-logo="${escapeHtml(image.url)}">Jadikan gambar kartu</button><button class="button button-glass button-small" type="button" data-use-banner="${escapeHtml(image.url)}">Jadikan banner produk</button><button class="button button-glass button-small" type="button" data-use-payment="${escapeHtml(image.url)}">Jadikan QR pembayaran</button><button class="button button-glass button-small" type="button" data-use-hero="${escapeHtml(image.url)}">Jadikan banner utama</button></div>
        <button class="button button-danger button-small" type="button" data-delete-image="${escapeHtml(image.name)}">Hapus gambar</button>
      </article>
    `).join('') : '<div class="empty-state">Galeri masih kosong. Upload gambar untuk mulai menggunakannya.</div>';
    container.querySelectorAll('[data-use-logo]').forEach((button) => button.addEventListener('click', () => {
      document.getElementById('product-logo').value = button.dataset.useLogo;
    }));
    container.querySelectorAll('[data-use-banner]').forEach((button) => button.addEventListener('click', () => {
      document.getElementById('product-banner').value = button.dataset.useBanner;
    }));
    container.querySelectorAll('[data-use-payment]').forEach((button) => button.addEventListener('click', () => {
      document.getElementById('payment-method-image').value = button.dataset.usePayment;
      document.getElementById('admin-payments').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    container.querySelectorAll('[data-use-hero]').forEach((button) => button.addEventListener('click', () => {
      document.getElementById('hero-banner-url').value = button.dataset.useHero;
      document.getElementById('hero-banner-url').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    container.querySelectorAll('[data-delete-image]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm(`Hapus gambar ${button.dataset.deleteImage} dari galeri?`)) return;
      try {
        await fetchJson(`${API_BASE}/admin/gallery/${encodeURIComponent(button.dataset.deleteImage)}`, { method: 'DELETE' });
        await loadAdminGallery();
      } catch (error) {
        setFeatureFeedback('gallery-feedback', getErrorMessage(error, 'Gagal menghapus gambar.'));
      }
    }));
  };

  const loadAdminVouchers = async () => {
    const table = document.getElementById('admin-voucher-table');
    if (!table) return;
    const result = await fetchJson(`${API_BASE}/admin/vouchers`);
    const vouchers = result.items || [];
    table.innerHTML = vouchers.length ? vouchers.map((voucher) => `
      <tr>
        <td><strong>${escapeHtml(voucher.code)}</strong></td>
        <td>${voucher.discount_type === 'percent' ? `${voucher.discount_value}%` : formatRupiah(voucher.discount_value)}</td>
        <td>${voucher.uses}${voucher.max_uses ? ` / ${voucher.max_uses}` : ' / ∞'}</td>
        <td>${voucher.starts_at ? `Mulai ${new Date(voucher.starts_at).toLocaleString('id-ID')}<br />` : ''}${voucher.expires_at ? `Sampai ${new Date(voucher.expires_at).toLocaleString('id-ID')}` : 'Tanpa batas'}</td>
        <td>${voucher.active ? 'Aktif' : 'Nonaktif'} · ${voucher.is_public ? 'Publik' : 'Private'}</td>
        <td><button class="button button-glass button-small" type="button" data-edit-voucher="${escapeHtml(voucher.code)}">Edit</button><button class="button button-danger button-small" type="button" data-delete-voucher="${escapeHtml(voucher.code)}">Hapus</button></td>
      </tr>
    `).join('') : '<tr><td colspan="6"><div class="empty-state">Belum ada voucher.</div></td></tr>';
    table.querySelectorAll('[data-edit-voucher]').forEach((button) => button.addEventListener('click', () => {
      const voucher = vouchers.find((item) => item.code === button.dataset.editVoucher);
      if (!voucher) return;
      document.getElementById('voucher-original-code').value = voucher.code;
      document.getElementById('voucher-admin-code').value = voucher.code;
      document.getElementById('voucher-discount-type').value = voucher.discount_type;
      document.getElementById('voucher-discount-value').value = voucher.discount_value;
      document.getElementById('voucher-discount-value').max = voucher.discount_type === 'percent' ? '100' : '';
      document.getElementById('voucher-max-uses').value = voucher.max_uses ?? '';
      document.getElementById('voucher-starts-at').value = toLocalDateTimeInput(voucher.starts_at);
      document.getElementById('voucher-expires-at').value = toLocalDateTimeInput(voucher.expires_at);
      document.getElementById('voucher-active').checked = Boolean(voucher.active);
      document.getElementById('voucher-is-public').checked = Boolean(voucher.is_public);
      document.getElementById('save-voucher-button').textContent = 'Simpan perubahan';
      document.getElementById('admin-vouchers').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    table.querySelectorAll('[data-delete-voucher]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm(`Hapus voucher ${button.dataset.deleteVoucher}?`)) return;
      try {
        await fetchJson(`${API_BASE}/admin/vouchers/${encodeURIComponent(button.dataset.deleteVoucher)}`, { method: 'DELETE' });
        if (document.getElementById('voucher-original-code').value === button.dataset.deleteVoucher) resetVoucherForm();
        setFeatureFeedback('voucher-feedback', 'Voucher berhasil dihapus.', true);
        await loadAdminVouchers();
      } catch (error) {
        setFeatureFeedback('voucher-feedback', getErrorMessage(error, 'Gagal menghapus voucher.'));
      }
    }));
  };

  const loadAdminPaymentMethods = async () => {
    const table = document.getElementById('admin-payment-method-table');
    if (!table) return;
    const result = await fetchJson(`${API_BASE}/admin/payment-methods`);
    const methods = result.items || [];
    table.innerHTML = methods.length ? methods.map((method) => `
      <tr>
        <td><strong>${escapeHtml(method.name)}</strong><br /><small>${escapeHtml(method.id)}</small></td>
        <td>${escapeHtml(method.instructions || 'Belum diisi')}</td>
        <td>${method.image_url ? `<a href="${escapeHtml(method.image_url)}" target="_blank" rel="noreferrer">Lihat gambar ↗</a>` : '—'}</td>
        <td>${method.active ? 'Aktif' : 'Nonaktif'}</td>
        <td><button class="button button-glass button-small" type="button" data-edit-payment="${escapeHtml(method.id)}">Edit</button><button class="button button-danger button-small" type="button" data-delete-payment="${escapeHtml(method.id)}">Hapus</button></td>
      </tr>
    `).join('') : '<tr><td colspan="5"><div class="empty-state">Belum ada metode pembayaran.</div></td></tr>';

    table.querySelectorAll('[data-edit-payment]').forEach((button) => button.addEventListener('click', () => {
      const method = methods.find((item) => item.id === button.dataset.editPayment);
      if (!method) return;
      document.getElementById('payment-method-original-id').value = method.id;
      document.getElementById('payment-method-name').value = method.name;
      document.getElementById('payment-method-instructions').value = method.instructions || '';
      document.getElementById('payment-method-image').value = method.image_url || '';
      document.getElementById('payment-method-order').value = method.sort_order || 0;
      document.getElementById('payment-method-active').checked = Boolean(method.active);
      document.getElementById('save-payment-method').textContent = 'Simpan perubahan';
      document.getElementById('admin-payments').scrollIntoView({ behavior: 'smooth' });
    }));
    table.querySelectorAll('[data-delete-payment]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm(`Hapus metode pembayaran ${button.dataset.deletePayment}?`)) return;
      try {
        await fetchJson(`${API_BASE}/admin/payment-methods/${encodeURIComponent(button.dataset.deletePayment)}`, { method: 'DELETE' });
        await loadAdminPaymentMethods();
      } catch (error) {
        setFeatureFeedback('payment-method-feedback', getErrorMessage(error, 'Gagal menghapus metode pembayaran.'));
      }
    }));
  };

  let siteTextEntries = [];
  const renderSiteTextEntries = (filter = '') => {
    const container = document.getElementById('site-content-list');
    if (!container) return;
    const term = filter.trim().toLowerCase();
    const matches = siteTextEntries.map((entry, index) => ({ ...entry, index }))
      .filter((entry) => !term || entry.sourceText.toLowerCase().includes(term) || entry.replacementText.toLowerCase().includes(term));
    container.innerHTML = matches.length ? matches.map((entry) => `
      <label class="site-text-row"><span>${escapeHtml(entry.sourceText)}</span><textarea class="textarea" rows="2" data-site-text-index="${entry.index}">${escapeHtml(entry.replacementText)}</textarea></label>
    `).join('') : '<div class="empty-state">Tidak ada teks yang cocok.</div>';
    container.querySelectorAll('[data-site-text-index]').forEach((input) => {
      input.addEventListener('input', () => {
        siteTextEntries[Number(input.dataset.siteTextIndex)].replacementText = input.value;
      });
    });
  };

  const scanSiteText = async () => {
    const entries = new Map();
    const frameDocument = document.getElementById('site-content-preview')?.contentDocument;
    [document, frameDocument].filter((page) => page?.body).forEach((page) => {
      [page.title, page.querySelector('meta[name="description"]')?.content].forEach((sourceValue) => {
        const sourceText = getVisibleTextKey(sourceValue);
        if (sourceText.length > 1 && sourceText.length <= 500 && !entries.has(sourceText)) {
          entries.set(sourceText, { sourceText, replacementText: state.siteContent[sourceText] ?? sourceText });
        }
      });
      const walker = page.createTreeWalker(page.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('script,style,noscript,iframe,#admin-content,.game-card,.product-card,#selected-product,#order-result,#admin-order-table,#admin-product-table,#admin-voucher-table,#admin-category-list,#admin-latest-orders')) continue;
        const sourceText = getVisibleTextKey(node.nodeValue);
        if (sourceText.length < 2 || sourceText.length > 500) continue;
        if (!entries.has(sourceText)) entries.set(sourceText, { sourceText, replacementText: state.siteContent[sourceText] ?? sourceText });
      }
      page.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach((element) => {
        if (element.closest('#admin-content,iframe')) return;
        ['placeholder', 'title', 'aria-label', 'alt'].forEach((attribute) => {
          const sourceText = getVisibleTextKey(element.getAttribute(attribute));
          if (sourceText.length > 1 && sourceText.length <= 500 && !entries.has(sourceText)) {
            entries.set(sourceText, { sourceText, replacementText: state.siteContent[sourceText] ?? sourceText });
          }
        });
      });
    });
    siteTextEntries = [...entries.values()].sort((a, b) => a.sourceText.localeCompare(b.sourceText, 'id'));
    renderSiteTextEntries(document.getElementById('site-text-search')?.value || '');
  };

  const loadAdminSiteContent = async () => {
    const [content, settings] = await Promise.all([
      fetchJson(`${API_BASE}/site-content`),
      fetchJson(`${API_BASE}/site-settings`)
    ]);
    state.siteContent = content.items || {};
    applySiteSettings(settings.items || {});
    const heroBannerUrl = document.getElementById('hero-banner-url');
    if (heroBannerUrl) heroBannerUrl.value = state.siteSettings.hero_banner_url || '';
    const frame = document.getElementById('site-content-preview');
    await Promise.all(frame ? [frame].map((item) => item.contentDocument?.readyState === 'complete'
      ? Promise.resolve()
      : new Promise((resolve) => item.addEventListener('load', resolve, { once: true }))) : []);
    window.setTimeout(scanSiteText, 900);
  };

  const loadAdminFeatures = async () => {
    const loaders = [loadAdminProducts, loadAdminCategories, loadAdminGallery, loadAdminVouchers, loadAdminSiteContent, loadAdminPaymentMethods];
    const feedbackIds = ['product-feedback', 'category-feedback', 'gallery-feedback', 'voucher-feedback', 'site-content-feedback', 'payment-method-feedback'];
    await Promise.all(loaders.map(async (loader, index) => {
      try {
        await loader();
      } catch (error) {
        setFeatureFeedback(feedbackIds[index], getErrorMessage(error, 'Gagal memuat fitur admin.'));
      }
    }));
  };

  const resetProductForm = () => {
    document.getElementById('admin-product-form').reset();
    document.getElementById('product-original-id').value = '';
    document.getElementById('product-id').disabled = false;
    renderProductVariants();
    document.getElementById('save-product-button').textContent = 'Simpan produk';
  };

  document.getElementById('add-product-variant')?.addEventListener('click', () => {
    const list = document.getElementById('product-variant-list');
    const variants = [...list.querySelectorAll('.product-variant-row')].map((row) => ({
      key: row.querySelector('[data-variant-key]').value,
      label: row.querySelector('[data-variant-label]').value,
      price: row.querySelector('[data-variant-price]').value
    }));
    variants.push({ key: '', label: '', price: '' });
    renderProductVariants(variants);
    list.lastElementChild?.querySelector('[data-variant-label]')?.focus();
  });
  document.getElementById('product-variant-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-variant]');
    if (!button) return;
    const row = button.closest('.product-variant-row');
    const list = document.getElementById('product-variant-list');
    if (list.querySelectorAll('.product-variant-row').length === 1) {
      setFeatureFeedback('product-feedback', 'Produk harus memiliki minimal satu nominal.');
      return;
    }
    row.remove();
  });

  document.getElementById('admin-product-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const originalId = document.getElementById('product-original-id').value;
    const variants = collectProductVariants();
    if (!variants) return;
    const payload = {
      id: document.getElementById('product-id').value.trim(),
      name: document.getElementById('product-name').value.trim(),
      category: document.getElementById('product-category').value.trim(),
      description: document.getElementById('product-description').value.trim(),
      logo: document.getElementById('product-logo').value.trim(),
      banner: document.getElementById('product-banner').value.trim(),
      status: document.getElementById('product-status').value,
      variants,
      featured: document.getElementById('product-featured').checked,
      bestseller: document.getElementById('product-bestseller').checked
    };
    const button = document.getElementById('save-product-button');
    button.disabled = true;
    try {
      const logoFile = document.getElementById('product-logo-file').files[0];
      const bannerFile = document.getElementById('product-banner-file').files[0];
      if (logoFile) payload.logo = await uploadImageFile(logoFile);
      if (bannerFile) payload.banner = await uploadImageFile(bannerFile);
      const url = originalId ? `${API_BASE}/admin/games/${encodeURIComponent(originalId)}` : `${API_BASE}/admin/games`;
      await fetchJson(url, { method: originalId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      setFeatureFeedback('product-feedback', 'Produk berhasil disimpan.', true);
      resetProductForm();
      await Promise.all([loadAdminProducts(), loadAdminCategories()]);
    } catch (error) {
      setFeatureFeedback('product-feedback', getErrorMessage(error, 'Gagal menyimpan produk.'));
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('reset-product-form')?.addEventListener('click', resetProductForm);

  document.getElementById('gallery-upload-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData();
    const file = document.getElementById('gallery-image').files[0];
    if (!file) return;
    formData.append('image', file);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await fetchJson(`${API_BASE}/admin/gallery`, { method: 'POST', body: formData });
      event.currentTarget.reset();
      setFeatureFeedback('gallery-feedback', 'Gambar berhasil diunggah ke galeri.', true);
      await loadAdminGallery();
    } catch (error) {
      setFeatureFeedback('gallery-feedback', getErrorMessage(error, 'Gagal mengunggah gambar.'));
    } finally {
      button.disabled = false;
    }
  });

  const resetPaymentMethodForm = () => {
    document.getElementById('payment-method-form').reset();
    document.getElementById('payment-method-original-id').value = '';
    document.getElementById('payment-method-order').value = '0';
    document.getElementById('payment-method-active').checked = true;
    document.getElementById('save-payment-method').textContent = 'Simpan metode';
  };
  document.getElementById('reset-payment-method')?.addEventListener('click', resetPaymentMethodForm);
  document.getElementById('payment-method-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const originalId = document.getElementById('payment-method-original-id').value;
    const button = document.getElementById('save-payment-method');
    button.disabled = true;
    try {
      let imageUrl = document.getElementById('payment-method-image').value.trim();
      const imageFile = document.getElementById('payment-method-image-file').files[0];
      if (imageFile) imageUrl = await uploadImageFile(imageFile);
      const payload = {
        name: document.getElementById('payment-method-name').value.trim(),
        instructions: document.getElementById('payment-method-instructions').value.trim(),
        imageUrl,
        sortOrder: Number(document.getElementById('payment-method-order').value),
        active: document.getElementById('payment-method-active').checked
      };
      const endpoint = originalId
        ? `${API_BASE}/admin/payment-methods/${encodeURIComponent(originalId)}`
        : `${API_BASE}/admin/payment-methods`;
      const result = await fetchJson(endpoint, { method: originalId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      setFeatureFeedback('payment-method-feedback', result.message, true);
      resetPaymentMethodForm();
      await Promise.all([loadAdminPaymentMethods(), loadPublicPaymentMethods()]);
    } catch (error) {
      setFeatureFeedback('payment-method-feedback', getErrorMessage(error, 'Gagal menyimpan metode pembayaran.'));
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('admin-password-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPassword = document.getElementById('admin-current-password').value;
    const newPassword = document.getElementById('admin-new-password').value;
    const confirmPassword = document.getElementById('admin-confirm-password').value;
    if (newPassword !== confirmPassword) {
      setFeatureFeedback('admin-password-feedback', 'Konfirmasi kata sandi baru tidak sama.');
      return;
    }
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await fetchJson(`${API_BASE}/admin/change-password`, {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      localStorage.setItem('adminSessionToken', result.token);
      localStorage.setItem('adminUsername', result.username);
      event.currentTarget.reset();
      setFeatureFeedback('admin-password-feedback', result.message, true);
    } catch (error) {
      setFeatureFeedback('admin-password-feedback', getErrorMessage(error, 'Gagal mengubah kata sandi.'));
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('category-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await fetchJson(`${API_BASE}/admin/categories`, {
        method: 'POST',
        body: JSON.stringify({ name: document.getElementById('new-category-name').value.trim() })
      });
      event.currentTarget.reset();
      setFeatureFeedback('category-feedback', 'Kategori berhasil ditambahkan.', true);
      await loadAdminCategories();
    } catch (error) {
      setFeatureFeedback('category-feedback', getErrorMessage(error, 'Gagal menambahkan kategori.'));
    }
  });

  document.getElementById('hero-banner-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await fetchJson(`${API_BASE}/admin/site-settings`, {
        method: 'PATCH',
        body: JSON.stringify({ heroBannerUrl: document.getElementById('hero-banner-url').value.trim() })
      });
      setFeatureFeedback('hero-banner-feedback', result.message, true);
    } catch (error) {
      setFeatureFeedback('hero-banner-feedback', getErrorMessage(error, 'Gagal memperbarui banner utama.'));
    }
  });

  const toLocalDateTimeInput = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const resetVoucherForm = () => {
    document.getElementById('voucher-form').reset();
    document.getElementById('voucher-original-code').value = '';
    document.getElementById('voucher-active').checked = true;
    document.getElementById('voucher-discount-value').max = '100';
    document.getElementById('save-voucher-button').textContent = 'Buat voucher';
  };
  document.getElementById('reset-voucher-form')?.addEventListener('click', resetVoucherForm);
  document.getElementById('voucher-discount-type')?.addEventListener('change', (event) => {
    document.getElementById('voucher-discount-value').max = event.target.value === 'percent' ? '100' : '';
  });
  document.getElementById('voucher-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const originalCode = document.getElementById('voucher-original-code').value;
    const start = document.getElementById('voucher-starts-at').value;
    const expiry = document.getElementById('voucher-expires-at').value;
    const button = document.getElementById('save-voucher-button');
    button.disabled = true;
    try {
      const result = await fetchJson(originalCode
        ? `${API_BASE}/admin/vouchers/${encodeURIComponent(originalCode)}`
        : `${API_BASE}/admin/vouchers`, {
        method: originalCode ? 'PUT' : 'POST',
        body: JSON.stringify({
          code: document.getElementById('voucher-admin-code').value.trim().toUpperCase(),
          discountType: document.getElementById('voucher-discount-type').value,
          discountValue: Number(document.getElementById('voucher-discount-value').value),
          maxUses: document.getElementById('voucher-max-uses').value || null,
          startsAt: start ? new Date(start).toISOString() : null,
          expiresAt: expiry ? new Date(expiry).toISOString() : null,
          active: document.getElementById('voucher-active').checked,
          isPublic: document.getElementById('voucher-is-public').checked
        })
      });
      resetVoucherForm();
      setFeatureFeedback('voucher-feedback', result.message || 'Voucher berhasil disimpan.', true);
      await loadAdminVouchers();
    } catch (error) {
      setFeatureFeedback('voucher-feedback', getErrorMessage(error, 'Gagal menyimpan voucher.'));
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('site-text-search')?.addEventListener('input', (event) => renderSiteTextEntries(event.target.value));
  document.getElementById('save-site-content')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const items = siteTextEntries
      .filter((entry) => entry.replacementText !== entry.sourceText || state.siteContent[entry.sourceText] !== undefined)
      .map((entry) => ({
        sourceText: entry.sourceText,
        replacementText: entry.replacementText === entry.sourceText ? '' : entry.replacementText
      }));
    button.disabled = true;
    try {
      const result = await fetchJson(`${API_BASE}/admin/content`, { method: 'PATCH', body: JSON.stringify({ items }) });
      state.siteContent = Object.fromEntries(items.filter((item) => item.replacementText).map((item) => [item.sourceText, item.replacementText]));
      await scanSiteText();
      setFeatureFeedback('site-content-feedback', result.message || 'Perubahan teks tersimpan.', true);
    } catch (error) {
      setFeatureFeedback('site-content-feedback', getErrorMessage(error, 'Gagal menyimpan teks website.'));
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('export-orders')?.addEventListener('click', () => {
    const headers = ['ID Pesanan', 'Tanggal', 'Pelanggan', 'Email', 'Telepon', 'Game', 'Nominal', 'Total', 'Status'];
    const rows = state.adminOrders.map((order) => [
      order.id, order.createdAt, order.customerName, order.customerEmail, order.customerPhone,
      order.gameName, order.variantName, order.totalAmount, order.status
    ]);
    const csv = [headers, ...rows].map((row) => row.map((value) => {
      const text = String(value ?? '');
      const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safeText.replace(/"/g, '""')}"`;
    }).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `pesanan-kris-diamond-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  const refreshData = async () => {
    try {
      const result = await fetchJson(`${API_BASE}/admin/orders`);
      const orders = result.items || [];
      state.adminOrders = orders;
      showLoginError('');
      loginForm.hidden = true;
      dashboard.hidden = false;
      const searchTerm = (document.getElementById('admin-order-search')?.value || '').trim().toLowerCase();
      const filteredOrders = orders.filter((order) =>
        `${order.id} ${order.customerName} ${order.customerPhone} ${order.gameName}`.toLowerCase().includes(searchTerm)
      );
      renderAdminOrders(filteredOrders);

      document.getElementById('stat-orders').textContent = orders.length;
      const pendingCount = orders.filter((x) => x.status === 'Menunggu Pembayaran' || x.status === 'Menunggu Verifikasi').length;
      document.getElementById('stat-pending').textContent = pendingCount;
      document.getElementById('stat-processed').textContent = orders.filter((x) => x.status === 'Pembayaran Berhasil' || x.status === 'Sedang Diproses').length;
      document.getElementById('stat-success').textContent = orders.filter((x) => x.status === 'Berhasil').length;
      document.getElementById('admin-pending-badge').textContent = pendingCount;
      document.getElementById('stat-revenue').textContent = formatRupiah(orders.reduce((total, order) => total + Number(order.totalAmount || 0), 0));
      renderLatestOrders(orders);
      drawRevenueChart(orders);
      await loadAdminFeatures();
    } catch (error) {
      console.error('Admin fetch error:', error);
      if (!localStorage.getItem('adminSessionToken') || error.message.includes('Sesi admin tidak valid')) {
        localStorage.removeItem('adminSessionToken');
        localStorage.removeItem('adminUsername');
        loginForm.hidden = false;
        dashboard.hidden = true;
        showLoginError(error.message);
      } else {
        loginForm.hidden = false;
        dashboard.hidden = true;
        showLoginError(error.message || 'Gagal memuat data admin.');
      }
    }
  };

  const adminUsernameInput = document.getElementById('admin-username');
  const adminPasswordInput = document.getElementById('admin-password');
  const signIn = async (username, password) => {
    const result = await fetchJson(`${API_BASE}/admin/login`, {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    localStorage.setItem('adminSessionToken', result.token);
    localStorage.setItem('adminUsername', result.username);
    await refreshData();
  };
  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showLoginError('');
    try {
      await signIn(adminUsernameInput.value, adminPasswordInput.value);
      loginForm.reset();
    } catch (error) {
      showLoginError(getErrorMessage(error, 'Gagal login admin.'));
    }
  });
  document.getElementById('refresh-admin-data')?.addEventListener('click', refreshData);
  document.getElementById('admin-top-search')?.addEventListener('input', (event) => {
    const orderSearch = document.getElementById('admin-order-search');
    if (!orderSearch) return;
    orderSearch.value = event.target.value;
    orderSearch.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.getElementById('admin-order-search')?.addEventListener('input', () => {
    if (!dashboard.hidden) {
      const searchTerm = document.getElementById('admin-order-search').value.trim().toLowerCase();
      const topSearch = document.getElementById('admin-top-search');
      if (topSearch && topSearch.value !== document.getElementById('admin-order-search').value) {
        topSearch.value = document.getElementById('admin-order-search').value;
      }
      renderAdminOrders(state.adminOrders.filter((order) =>
        `${order.id} ${order.customerName} ${order.customerPhone} ${order.gameName}`.toLowerCase().includes(searchTerm)
      ));
    }
  });
  document.getElementById('admin-logout')?.addEventListener('click', () => {
    localStorage.removeItem('adminSessionToken');
    localStorage.removeItem('adminUsername');
    loginForm.hidden = false;
    dashboard.hidden = true;
  });
  if (!new URLSearchParams(window.location.search).has('copy-scan')) {
    if (localStorage.getItem('adminSessionToken')) {
      await refreshData();
    } else {
      const legacyUsername = sessionStorage.getItem('adminUsername');
      const legacyPassword = sessionStorage.getItem('adminPassword');
      if (legacyUsername && legacyPassword) {
        sessionStorage.removeItem('adminUsername');
        sessionStorage.removeItem('adminPassword');
        try {
          await signIn(legacyUsername, legacyPassword);
        } catch (error) {
          showLoginError(getErrorMessage(error, 'Sesi login admin perlu diperbarui.'));
        }
      }
    }
  }
}

function setupHomePage() {
  if (!new URLSearchParams(window.location.search).has('copy-scan')) {
    loadSiteContentOverrides();
  }

  const form = document.getElementById('checkout-form');
  if (form) form.addEventListener('submit', handleCheckoutSubmit);
  loadPublicPaymentMethods();
  document.addEventListener('submit', (event) => {
    if (event.target.id === 'payment-proof-form') handlePaymentProofSubmit(event);
  });

  const orderButton = document.getElementById('check-order-button');
  if (orderButton) {
    orderButton.addEventListener('click', () => getOrderResult(document.getElementById('order-id-input').value.trim()));
  }

  const openOrderCheckButton = document.getElementById('open-order-check');
  if (openOrderCheckButton) {
    openOrderCheckButton.addEventListener('click', () => {
      document.getElementById('order-id-input')?.focus();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  const shopButton = document.getElementById('go-shop');
  if (shopButton) {
    shopButton.addEventListener('click', () => {
      document.getElementById('produk')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  document.getElementById('cta-shop')?.addEventListener('click', () => {
    document.getElementById('produk')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('cta-check-order')?.addEventListener('click', () => {
    document.getElementById('order-id-input')?.focus();
  });

  const searchInput = document.getElementById('search-input');
  const categoryFilter = document.getElementById('category-filter');
  const sortFilter = document.getElementById('sort-filter');
  const applyButton = document.getElementById('apply-filter');

  if (searchInput) {
    searchInput.addEventListener('input', renderCatalog);
  }

  if (applyButton) {
    applyButton.addEventListener('click', renderCatalog);
  }

  [categoryFilter, sortFilter].forEach((element) => {
    element?.addEventListener('change', renderCatalog);
  });

  const voucherInput = document.getElementById('voucher-code');
  let voucherValidationTimer;
  voucherInput?.addEventListener('input', () => {
    window.clearTimeout(voucherValidationTimer);
    voucherValidationTimer = window.setTimeout(updateCheckoutSummary, 250);
  });
  document.getElementById('payment-method')?.addEventListener('change', renderPaymentMethodPreview);

  const headerSearch = document.getElementById('header-search');
  const catalogSearch = document.getElementById('search-input');
  const syncSearch = (source, target) => {
    source?.addEventListener('input', () => {
      if (target) target.value = source.value;
      renderCatalog();
    });
  };
  syncSearch(headerSearch, catalogSearch);
  syncSearch(catalogSearch, headerSearch);

  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const mainNav = document.querySelector('.main-nav');
  mobileMenuToggle?.addEventListener('click', () => {
    if (!mainNav) return;
    const isOpen = mainNav.classList.toggle('open');
    mobileMenuToggle.setAttribute('aria-expanded', String(isOpen));
    mobileMenuToggle.setAttribute('aria-label', isOpen ? 'Tutup navigasi' : 'Buka navigasi');
  });
  mainNav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mainNav.classList.remove('open');
      mobileMenuToggle?.setAttribute('aria-expanded', 'false');
    });
  });

  document.getElementById('contact-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = document.getElementById('contact-feedback');
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    feedback.hidden = true;
    feedback.classList.remove('success');
    try {
      const formData = new FormData(form);
      await fetchJson(`${API_BASE}/contact`, {
        method: 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          message: formData.get('message')
        })
      });
      feedback.textContent = 'Pesan berhasil dikirim. Tim kami akan segera menghubungi Anda.';
      feedback.classList.add('success');
      feedback.hidden = false;
      form.reset();
    } catch (error) {
      feedback.textContent = getErrorMessage(error, 'Pesan gagal dikirim. Silakan coba kembali.');
      feedback.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

}

function init() {
  const isCopyScan = new URLSearchParams(window.location.search).has('copy-scan');
  if (getPageMode() === 'admin') {
    if (!isCopyScan) loadSiteContentOverrides();
    initAdminPage();
  } else {
    setupHomePage();
    loadPublicVouchers();
    loadGames();
  }
}

document.addEventListener('DOMContentLoaded', init);
