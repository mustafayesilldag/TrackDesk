// Tanıtım önizlemesi gerçek panelden tamamen izole bir storage anahtarı
// kullanır — böylece cache'lenmiş gerçek müşteri verisi önizlemeye sızmaz ve
// önizleme her zaman temiz seed veriyle başlar.
// Tetikleyiciler: (1) ?preview=1 (tam ekran "Demoyu Dene"), (2) panel bir
// iframe içinde gömülüyse (showcase çerçeveleri) — query string sunucu
// yönlendirmesinde düşse bile gömülü önizleme demo modunda kalır.
function detectPreviewMode() {
  if (new URLSearchParams(window.location.search).has("preview")) return true;
  try { if (window.self !== window.top) return true; } catch (error) { return true; }
  try { return sessionStorage.getItem("trackdesk-demo-access") === "1"; } catch (error) { return false; }
}
const IS_PREVIEW_MODE = detectPreviewMode();
const STORAGE_KEY = IS_PREVIEW_MODE ? "trackdesk-preview-v1" : "trackdesk-demo-v1";

// Preview modunda marka ayarları sabit başlangıç noktasına dönsün: her
// sayfa yüklemesinde önce temizle. Oturum içinde normal çalışır (değişiklikler
// anında görünür), bir sonraki F5'te tekrar sıfırlanır.
if (IS_PREVIEW_MODE) {
  try {
    localStorage.removeItem("trackdesk-brand-v1");
  } catch (error) { /* localStorage yoksa zaten kalıcı değil */ }
}

function initTopbarHandle() {
  const handle = document.getElementById("topbar-handle");
  const topbar = document.getElementById("topbar");

  handle?.addEventListener("click", () => topbar?.classList.toggle("open"));

  document.addEventListener("click", (e) => {
    if (topbar?.classList.contains("open") &&
        !topbar.contains(e.target) &&
        !handle?.contains(e.target)) {
      topbar.classList.remove("open");
    }
  });
}

const NOTIFICATION_STORAGE_KEY = "trackdesk-notified-v1";
const RECENT_CUSTOMERS_STORAGE_KEY = "trackdesk-recent-v1";
const AUTH_TOKEN_STORAGE_KEY = "trackdesk-auth-token";
const BRAND_STORAGE_KEY = "trackdesk-brand-v1";
const API_SYNC_INTERVAL_MS = 5000;

function resolveApiBaseUrl() {
  // Tanıtım sitesindeki canlı önizleme (showcase iframe veya "Demoyu Dene"):
  // ?preview=1 ile açılınca backend devre dışı kalır, panel her zaman demo
  // modunda (seed veri) görünür — hosting'de bile giriş ekranı çıkmaz.
  if (IS_PREVIEW_MODE) return "";
  if (window.location.protocol === "file:") return "";
  return new URL("./backend/api/", window.location.href).toString();
}
const API_BASE_URL = resolveApiBaseUrl();
const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const getTodayDateInput = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const TODAY = getTodayDateInput();
const DEFERRED_PAYMENT_DAYS = 15;
const IMPORT_CUSTOMER_LIMIT = 50;
const DEFAULT_PRODUCT_CATALOG = [
  {
    brand: "Standart Seri",
    products: [
      "S-100 Standart Paket",
      "S-200 Ekonomik Paket",
      "S-500 Toplu Paket",
      "S-1000 Endüstriyel Paket",
    ],
  },
  {
    brand: "Premium Seri",
    products: [
      "P-50 Premium Mini",
      "P-100 Premium Standart",
      "P-250 Premium Plus",
      "P-500 Premium Endüstriyel",
    ],
  },
  {
    brand: "Hizmetler",
    products: [
      "Kurulum ve Montaj",
      "Periyodik Bakım",
      "Teknik Danışmanlık",
      "Acil Servis",
      "Özel Tasarım",
    ],
  },
];

function isValidDateParts(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function normalizeDateInput(value, fallback = TODAY) {
  const raw = String(value || "").trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const dottedMatch = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);

  if (isoMatch) {
    const [, yearText, monthText, dayText] = isoMatch;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (year > 0 && isValidDateParts(year, month, day)) {
      return `${String(year).padStart(4, "0")}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
    }
  }

  if (dottedMatch) {
    const [, dayText, monthText, yearText] = dottedMatch;
    const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (year > 0 && isValidDateParts(year, month, day)) {
      return `${String(year).padStart(4, "0")}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
    }
  }

  if (fallback === "") return "";
  return DATE_INPUT_PATTERN.test(String(fallback || "")) ? fallback : TODAY;
}

function toLocalDate(dateText) {
  const normalized = normalizeDateInput(dateText);
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return TODAY;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TOAST_ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
const TOAST_DURATIONS = { success: 3000, error: 5000, warning: 4000, info: 4000 };

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const existing = container.querySelectorAll('.toast');
  if (existing.length >= 3) existing[0].remove();

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${TOAST_ICONS[type] || TOAST_ICONS.info}</span><span class="toast-message">${escapeHtml(String(message))}</span><button type="button" class="toast-close" aria-label="Kapat">✕</button>`;

  const dismiss = () => {
    if (!toast.parentNode) return;
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 200);
  };

  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  container.appendChild(toast);
  const timer = setTimeout(dismiss, TOAST_DURATIONS[type] || 4000);
  toast.addEventListener('mouseenter', () => clearTimeout(timer), { once: true });
}

const ES_ICONS = {
  check:       `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  checkCircle: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  clipboard:   `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`,
  calendar:    `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  banknote:    `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
  file:        `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  search:      `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  arrowLeft:   `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  chart:       `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  box:         `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
};

// Tarayıcının düz "localhost diyor ki" kutusu yerine panelin kendi onay penceresi.
// Dialog'un "close" olayına güvenilmez (bazı gömülü tarayıcılarda tetiklenmiyor);
// cevap doğrudan buton tıklaması ve Esc tuşundan alınır.
function confirmAction(message, { confirmLabel = "Evet, sil" } = {}) {
  const dialog = document.querySelector("#confirm-dialog");
  if (!dialog?.showModal) return Promise.resolve(window.confirm(message));
  const acceptButton = dialog.querySelector("#confirm-dialog-accept");
  const cancelButton = dialog.querySelector("#confirm-dialog-cancel");
  dialog.querySelector("#confirm-dialog-message").textContent = message;
  acceptButton.textContent = confirmLabel;

  return new Promise((resolve) => {
    const finish = (approved) => {
      acceptButton.removeEventListener("click", onAccept);
      cancelButton.removeEventListener("click", onCancel);
      dialog.removeEventListener("keydown", onKeydown);
      if (dialog.open) dialog.close();
      resolve(approved);
    };
    const onAccept = () => finish(true);
    const onCancel = () => finish(false);
    const onKeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(false);
    };
    acceptButton.addEventListener("click", onAccept);
    cancelButton.addEventListener("click", onCancel);
    dialog.addEventListener("keydown", onKeydown);
    dialog.showModal();
    cancelButton.focus();
  });
}

function makeEmptyState(icon, title, hint) {
  return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><span class="empty-title">${title}</span>${hint ? `<span class="empty-hint">${hint}</span>` : ''}</div>`;
}

function daysAgo(days) {
  const date = toLocalDate(TODAY);
  date.setDate(date.getDate() - days);
  return toDateInput(date);
}

function addDaysToDateText(dateText, days) {
  const date = toLocalDate(dateText || TODAY);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

function getDeferredDueDate(dateText, planValue) {
  const days = Number(planValue) || 0;
  return days > 0 ? addDaysToDateText(dateText, days) : "";
}

function getEffectivePaymentDueDate(dateText, planValue, dueDateValue) {
  return normalizeDateInput(dueDateValue, "") || getDeferredDueDate(dateText, planValue);
}


function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}


const initialData = {
  catalog: DEFAULT_PRODUCT_CATALOG,
  customers: [],
};

function normalizeStage(stage) {
  return ["created", "editing", "delivered"].includes(stage) ? stage : "created";
}

function cloneCatalog(catalog = DEFAULT_PRODUCT_CATALOG) {
  return catalog.map((group) => ({
    brand: String(group.brand || "").trim(),
    products: Array.isArray(group.products) ? [...group.products] : [],
  }));
}

function normalizeCatalog(catalog) {
  const source = Array.isArray(catalog) && catalog.length ? catalog : DEFAULT_PRODUCT_CATALOG;
  return cloneCatalog(source)
    .map((group) => ({
      brand: group.brand,
      products: [...new Set(group.products.map((product) => String(product || "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "tr")
      ),
    }))
    .filter((group) => group.brand)
    .sort((a, b) => a.brand.localeCompare(b.brand, "tr"));
}

function normalizeItems(items, legacyProduct, legacyQuantity) {
  const source = Array.isArray(items) && items.length ? items : legacyProduct ? [{ product: legacyProduct, quantity: legacyQuantity }] : [];
  return source
    .map((item) => ({
      product: String(item.product || "").trim(),
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
    }))
    .filter((item) => item.product && item.quantity > 0);
}

function normalizeCollections(collections, paid = 0, date = TODAY) {
  const fallbackDate = normalizeDateInput(date);
  const source = Array.isArray(collections)
    ? collections
    : Number(paid) > 0
      ? [{ date: fallbackDate, amount: Number(paid), note: "" }]
      : [];

  return source
    .map((collection) => ({
      id: collection.id || crypto.randomUUID(),
      date: normalizeDateInput(collection.date, fallbackDate),
      amount: Number(collection.amount) || 0,
      note: String(collection.note || "").trim(),
    }))
    .filter((collection) => collection.amount >= 0);
}

function normalizeRolloverCollections(collections, fallbackCollected = 0, fallbackDate = "", fallbackNote = "") {
  const normalizedFallbackDate = normalizeDateInput(fallbackDate, TODAY);
  const source = Array.isArray(collections)
    ? collections
    : Number(fallbackCollected) > 0
      ? [{ date: normalizedFallbackDate, amount: Number(fallbackCollected), note: fallbackNote }]
      : [];

  return source
    .map((collection) => ({
      id: collection.id || crypto.randomUUID(),
      date: normalizeDateInput(collection.date, normalizedFallbackDate),
      amount: Number(collection.amount) || 0,
      note: String(collection.note || fallbackNote || "").trim(),
    }))
    .filter((collection) => collection.amount > 0);
}

function getCollectionTotal(collections) {
  return (Array.isArray(collections) ? collections : []).reduce((sum, collection) => sum + (Number(collection.amount) || 0), 0);
}

function reconcileCollections(existingCollections, desiredTotal, movementDate, noteText = "Düzenleme tahsilat farkı") {
  const normalizedExisting = normalizeCollections(existingCollections, 0, movementDate).map((collection) => ({ ...collection }));
  const safeDesiredTotal = Math.max(Number(desiredTotal) || 0, 0);
  const currentTotal = getCollectionTotal(normalizedExisting);

  if (safeDesiredTotal === currentTotal) return normalizedExisting;

  if (safeDesiredTotal > currentTotal) {
    normalizedExisting.push({
      id: crypto.randomUUID(),
      date: normalizeDateInput(movementDate),
      amount: Number((safeDesiredTotal - currentTotal).toFixed(2)),
      note: noteText,
    });
    return normalizedExisting;
  }

  let remainderToRemove = Number((currentTotal - safeDesiredTotal).toFixed(2));
  const nextCollections = [...normalizedExisting];

  for (let index = nextCollections.length - 1; index >= 0 && remainderToRemove > 0; index -= 1) {
    const currentAmount = Number(nextCollections[index].amount) || 0;
    if (currentAmount <= remainderToRemove) {
      remainderToRemove = Number((remainderToRemove - currentAmount).toFixed(2));
      nextCollections.splice(index, 1);
      continue;
    }

    nextCollections[index] = {
      ...nextCollections[index],
      amount: Number((currentAmount - remainderToRemove).toFixed(2)),
      note: nextCollections[index].note || noteText,
    };
    remainderToRemove = 0;
  }

  return nextCollections.filter((collection) => (Number(collection.amount) || 0) > 0);
}

function normalizeRollovers(rollovers) {
  return (Array.isArray(rollovers) ? rollovers : [])
    .map((rollover) => ({
      id: rollover.id || crypto.randomUUID(),
      sourceYear: String(rollover.sourceYear || "").slice(0, 4),
      targetYear: String(rollover.targetYear || "").slice(0, 4),
      amount: Number(rollover.amount) || 0,
      collectionMovements: normalizeRolloverCollections(
        rollover.collectionMovements,
        rollover.collected,
        rollover.collectedAt,
        rollover.note
      ),
      note: String(rollover.note || "").trim(),
      createdAt: rollover.createdAt || new Date().toISOString(),
    }))
    .filter((rollover) => rollover.sourceYear && rollover.targetYear && rollover.sourceYear !== rollover.targetYear && rollover.amount > 0)
    .map((rollover) => {
      const collected = Math.max(Math.min(getCollectionTotal(rollover.collectionMovements), Number(rollover.amount) || 0), 0);
      const latestCollectionDate = [...rollover.collectionMovements]
        .map((collection) => collection.date)
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a))[0] || "";

      return {
        ...rollover,
        collected,
        collectedAt: latestCollectionDate,
      };
    })
    .sort((a, b) => a.sourceYear.localeCompare(b.sourceYear) || a.targetYear.localeCompare(b.targetYear));
}

function createTransaction({ id, date, product, quantity, items, amount, paid, stage, note, collections, paymentDueDate }) {
  const transactionDate = normalizeDateInput(date);
  const normalizedItems = normalizeItems(items, product, quantity);
  const normalizedCollections = normalizeCollections(collections, paid, transactionDate);
  const paidTotal = normalizedCollections.reduce((sum, collection) => sum + collection.amount, 0);
  const itemsTotal = normalizedItems.reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0), 0);
  const parsedAmount = itemsTotal > 0 ? itemsTotal : (Number(amount) || 0);
  const normalizedStage = normalizeStage(stage);

  return {
    id: id || crypto.randomUUID(),
    date: transactionDate,
    items: normalizedItems,
    productSummary: normalizedItems.map((item) => `${item.product} x ${item.quantity}`).join(", "),
    quantity: normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
    amount: parsedAmount,
    paid: paidTotal,
    collections: normalizedCollections,
    stage: normalizedStage,
    delivered: normalizedStage === "delivered",
    fullyPaid: paidTotal >= parsedAmount && parsedAmount > 0,
    paymentDueDate: normalizeDateInput(paymentDueDate, ""),
    note: String(note || "").trim(),
  };
}

function hydrateState(data) {
  const customers = Array.isArray(data?.customers) ? data.customers : initialData.customers;
  return {
    catalog: normalizeCatalog(data?.catalog),
    customers: customers.map((customer) => ({
      ...customer,
      rollovers: normalizeRollovers(customer.rollovers),
      ledgerEntries: Array.isArray(customer.ledgerEntries) ? customer.ledgerEntries.map(normalizeLedgerEntry) : [],
      transactions: Array.isArray(customer.transactions)
        ? customer.transactions.map((transaction) =>
            createTransaction({
              ...transaction,
              stage:
                transaction.stage ||
                (transaction.delivered ? "delivered" : transaction.note ? "editing" : "created"),
            })
          )
        : [],
    })),
  };
}

function loadState() {
  if (IS_PREVIEW_MODE) {
    return hydrateState(window.TRACKDESK_SEED_STATE || { catalog: DEFAULT_PRODUCT_CATALOG, customers: [] });
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = API_BASE_URL
      ? { catalog: DEFAULT_PRODUCT_CATALOG, customers: [] }
      : (window.TRACKDESK_SEED_STATE || { catalog: DEFAULT_PRODUCT_CATALOG, customers: [] });
    const hydrated = hydrateState(seed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
    return hydrated;
  }

  try {
    return hydrateState(JSON.parse(raw));
  } catch (error) {
    console.error("Kayıt okunamadı", error);
  }

  return hydrateState({ catalog: DEFAULT_PRODUCT_CATALOG, customers: [] });
}

let state = loadState();
let selectedCustomerId = state.customers[0]?.id ?? null;
let activeHistoryFilter = "today";
let activeDailyFilter = "today";
let activeSummaryYear = TODAY.slice(0, 4);
let apiCatalogRecords = [];
let apiProductLookup = new Map();
let isSyncingState = false;
let syncIntervalId = null;
let activeUser = null;
let customerPickerMode = "quick";
const openAddCustomerDialogButton = document.querySelector("#open-add-customer-dialog");
const openEditCustomerDialogButton = document.querySelector("#open-edit-customer-dialog");
const searchInput = document.querySelector("#search-input");
const letterFilter = document.querySelector("#letter-filter");
const quickTransactionForm = document.querySelector("#quick-transaction-form");
const quickCustomerSelect = document.querySelector("#quick-customer");
const quickCustomerIdInput = document.querySelector("#quick-customer-id");
const openCustomerPickerButton = document.querySelector("#open-customer-picker");
const customerPickerDialog = document.querySelector("#customer-picker-dialog");
const closeCustomerPickerDialogButton = document.querySelector("#close-customer-picker-dialog");
const customerPickerSearchInput = document.querySelector("#customer-picker-search");
const customerPickerResults = document.querySelector("#customer-picker-results");
const customerAddDialog = document.querySelector("#customer-add-dialog");
const customerAddForm = document.querySelector("#customer-add-form");
const closeCustomerAddDialogButton = document.querySelector("#close-customer-add-dialog");
const customerAddNameInput = document.querySelector("#customer-add-name");
const customerAddContactPersonInput = document.querySelector("#customer-add-contact-person");
const customerAddPhoneInput = document.querySelector("#customer-add-phone");
const customerAddTaxNumberInput = document.querySelector("#customer-add-tax-number");
const customerAddAddressInput = document.querySelector("#customer-add-address");
const customerAddNoteInput = document.querySelector("#customer-add-note");
const customerEditorDialog = document.querySelector("#customer-editor-dialog");
const customerEditorForm = document.querySelector("#customer-editor-form");
const closeCustomerEditorDialogButton = document.querySelector("#close-customer-editor-dialog");
const customerEditorIdInput = document.querySelector("#customer-editor-id");
const customerEditorPickerNameInput = document.querySelector("#customer-editor-picker-name");
const openCustomerEditorPickerButton = document.querySelector("#open-customer-editor-picker");
const customerEditorNameInput = document.querySelector("#customer-editor-name");
const customerEditorContactPersonInput = document.querySelector("#customer-editor-contact-person");
const customerEditorPhoneInput = document.querySelector("#customer-editor-phone");
const customerEditorTaxNumberInput = document.querySelector("#customer-editor-tax-number");
const customerEditorAddressInput = document.querySelector("#customer-editor-address");
const customerEditorNoteInput = document.querySelector("#customer-editor-note");
const quickRecentCustomers = document.querySelector("#quick-recent-customers");
const quickDateInput = document.querySelector("#quick-date");
const quickPaymentPlanSelect = document.querySelector("#quick-payment-plan");
const quickDueDateInput = document.querySelector("#quick-due-date");
const quickAmountInput = document.querySelector("#quick-amount");
const quickPaidInput = document.querySelector("#quick-paid");
const quickNoteInput = document.querySelector("#quick-note");
const quickProductRows = document.querySelector("#quick-product-rows");
const quickAddProductRowButton = document.querySelector("#quick-add-product-row");
const enableNotificationsButton = document.querySelector("#enable-notifications-button");
const customerList = document.querySelector("#customer-list");
const customerCount = document.querySelector("#customer-count");
const summaryCards = document.querySelector("#summary-cards");
const summaryYearFilter = document.querySelector("#summary-year-filter");
const controlCenterStats = document.querySelector("#control-center-stats");
const debtWatchList = document.querySelector("#debt-watch-list");
const urgentWatchList = document.querySelector("#urgent-watch-list");
const detailName = document.querySelector("#detail-name");
const detailOverview = document.querySelector("#detail-overview");
const customerLedger = document.querySelector("#customer-ledger");
const customerRollovers = document.querySelector("#customer-rollovers");
const customerClosedRollovers = document.querySelector("#customer-closed-rollovers");
const customerCollections = document.querySelector("#customer-collections");
const customerHistory = document.querySelector("#customer-history");
const globalHistory = document.querySelector("#global-history");
const historyFilterButtons = [...document.querySelectorAll("[data-history-filter]")];
const dailyFilterButtons = [...document.querySelectorAll("[data-daily-filter]")];
const dailyOperationsList = document.querySelector("#daily-operations-list");
const todayTransactionList = document.querySelector("#today-transaction-list");
const futureTransactionList = document.querySelector("#future-transaction-list");
const transactionList = document.querySelector("#transaction-list");
const quickOrderButton = document.querySelector("#quick-order-button");
const reportCutoffDateInput = document.querySelector("#report-cutoff-date");
const printCustomerReportButton = document.querySelector("#print-customer-report");
const downloadCustomerReportButton = document.querySelector("#download-customer-report");
const deleteCustomerButton = document.querySelector("#delete-customer-button");
const transactionDialog = document.querySelector("#transaction-dialog");
const closeDialogButton = document.querySelector("#close-dialog");
const transactionForm = document.querySelector("#transaction-form");
const collectionDialog = document.querySelector("#collection-dialog");
const collectionForm = document.querySelector("#collection-form");
const closeCollectionDialogButton = document.querySelector("#close-collection-dialog");
const collectionTransactionIdInput = document.querySelector("#collection-transaction-id");
const collectionTitle = document.querySelector("#collection-title");
const collectionSummaryChip = document.querySelector("#collection-summary-chip");
const collectionAmountInput = document.querySelector("#collection-amount");
const collectionNoteInput = document.querySelector("#collection-note");
const markDeliveredWithoutPaymentButton = document.querySelector("#mark-delivered-without-payment");
const quickCollectButtons = [...document.querySelectorAll(".quick-collect-button")];
const dialogTitle = document.querySelector("#dialog-title");
const todayLabel = document.querySelector("#today-label");
const transactionIdInput = document.querySelector("#transaction-id");
const transactionDateInput = document.querySelector("#transaction-date");
const transactionPaymentPlanSelect = document.querySelector("#transaction-payment-plan");
const transactionDueDateInput = document.querySelector("#transaction-due-date");
const dialogDateChip = document.querySelector("#dialog-date-chip");
const saveTransactionButton = document.querySelector("#save-transaction-button");
const transactionStageInput = document.querySelector("#transaction-stage");
const productRows = document.querySelector("#product-rows");
const addProductRowButton = document.querySelector("#add-product-row");
const amountInput = document.querySelector("#transaction-amount");
const paidInput = document.querySelector("#transaction-paid");
const noteInput = document.querySelector("#transaction-note");
const catalogDialog = document.querySelector("#catalog-dialog");
const openCatalogDialogButton = document.querySelector("#open-catalog-dialog");
const closeCatalogDialogButton = document.querySelector("#close-catalog-dialog");
const openSettingsDialogButton = document.querySelector("#open-settings-dialog");
const settingsDialog = document.querySelector("#settings-dialog");
const closeSettingsDialogButton = document.querySelector("#close-settings-dialog");
const businessNameInput = document.querySelector("#brand-name-input");
const brandLogoPreview = document.querySelector("#brand-logo-preview");
const brandLogoUploadButton = document.querySelector("#brand-logo-upload-button");
const brandLogoRemoveButton = document.querySelector("#brand-logo-remove-button");
const brandLogoInput = document.querySelector("#brand-logo-input");
const brandResetButton = document.querySelector("#brand-reset-button");
const customerActionsDialog = document.querySelector("#customer-actions-dialog");
const closeCustomerActionsDialogButton = document.querySelector("#close-customer-actions-dialog");
const brandForm = document.querySelector("#brand-form");
const brandNameInput = document.querySelector("#brand-name");
const productForm = document.querySelector("#product-form");
const productBrandSelect = document.querySelector("#product-brand-select");
const productNameInput = document.querySelector("#product-name");
const catalogList = document.querySelector("#catalog-list");
const exportBackupButton = document.querySelector("#export-backup-button");
const importBackupButton = document.querySelector("#import-backup-button");
const importBackupInput = document.querySelector("#import-backup-input");
const openRolloverDialogButton = document.querySelector("#open-rollover-dialog");
const rolloverDialog = document.querySelector("#rollover-dialog");
const closeRolloverDialogButton = document.querySelector("#close-rollover-dialog");
const rolloverForm = document.querySelector("#rollover-form");
const rolloverIdInput = document.querySelector("#rollover-id");
const rolloverDialogTitle = document.querySelector("#rollover-dialog-title");
const rolloverPreviewChip = document.querySelector("#rollover-preview-chip");
const rolloverSourceYearSelect = document.querySelector("#rollover-source-year");
const rolloverTargetYearSelect = document.querySelector("#rollover-target-year");
const rolloverAmountInput = document.querySelector("#rollover-amount");
const rolloverCollectedInput = document.querySelector("#rollover-collected");
const rolloverNoteInput = document.querySelector("#rollover-note");
const rolloverCollectionDialog = document.querySelector("#rollover-collection-dialog");
const closeRolloverCollectionDialogButton = document.querySelector("#close-rollover-collection-dialog");
const rolloverCollectionForm = document.querySelector("#rollover-collection-form");
const rolloverCollectionIdInput = document.querySelector("#rollover-collection-id");
const rolloverCollectionTitle = document.querySelector("#rollover-collection-title");
const rolloverCollectionSummaryChip = document.querySelector("#rollover-collection-summary-chip");
const rolloverCollectionAmountInput = document.querySelector("#rollover-collection-amount");
const rolloverCollectionDateInput = document.querySelector("#rollover-collection-date");
const rolloverCollectionNoteInput = document.querySelector("#rollover-collection-note");
const toggleCustomerActionsButton = document.querySelector("#toggle-customer-actions");

function loadRecentCustomerIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_CUSTOMERS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

let recentCustomerIds = loadRecentCustomerIds();
function updateDeviceIsolationNotice() {
  const notice = document.querySelector(".device-isolation-notice");
  if (!notice) return;
  if (isApiEnabled()) {
    notice.hidden = false;
    notice.innerHTML = `
      <span class="device-isolation-icon">☁️</span>
      <span><strong>Cihazlar arası senkron aktif.</strong> Sunucudaki ortak veritabanına bağlısın — bir cihazda girilen kayıt, diğer cihazlarda kısa süre içinde otomatik görünür.</span>
    `;
  } else {
    // Demo/preview'da gerçek bir backend yok; "cihaz izole" uyarısı burada
    // sadece kafa karıştırır ve "çok cihazlı canlı sistem" iddiasıyla çelişir.
    // Demo banner'ı zaten verinin kalıcı olmadığını ayrıca açıklıyor.
    notice.hidden = true;
  }
}

async function initializeApplication() {
  quickDateInput.value = TODAY;
  transactionDateInput.value = TODAY;
  reportCutoffDateInput.value = TODAY;
  updateQuickDueDate();
  updateDialogDueDate();
  updateNotificationButtonLabel();
  applyBrandSettings();
  applyAuthUi();
  updateDeviceIsolationNotice();
  render();
  resetCustomerAddForm();
  resetCustomerEditorForm();

  if (isApiEnabled()) {
    const sessionRestored = await restoreSession();
    if (sessionRestored) {
      await reloadStateFromApi({ silent: true });
      startApiAutoSync();
    }
  }
}

function persist() {
  if (IS_PREVIEW_MODE) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function persistRecentCustomers() {
  localStorage.setItem(RECENT_CUSTOMERS_STORAGE_KEY, JSON.stringify(recentCustomerIds));
}

const authOverlay = document.querySelector("#auth-overlay");
const authForm = document.querySelector("#auth-form");
const authUsernameInput = document.querySelector("#auth-username");
const authPasswordInput = document.querySelector("#auth-password");
const authFeedback = document.querySelector("#auth-feedback");
const authUserBadge = document.querySelector("#auth-user-badge");
const logoutButton = document.querySelector("#logout-button");
const syncStatusEl = document.querySelector("#sync-status");
const syncStatusTextEl = document.querySelector("#sync-status-text");

function setSyncStatus(state) {
  if (!syncStatusEl || !syncStatusTextEl) return;
  if (!isApiEnabled()) {
    syncStatusEl.hidden = true;
    return;
  }
  syncStatusEl.hidden = false;
  syncStatusEl.dataset.syncState = state;
  syncStatusTextEl.textContent = state === "syncing"
    ? "Senkronize ediliyor…"
    : state === "error"
      ? "Bağlantı sorunu"
      : "Senkron aktif";
}

function isApiEnabled() {
  return Boolean(API_BASE_URL);
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
}

function setAuthToken(token) {
  if (!token) { localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY); return; }
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

function setAuthFeedback(message = "", type = "") {
  if (!authFeedback) return;
  authFeedback.textContent = message;
  authFeedback.classList.remove("error", "success");
  if (type) authFeedback.classList.add(type);
}

function applyAuthUi() {
  if (!isApiEnabled()) return;
  const isAuthenticated = Boolean(activeUser);
  if (authOverlay) authOverlay.hidden = isAuthenticated;
  document.querySelector(".app-shell")?.classList.toggle("app-locked", !isAuthenticated);
  if (authUserBadge) {
    authUserBadge.hidden = !isAuthenticated;
    authUserBadge.textContent = isAuthenticated ? (activeUser.full_name || activeUser.username || "") : "";
  }
  if (logoutButton) logoutButton.hidden = !isAuthenticated;
}

async function restoreSession() {
  if (!isApiEnabled()) return false;
  const token = getAuthToken();
  if (!token) { activeUser = null; applyAuthUi(); return false; }
  try {
    const response = await apiRequest("auth.php", { query: { action: "session" } });
    activeUser = response.user || null;
    applyAuthUi();
    return Boolean(activeUser);
  } catch (error) {
    setAuthToken("");
    activeUser = null;
    applyAuthUi();
    return false;
  }
}

async function loginWithCredentials(username, password) {
  const response = await apiRequest("auth.php?action=login", {
    method: "POST",
    data: { username, password },
  });
  setAuthToken(response.token || "");
  activeUser = response.user || null;
  applyAuthUi();
  return response;
}

async function logoutSession() {
  try {
    if (getAuthToken()) {
      await apiRequest("auth.php?action=logout", { method: "POST" });
    }
  } catch (error) {
    console.error("Oturum kapatılamadı.", error);
  } finally {
    setAuthToken("");
    activeUser = null;
    applyAuthUi();
    setAuthFeedback("");
    authForm?.reset();
  }
}

function loadBrandSettings() {
  try {
    const raw = localStorage.getItem(BRAND_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      businessName: String(parsed.businessName || "").trim(),
      logoDataUrl: parsed.logoDataUrl || null,
    };
  } catch (error) {
    return null;
  }
}

function saveBrandSettings(settings) {
  localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(settings));
}

function clearBrandSettings() {
  localStorage.removeItem(BRAND_STORAGE_KEY);
}

function getBrandDisplayName() {
  const settings = loadBrandSettings();
  return settings?.businessName || "TrackDesk";
}

function applyBrandSettings() {
  const settings = loadBrandSettings();
  const businessName = settings?.businessName || "";
  const topbarLogo = document.querySelector(".topbar-logo");
  if (topbarLogo) {
    if (settings?.logoDataUrl) {
      topbarLogo.innerHTML = `<img src="${settings.logoDataUrl}" alt="" class="topbar-logo-img"><span>${businessName || "TrackDesk"}</span>`;
    } else if (businessName) {
      topbarLogo.textContent = businessName;
    } else {
      topbarLogo.innerHTML = `TrackDesk <span class="demo-chip">Demo</span>`;
    }
  }
}

function resizeImageFile(file, maxSize = 300) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Görsel yüklenemedi."));
      img.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("Dosya okunamadı."));
    reader.readAsDataURL(file);
  });
}

function updateBrandSettings(patch) {
  const current = loadBrandSettings() || {
    businessName: "",
    logoDataUrl: null,
  };
  saveBrandSettings({ ...current, ...patch });
  applyBrandSettings();
  syncDueNotifications();
  renderBrandSettingsPanel();
}

function renderBrandSettingsPanel() {
  const settings = loadBrandSettings();
  if (businessNameInput) businessNameInput.value = settings?.businessName || "";
  if (brandLogoPreview) {
    brandLogoPreview.style.backgroundImage = settings?.logoDataUrl ? `url(${settings.logoDataUrl})` : "none";
  }
  if (brandLogoRemoveButton) brandLogoRemoveButton.hidden = !settings?.logoDataUrl;
}

function getNumericId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildCatalogMetadata(brands) {
  apiCatalogRecords = Array.isArray(brands) ? brands : [];
  apiProductLookup = new Map();

  apiCatalogRecords.forEach((brand) => {
    (brand.products || []).forEach((product) => {
      const label = `${brand.name} - ${product.name}`;
      apiProductLookup.set(label, {
        id: getNumericId(product.id),
        brandId: getNumericId(brand.id),
        brandName: brand.name,
        productName: product.name,
        defaultUnitPrice: Number(product.default_unit_price) || 0,
      });
    });
  });
}

function getCatalogProductMeta(productLabel) {
  return apiProductLookup.get(String(productLabel || "").trim()) || null;
}

async function apiRequest(endpoint, { method = "GET", data, query } = {}) {
  if (!isApiEnabled()) {
    throw new Error("Paneli localhost veya yayınlanmış alan adı üzerinden açman gerekiyor.");
  }

  const url = new URL(endpoint, API_BASE_URL);

  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, value);
    });
  }

  const options = {
    method,
    headers: {
      Accept: "application/json",
    },
  };

  const authToken = getAuthToken();
  if (authToken) {
    options.headers.Authorization = `Bearer ${authToken}`;
  }

  if (data !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url.toString(), options);
  let parsed = null;

  try {
    parsed = await response.json();
  } catch (error) {
    parsed = null;
  }

  if (!response.ok || parsed?.success === false) {
    if (response.status === 401) {
      setAuthToken("");
      activeUser = null;
      applyAuthUi();
    }
    throw new Error(parsed?.message || `API isteği başarısız oldu (${response.status}).`);
  }

  return parsed;
}

function buildFrontendCatalog(brands) {
  buildCatalogMetadata(brands);
  return (brands || []).map((brand) => ({
    brand: brand.name,
    products: (brand.products || []).map((product) => product.name),
  }));
}

function buildFrontendTransaction(transaction) {
  return createTransaction({
    id: String(transaction.id),
    date: transaction.transaction_date,
    items: (transaction.items || []).map((item) => ({
      product: item.product_label,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unit_price) || 0,
    })),
    amount: Number(transaction.total_amount) || 0,
    stage: transaction.stage,
    note: transaction.note || "",
    collections: (transaction.collections || []).map((collection) => ({
      id: String(collection.id),
      date: collection.collection_date,
      amount: Number(collection.amount) || 0,
      note: collection.note || "",
    })),
    paymentDueDate: transaction.payment_due_date || "",
  });
}

function buildFrontendLedgerEntry(entry) {
  return {
    id: String(entry.id),
    type: entry.entry_type === "debt" ? "debt" : "payment",
    amount: Number(entry.amount) || 0,
    date: entry.entry_date || TODAY,
    note: entry.note || "",
  };
}

function normalizeLedgerEntry(entry) {
  return {
    id: entry.id != null ? String(entry.id) : crypto.randomUUID(),
    type: entry.type === "debt" ? "debt" : "payment",
    amount: Number(entry.amount) || 0,
    date: normalizeDateInput(entry.date),
    note: String(entry.note || "").trim(),
  };
}

function buildFrontendRollover(rollover) {
  return {
    id: String(rollover.id),
    sourceYear: String(rollover.source_year),
    targetYear: String(rollover.target_year),
    amount: Number(rollover.amount) || 0,
    note: rollover.note || "",
    createdAt: rollover.created_at || new Date().toISOString(),
    collectionMovements: (rollover.collections || []).map((collection) => ({
      id: String(collection.id),
      date: collection.collection_date,
      amount: Number(collection.amount) || 0,
      note: collection.note || "",
    })),
  };
}

function shouldPauseAutoSync() {
  if (document.hidden) return true;

  const activeElement = document.activeElement;
  const isEditingField =
    activeElement &&
    ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName) &&
    !activeElement.closest("#auth-overlay");

  if (isEditingField) return true;

  return [
    transactionDialog,
    collectionDialog,
    settingsDialog,
    customerActionsDialog,
    catalogDialog,
    rolloverDialog,
    rolloverCollectionDialog,
    islemMenuDialog,
    tahsilatDialog,
  ].some((dialog) => dialog?.open);
}

async function reloadStateFromApi({ silent = false } = {}) {
  if (!isApiEnabled() || isSyncingState) return;
  if (silent && shouldPauseAutoSync()) return;

  isSyncingState = true;
  setSyncStatus("syncing");

  try {
    const [catalogResponse, customersResponse, transactionsResponse, rolloversResponse, ledgerResponse] = await Promise.all([
      apiRequest("catalog.php"),
      apiRequest("customers.php", { query: { limit: 500 } }),
      apiRequest("transactions.php", { query: { limit: 500 } }),
      apiRequest("rollovers.php"),
      apiRequest("customer_ledger.php", { query: { limit: 5000 } }).catch(() => ({ entries: [] })),
    ]);

    const customers = (customersResponse.customers || []).map((customer) => ({
      id: String(customer.id),
      name: customer.name,
      contactPerson: customer.contact_person || "",
      phone: customer.phone || "",
      taxNumber: customer.tax_number || "",
      address: customer.address || "",
      note: customer.note || "",
      transactions: [],
      rollovers: [],
      ledgerEntries: [],
    }));

    const customersById = new Map(customers.map((customer) => [customer.id, customer]));

    (transactionsResponse.transactions || []).forEach((transaction) => {
      const customer = customersById.get(String(transaction.customer_id));
      if (!customer) return;
      customer.transactions.push(buildFrontendTransaction(transaction));
    });

    (rolloversResponse.rollovers || []).forEach((rollover) => {
      const customer = customersById.get(String(rollover.customer_id));
      if (!customer) return;
      customer.rollovers.push(buildFrontendRollover(rollover));
    });

    (ledgerResponse.entries || []).forEach((entry) => {
      const customer = customersById.get(String(entry.customer_id));
      if (!customer) return;
      customer.ledgerEntries.push(buildFrontendLedgerEntry(entry));
    });

    const nextState = hydrateState({
      catalog: buildFrontendCatalog(catalogResponse.brands || []),
      customers,
    });

    const previousSelectedCustomerId = selectedCustomerId;
    state = nextState;
    persist();
    selectedCustomerId = state.customers.some((customer) => customer.id === previousSelectedCustomerId)
      ? previousSelectedCustomerId
      : state.customers[0]?.id ?? null;
    render();
    setSyncStatus("ok");
  } catch (error) {
    console.error("API senkronizasyonu başarısız oldu.", error);
    setSyncStatus("error");
    if (!silent) {
      showToast(error.message || "Veriler sunucudan yüklenemedi.", "error");
    }
  } finally {
    isSyncingState = false;
  }
}

function startApiAutoSync() {
  if (!isApiEnabled() || syncIntervalId) return;

  syncIntervalId = window.setInterval(() => {
    reloadStateFromApi({ silent: true });
  }, API_SYNC_INTERVAL_MS);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatDate(dateText) {
  const normalized = normalizeDateInput(dateText, "");
  if (!normalized) return "-";
  const date = toLocalDate(normalized);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(date);
}

function getCustomerMetaText(customer) {
  const parts = [customer.contactPerson, customer.phone, customer.taxNumber, customer.note].filter(Boolean);
  return parts.length ? parts.join(" • ") : "Kısa bilgi yok";
}

function resetCustomerAddForm() {
  customerAddForm?.reset();
}

function resetCustomerEditorForm() {
  customerEditorForm?.reset();
  if (customerEditorIdInput) customerEditorIdInput.value = "";
  if (customerEditorPickerNameInput) customerEditorPickerNameInput.value = "";
}

function openCustomerAddDialog() {
  if (!customerAddDialog) return;
  resetCustomerAddForm();
  customerAddDialog.showModal();
}

function populateCustomerEditorForm(customer) {
  if (!customer) return;
  customerEditorIdInput.value = customer.id || "";
  customerEditorPickerNameInput.value = customer.name || "";
  customerEditorNameInput.value = customer.name || "";
  customerEditorContactPersonInput.value = customer.contactPerson || "";
  customerEditorPhoneInput.value = customer.phone || "";
  customerEditorTaxNumberInput.value = customer.taxNumber || "";
  customerEditorAddressInput.value = customer.address || "";
  customerEditorNoteInput.value = customer.note || "";
}

function openCustomerEditorDialog(customer = null) {
  if (!customerEditorDialog) return;
  resetCustomerEditorForm();

  if (customer) {
    populateCustomerEditorForm(customer);
  }

  customerEditorDialog.showModal();
}

function getTransactionRemaining(transaction) {
  return Math.max((Number(transaction.amount) || 0) - (Number(transaction.paid) || 0), 0);
}

function getRolloverCollectedTotal(rollover) {
  return Math.min(getCollectionTotal(rollover?.collectionMovements), Number(rollover?.amount) || 0);
}

function getRolloverRemaining(rollover) {
  return Math.max((Number(rollover?.amount) || 0) - getRolloverCollectedTotal(rollover), 0);
}

function getLatestRolloverCollectionDate(rollover) {
  return [...(rollover?.collectionMovements || [])]
    .map((collection) => collection.date)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || "";
}

function getPaymentReminderMeta(transaction, referenceDate = TODAY) {
  if (!transaction?.paymentDueDate || getTransactionRemaining(transaction) <= 0) return null;

  if (transaction.paymentDueDate < referenceDate) {
    return {
      text: `Vadesi geçti: ${formatDate(transaction.paymentDueDate)}`,
      className: "overdue",
    };
  }

  if (transaction.paymentDueDate === referenceDate) {
    return {
      text: `Bugün ödeme günü: ${formatDate(transaction.paymentDueDate)}`,
      className: "due",
    };
  }

  return {
    text: `Ödeme tarihi: ${formatDate(transaction.paymentDueDate)}`,
    className: "scheduled",
  };
}

function loadNotificationRegistry() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFICATION_STORAGE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function saveNotificationRegistry(registry) {
  localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(registry));
}

function updateNotificationButtonLabel() {
  if (!enableNotificationsButton) return;
  if (!("Notification" in window)) {
    enableNotificationsButton.textContent = "Bildirim desteklenmiyor";
    enableNotificationsButton.disabled = true;
    return;
  }

  if (Notification.permission === "granted") {
    enableNotificationsButton.textContent = "Bildirimler Açık";
    enableNotificationsButton.disabled = true;
    return;
  }

  if (Notification.permission === "denied") {
    enableNotificationsButton.textContent = "Bildirim izni kapalı";
    enableNotificationsButton.disabled = true;
    return;
  }

  enableNotificationsButton.textContent = "Bildirimleri Aç";
  enableNotificationsButton.disabled = false;
}

function getDueNotificationTargets() {
  return getAllTransactionsWithCustomer()
    .filter((transaction) => transaction.paymentDueDate && getTransactionRemaining(transaction) > 0)
    .filter((transaction) => transaction.paymentDueDate <= TODAY)
    .map((transaction) => ({
      ...transaction,
      reminderText: getPaymentReminderMeta(transaction)?.text || "Ödeme hatırlatması",
    }));
}

function syncDueNotifications() {
  updateNotificationButtonLabel();

  const dueTargets = getDueNotificationTargets();
  const brandName = getBrandDisplayName();
  document.title = dueTargets.length ? `(${dueTargets.length}) ${brandName}` : brandName;

  if (!("Notification" in window) || Notification.permission !== "granted" || !dueTargets.length) {
    return;
  }

  const registry = loadNotificationRegistry();

  dueTargets.forEach((transaction) => {
    const key = `${transaction.id}:${transaction.paymentDueDate}`;
    if (registry[key]) return;

    new Notification(brandName, {
      body: `${transaction.customerName} için ${transaction.reminderText}. Kalan: ${formatCurrency(getTransactionRemaining(transaction))}`,
    });
    registry[key] = new Date().toISOString();
  });

  saveNotificationRegistry(registry);
}

function buildProductOptions(selectedValue = "") {
  const hasSelectedOutsideCatalog =
    selectedValue &&
    !state.catalog.some((group) => group.products.some((product) => `${group.brand} - ${product}` === selectedValue));

  return [
    `<option value="">Ürün seç</option>`,
    hasSelectedOutsideCatalog ? `<option value="${selectedValue}" selected>${selectedValue} (arsiv)</option>` : "",
    ...state.catalog
      .filter((group) => group.products.length)
      .map(
      (group) => `
        <optgroup label="${group.brand}">
          ${group.products
            .map((product) => {
              const value = `${group.brand} - ${product}`;
              return `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${product}</option>`;
            })
            .join("")}
        </optgroup>
      `
    ),
  ].join("");
}

function createProductRowMarkup(scope, item = { product: "", quantity: "" }) {
  return `
    <div class="product-row" data-product-row>
      <label>
        <span>Marka / Ürün</span>
        <select class="product-select" data-scope="${scope}" data-role="product-select" required>
          ${buildProductOptions(item.product)}
        </select>
      </label>
      <label>
        <span>Birim fiyat</span>
        <input class="product-price" data-role="product-price" type="number" min="0" step="0.01" placeholder="0" value="${item.unitPrice || ""}" required>
      </label>
      <label>
        <span>Adet</span>
        <input class="product-qty" data-role="product-qty" type="number" min="1" step="1" placeholder="0" value="${item.quantity || ""}" required>
      </label>
      <button type="button" class="ghost small-button remove-product-row" data-role="remove-product-row">Sil</button>
    </div>
  `;
}

function ensureAtLeastOneProductRow(container, scope) {
  if (!container.children.length) {
    container.insertAdjacentHTML("beforeend", createProductRowMarkup(scope));
  }
}

function addProductRow(container, scope, item) {
  container.insertAdjacentHTML("beforeend", createProductRowMarkup(scope, item));
}

function resetProductRows(container, scope, items = []) {
  container.innerHTML = "";
  if (items.length) {
    items.forEach((item) => addProductRow(container, scope, item));
    return;
  }
  ensureAtLeastOneProductRow(container, scope);
}

function collectItemsFromRows(container) {
  return [...container.querySelectorAll("[data-product-row]")]
    .map((row) => ({
      product: row.querySelector('[data-role="product-select"]')?.value || "",
      quantity: Number(row.querySelector('[data-role="product-qty"]')?.value) || 0,
      unitPrice: Number(row.querySelector('[data-role="product-price"]')?.value) || 0,
    }))
    .filter((item) => item.product && item.quantity > 0);
}

function calculateTotalFromItems(items) {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
}

function updateFormAmountFromRows(container, amountField) {
  const total = calculateTotalFromItems(collectItemsFromRows(container));
  amountField.value = total ? total.toFixed(2) : "";
}

function refreshProductSelectOptions(container) {
  [...container.querySelectorAll('[data-role="product-select"]')].forEach((select) => {
    const currentValue = select.value;
    select.innerHTML = buildProductOptions(currentValue);
    select.value = currentValue;
  });
}

function refreshAllProductSelects() {
  refreshProductSelectOptions(productRows);
  refreshProductSelectOptions(quickProductRows);
}

function getCustomerById(id) {
  return state.customers.find((customer) => String(customer.id) === String(id));
}

function getCustomerByName(name) {
  const normalizedName = String(name || "").trim().toLocaleLowerCase("tr-TR");
  return state.customers.find((customer) => customer.name.toLocaleLowerCase("tr-TR") === normalizedName);
}

function setQuickCustomer(customer, options = {}) {
  if (!quickCustomerSelect || !quickCustomerIdInput) return;
  const { syncSelectedCustomer = false } = options;

  if (!customer) {
    quickCustomerIdInput.value = "";
    quickCustomerSelect.value = "";
    return;
  }

  quickCustomerSelect.value = customer.name;
  quickCustomerIdInput.value = String(customer.id);
  if (syncSelectedCustomer) {
    selectedCustomerId = customer.id;
  }
}

function getQuickCustomerMatches(query, limit = 8) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("tr-TR");
  const sortedCustomers = [...state.customers].sort((a, b) => a.name.localeCompare(b.name, "tr"));

  if (!normalizedQuery) {
    return sortedCustomers;
  }

  return sortedCustomers
    .map((customer) => {
      const normalizedName = customer.name.toLocaleLowerCase("tr-TR");
      const words = normalizedName.split(/\s+/).filter(Boolean);
      const startsWith = normalizedName.startsWith(normalizedQuery);
      const wordStartsWith = words.some((word) => word.startsWith(normalizedQuery));
      const includes = normalizedName.includes(normalizedQuery);
      const exact = normalizedName === normalizedQuery;
      const position = includes ? normalizedName.indexOf(normalizedQuery) : 999;

      return {
        customer,
        score: exact ? 4 : startsWith ? 3 : wordStartsWith ? 2 : includes ? 1 : 0,
        position,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.position !== b.position) return a.position - b.position;
      return a.customer.name.localeCompare(b.customer.name, "tr");
    })
    .slice(0, limit || sortedCustomers.length)
    .map((entry) => entry.customer);
}

function renderCustomerPickerResults(query = customerPickerSearchInput?.value || "") {
  if (!customerPickerResults) return;
  const matches = query ? getQuickCustomerMatches(query, 24) : [...state.customers].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const activeCustomerId = customerPickerMode === "editor"
    ? Number(customerEditorIdInput?.value || 0)
    : Number(quickCustomerIdInput?.value || 0);

  if (!matches.length) {
    customerPickerResults.innerHTML = `<div class="customer-picker-empty">Eşleşen müşteri bulunamadı.</div>`;
    return;
  }

  customerPickerResults.innerHTML = matches
    .map(
      (customer) => `
        <button
          type="button"
          class="customer-picker-result${customer.id === activeCustomerId ? " active" : ""}"
          data-picker-customer="${customer.id}"
        >
          ${escapeHtml(customer.name)}
        </button>
      `
    )
    .join("");
}

function openCustomerPickerDialog(mode = "quick") {
  if (!customerPickerDialog) return;
  customerPickerMode = mode;
  customerPickerDialog.showModal();
  if (customerPickerSearchInput) {
    customerPickerSearchInput.value = "";
    renderCustomerPickerResults("");
    window.setTimeout(() => customerPickerSearchInput.focus(), 30);
  } else {
    renderCustomerPickerResults("");
  }
}

function getAllTransactionsWithCustomer() {
  return state.customers.flatMap((customer) =>
    customer.transactions.map((transaction) => ({
      ...transaction,
      customerId: customer.id,
      customerName: customer.name,
    }))
  );
}

function getTransactionById(customer, transactionId) {
  return customer?.transactions.find((transaction) => transaction.id === transactionId);
}

function getRolloverById(customer, rolloverId) {
  return customer?.rollovers?.find((rollover) => rollover.id === rolloverId);
}

function rememberRecentCustomer(customerId) {
  if (!customerId) return;
  recentCustomerIds = [customerId, ...recentCustomerIds.filter((id) => id !== customerId)].slice(0, 5);
  persistRecentCustomers();
}

function compareTransactionsDesc(a, b) {
  return (
    b.date.localeCompare(a.date) ||
    b.stage.localeCompare(a.stage, "tr") ||
    (b.customerName || "").localeCompare(a.customerName || "", "tr") ||
    (a.productSummary || "").localeCompare(b.productSummary || "", "tr")
  );
}

function normalizeInitial(name) {
  return String(name || "").trim().charAt(0).toLocaleUpperCase("tr-TR");
}

function isSameWeek(dateText) {
  const current = toLocalDate(TODAY);
  const target = toLocalDate(dateText);
  const day = (current.getDay() + 6) % 7;
  const weekStart = new Date(current);
  weekStart.setDate(current.getDate() - day);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return target >= weekStart && target < weekEnd;
}

function isSameYear(dateText) {
  return String(dateText || "").slice(0, 4) === TODAY.slice(0, 4);
}

function getLatestTransactionDate(transactions) {
  return [...transactions]
    .map((transaction) => transaction.date)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || TODAY;
}

// İleri tarihli (planlı) kayıtlar "bugün" referansını geleceğe kaydırmasın.
function getLatestPastTransactionDate(transactions) {
  return getLatestTransactionDate(transactions.filter((transaction) => transaction.date && transaction.date <= TODAY));
}

// Sabit yıl listesi her yılbaşında eskiyordu: geçen yıl/bu yıl/gelecek yıl +
// veride geçen tüm yıllar.
function getAvailableSummaryYears() {
  const currentYear = Number(TODAY.slice(0, 4));
  const years = new Set([currentYear - 1, currentYear, currentYear + 1].map(String));
  state.customers.forEach((customer) => {
    customer.transactions.forEach((transaction) => years.add(String(transaction.date || "").slice(0, 4)));
    (customer.rollovers || []).forEach((rollover) => {
      years.add(rollover.sourceYear);
      years.add(rollover.targetYear);
    });
  });
  return [...years].filter((year) => /^\d{4}$/.test(year)).sort();
}

function populateSummaryYearFilter(transactions) {
  if (!summaryYearFilter) return;
  const years = getAvailableSummaryYears(transactions);
  const nextValue = years.includes(activeSummaryYear) ? activeSummaryYear : TODAY.slice(0, 4);

  activeSummaryYear = nextValue;
  summaryYearFilter.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  summaryYearFilter.value = nextValue;
}

function getTransactionsForSummaryYear(transactions, year) {
  return transactions.filter((transaction) => String(transaction.date || "").startsWith(`${year}-`));
}

function getCustomerTransactionsForYear(customer, year) {
  return customer.transactions.filter((transaction) => String(transaction.date || "").startsWith(`${year}-`));
}

function isSameWeekByReference(dateText, referenceDateText) {
  const current = toLocalDate(referenceDateText);
  const target = toLocalDate(dateText);
  const day = (current.getDay() + 6) % 7;
  const weekStart = new Date(current);
  weekStart.setDate(current.getDate() - day);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return target >= weekStart && target < weekEnd;
}

function isSameYearByReference(dateText, referenceDateText) {
  return String(dateText || "").slice(0, 4) === String(referenceDateText || "").slice(0, 4);
}

function getPeriodTransactions(transactions, period, referenceDate = TODAY) {
  if (period === "today") return transactions.filter((transaction) => transaction.date === referenceDate);
  if (period === "week") return transactions.filter((transaction) => isSameWeekByReference(transaction.date, referenceDate));
  if (period === "year") return transactions.filter((transaction) => isSameYearByReference(transaction.date, referenceDate));
  return transactions;
}

function summarizeTransactions(transactions) {
  return transactions.reduce(
    (totals, transaction) => {
      totals.sales += transaction.amount;
      totals.paid += transaction.paid;
      totals.debt += Math.max(transaction.amount - transaction.paid, 0);
      totals.count += 1;
      totals.delivered += transaction.stage === "delivered" ? 1 : 0;
      return totals;
    },
    { sales: 0, paid: 0, debt: 0, count: 0, delivered: 0 }
  );
}

function getPeriodSummary(transactions, referenceDate = TODAY) {
  return {
    today: summarizeTransactions(getPeriodTransactions(transactions, "today", referenceDate)),
    week: summarizeTransactions(getPeriodTransactions(transactions, "week", referenceDate)),
    year: summarizeTransactions(getPeriodTransactions(transactions, "year", referenceDate)),
  };
}

function getCustomerLedgerSummary(customer) {
  const allTransactions = customer.transactions;
  const totalSales = allTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const transactionCollections = allTransactions.flatMap((transaction) => transaction.collections).reduce((sum, collection) => sum + collection.amount, 0);
  const rolloverCollections = (customer.rollovers || []).reduce((sum, rollover) => sum + getRolloverCollectedTotal(rollover), 0);
  const totalCollections = transactionCollections + rolloverCollections;
  const rolloverBalance = (customer.rollovers || []).reduce(
    (sum, rollover) => sum + getRolloverRemaining(rollover),
    0
  );
  // Devir tutarı satışlara dahil değil ve devir tahsilatı zaten rolloverBalance'ı
  // düşürüyor; satışlardan bir kez daha düşülürse aynı ödeme iki kez sayılır.
  const openBalance = Math.max(Math.max(totalSales - transactionCollections, 0) + rolloverBalance, 0);
  const unpaidTransactions = allTransactions.filter((transaction) => transaction.amount > transaction.paid).length;

  return {
    totalSales,
    totalCollections,
    openBalance,
    unpaidTransactions,
    rolloverBalance,
  };
}


function getCustomerYearDebt(customer, year) {
  return getCustomerTransactionsForYear(customer, year).reduce(
    (sum, transaction) => sum + Math.max(transaction.amount - transaction.paid, 0),
    0
  );
}

function getCustomerRolloverSummary(customer, year) {
  const incomingEntries = (customer.rollovers || [])
    .filter((rollover) => rollover.targetYear === year)
    .map((rollover) => ({
      ...rollover,
      remaining: getRolloverRemaining(rollover),
      collected: getRolloverCollectedTotal(rollover),
    }));

  const outgoingEntries = (customer.rollovers || [])
    .filter((rollover) => rollover.sourceYear === year)
    .map((rollover) => ({
      ...rollover,
      remaining: getRolloverRemaining(rollover),
      collected: getRolloverCollectedTotal(rollover),
    }));

  return {
    incomingAmount: incomingEntries.reduce((sum, item) => sum + item.remaining, 0),
    outgoingAmount: outgoingEntries.reduce((sum, item) => sum + item.amount, 0),
    incomingEntries,
    outgoingEntries,
  };
}

function getOperationalInsights() {
  const allTransactions = getAllTransactionsWithCustomer();
  const activeTransactions = allTransactions.filter((transaction) => !isArchivedTransaction(transaction));
  const overdueTransactions = activeTransactions
    .filter((transaction) => transaction.date < TODAY && getTransactionRemaining(transaction) > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || compareTransactionsDesc(a, b));
  const todayTransactions = activeTransactions.filter((transaction) => transaction.date === TODAY);
  const futureTransactions = activeTransactions.filter((transaction) => transaction.date > TODAY);
  const deliveredAwaitingPayment = activeTransactions.filter(
    (transaction) => transaction.stage === "delivered" && getTransactionRemaining(transaction) > 0
  );
  const dueTodayTransactions = activeTransactions
    .filter((transaction) => transaction.paymentDueDate === TODAY && getTransactionRemaining(transaction) > 0)
    .sort((a, b) => a.customerName.localeCompare(b.customerName, "tr"));
  const overdueDueTransactions = activeTransactions
    .filter((transaction) => transaction.paymentDueDate && transaction.paymentDueDate < TODAY && getTransactionRemaining(transaction) > 0)
    .sort((a, b) => a.paymentDueDate.localeCompare(b.paymentDueDate) || compareTransactionsDesc(a, b));
  const urgentTransactions = [
    ...dueTodayTransactions,
    ...overdueDueTransactions.filter(
      (transaction) => !dueTodayTransactions.some((item) => item.id === transaction.id)
    ),
    ...overdueTransactions.filter(
      (transaction) =>
        !dueTodayTransactions.some((item) => item.id === transaction.id) &&
        !overdueDueTransactions.some((item) => item.id === transaction.id)
    ),
  ];
  const debtCustomers = state.customers
    .map((customer) => {
      const ledger = getCustomerLedgerSummary(customer);
      return {
        id: customer.id,
        name: customer.name,
        note: customer.note,
        openBalance: ledger.openBalance,
        unpaidTransactions: ledger.unpaidTransactions,
      };
    })
    .filter((customer) => customer.openBalance > 0)
    .sort((a, b) => b.openBalance - a.openBalance || a.name.localeCompare(b.name, "tr"));
  const topDebtors = debtCustomers.slice(0, 8);

  const totalOpenBalance = debtCustomers.reduce((sum, customer) => sum + customer.openBalance, 0);

  return {
    stats: [
      { label: "Toplam Açık Bakiye", value: formatCurrency(totalOpenBalance), tone: "warning" },
      { label: "Geciken Açık İşlem", value: String(overdueTransactions.length), tone: "overdue" },
      { label: "Bugün Vadesi Gelen", value: String(dueTodayTransactions.length), tone: "warning" },
      { label: "Bugün Takip Edilecek", value: String(todayTransactions.length), tone: "normal" },
      { label: "İleri Tarihli İşlem", value: String(futureTransactions.length), tone: "normal" },
      { label: "Teslim Edildi / Para Bekliyor", value: String(deliveredAwaitingPayment.length), tone: "warning" },
    ],
    topDebtors,
    urgentTransactions: urgentTransactions.slice(0, 12),
  };
}

function renderControlCenter() {
  if (!controlCenterStats || !debtWatchList || !urgentWatchList) return;

  const insights = getOperationalInsights();

  controlCenterStats.innerHTML = insights.stats
    .map(
      (item) => `
        <article class="stat-card command-stat stat-card--${item.tone}">
          <div class="muted">${item.label}</div>
          <div class="amount stat-value--${item.tone}">${item.value}</div>
        </article>
      `
    )
    .join("");

  if (!insights.topDebtors.length) {
    debtWatchList.className = "history-list scroll-list empty-state";
    debtWatchList.innerHTML = makeEmptyState(ES_ICONS.check, 'Açık bakiye yok', 'Tüm müşteriler güncel.');
  } else {
    debtWatchList.className = "history-list scroll-list";
    debtWatchList.innerHTML = insights.topDebtors
      .map(
        (customer) => `
          <article class="watch-item warning">
            <strong>${customer.name}</strong>
            <div class="meta-row">
              <span>Açık bakiye: ${formatCurrency(customer.openBalance)}</span>
              <span>Açık işlem: ${customer.unpaidTransactions}</span>
            </div>
            ${customer.note ? `<div class="meta-row"><span>Not: ${customer.note}</span></div>` : ""}
            <div class="action-row">
              <button type="button" class="ghost" data-customer-focus="${customer.id}">Müşteriyi Aç</button>
            </div>
          </article>
        `
      )
      .join("");
  }

  if (!insights.urgentTransactions.length) {
    urgentWatchList.className = "history-list scroll-list empty-state";
    urgentWatchList.innerHTML = makeEmptyState(ES_ICONS.checkCircle, 'Kritik işlem yok', 'Bugün için acil ödeme bulunmuyor.');
  } else {
    urgentWatchList.className = "history-list scroll-list";
    urgentWatchList.innerHTML = insights.urgentTransactions
      .map((transaction) => {
        const remaining = getTransactionRemaining(transaction);
        const paymentMeta = getPaymentReminderMeta(transaction);
        return `
          <article class="watch-item ${paymentMeta?.className === "overdue" ? "overdue" : "warning"}">
            <strong>${transaction.customerName}</strong>
            <div class="meta-row">
              <span class="prod-name">${transaction.productSummary || "Ürün seçilmedi"}</span>
            </div>
            <div class="meta-row">
              <span>İşlem tarihi: ${formatDate(transaction.date)}</span>
              <span>Kalan: ${formatCurrency(remaining)}</span>
            </div>
            <div class="meta-row">
              <span>Durum: ${stageMeta(transaction).text}</span>
              ${paymentMeta ? `<span>${paymentMeta.text}</span>` : ""}
            </div>
            <div class="action-row">
              <button type="button" class="ghost" data-customer-focus="${transaction.customerId}">Müşteriyi Aç</button>
              <button type="button" class="primary" data-action="${transaction.stage === "delivered" ? "collect-transaction" : "edit-transaction"}" data-id="${transaction.id}" data-customer-id="${transaction.customerId}">${transaction.stage === "delivered" ? "Ödeme İşle" : "İşlemi Aç"}</button>
            </div>
          </article>
        `;
      })
      .join("");
  }
}

function getCustomerCollectionMovements(customer) {
  const transactionCollections = customer.transactions.flatMap((transaction) =>
    transaction.collections.map((collection) => ({
      ...collection,
      collectionType: "transaction",
      transactionDate: transaction.date,
      transactionId: transaction.id,
      productSummary: transaction.productSummary,
    }))
  );
  const rolloverCollections = (customer.rollovers || [])
    .flatMap((rollover) =>
      (rollover.collectionMovements || []).map((collection) => ({
        ...collection,
        collectionType: "rollover",
        id: collection.id || `rollover-${rollover.id}`,
        transactionDate: `${rollover.sourceYear} -> ${rollover.targetYear}`,
        transactionId: rollover.id,
        productSummary: `${rollover.sourceYear}'den devredilen bakiye tahsilatı`,
        note: collection.note || rollover.note,
      }))
    );

  return [...transactionCollections, ...rolloverCollections]
    .sort((a, b) => b.date.localeCompare(a.date) || (a.productSummary || "").localeCompare(b.productSummary || "", "tr"));
}

function getRolloverSummaryEntries(customer) {
  return (customer.rollovers || []).map((rollover) => ({
    id: `rollover-summary-${rollover.id}`,
    customerId: customer.id,
    customerName: customer.name,
    date: `${rollover.targetYear}-01-01`,
    amount: Number(rollover.amount) || 0,
    paid: getRolloverCollectedTotal(rollover),
    stage: "delivered",
    delivered: true,
    fullyPaid: getRolloverCollectedTotal(rollover) >= (Number(rollover.amount) || 0) && (Number(rollover.amount) || 0) > 0,
    productSummary: `${rollover.sourceYear}'den devredilen bakiye`,
    quantity: 0,
    note: rollover.note,
    isRollover: true,
    rolloverId: rollover.id,
  }));
}

function getRolloverHistoryEntries(customer) {
  return getRolloverSummaryEntries(customer)
    .filter((entry) => entry.fullyPaid)
    .map((entry) => {
      const rollover = (customer.rollovers || []).find((item) => item.id === entry.rolloverId);
      return {
        ...entry,
        date: normalizeDateInput(getLatestRolloverCollectionDate(rollover) || rollover?.createdAt || `${rollover?.targetYear || TODAY.slice(0, 4)}-01-01`),
      };
    });
}

function getCustomerSummaryEntries(customer) {
  return [
    ...customer.transactions.map((transaction) => ({ customerId: customer.id, customerName: customer.name, ...transaction })),
    ...getRolloverSummaryEntries(customer),
  ];
}

function getAllSummaryEntries() {
  return state.customers.flatMap((customer) => getCustomerSummaryEntries(customer));
}

function getHistoricalTransactions(customer = null) {
  const sourceTransactions = customer
    ? [
        ...customer.transactions.map((transaction) => ({ customerId: customer.id, customerName: customer.name, ...transaction })),
        ...getRolloverHistoryEntries(customer),
      ]
    : state.customers.flatMap((item) => [
        ...item.transactions.map((transaction) => ({
          customerId: item.id,
          customerName: item.name,
          ...transaction,
        })),
        ...getRolloverHistoryEntries(item),
      ]);

  return sourceTransactions
    .filter((transaction) => transaction.date < TODAY)
    .sort(compareTransactionsDesc);
}

function isArchivedTransaction(transaction) {
  return transaction.fullyPaid && (Number(transaction.amount) || 0) > 0;
}

function isCarryOverOpenTransaction(transaction) {
  return transaction.date < TODAY && (!isArchivedTransaction(transaction) || transaction.amount > transaction.paid);
}

function getFilteredGlobalTransactions(period) {
  const allTransactions = getAllSummaryEntries();
  const referenceDate = getLatestPastTransactionDate(allTransactions);

  if (period === "today") {
    return allTransactions.filter((transaction) => transaction.date === referenceDate).sort(compareTransactionsDesc);
  }

  return getPeriodTransactions(allTransactions, period, referenceDate).sort(compareTransactionsDesc);
}

function renderPeriodCards(summary, referenceDate = TODAY) {
  const referenceLabel = formatDate(referenceDate);
  const labels = {
    today: `Gün (${referenceLabel})`,
    week: "Haftalık",
    year: `Yıl (${String(referenceDate).slice(0, 4)})`,
  };

  return Object.entries(labels)
    .map(
      ([key, label]) => `
        <div class="stat-card period-card">
          <div class="period-title">${label}</div>
          <div class="period-line"><span>Satış</span><strong>${formatCurrency(summary[key].sales)}</strong></div>
          <div class="period-line"><span>Tahsilat</span><strong>${formatCurrency(summary[key].paid)}</strong></div>
          <div class="period-line"><span>Borç</span><strong>${formatCurrency(summary[key].debt)}</strong></div>
        </div>
      `
    )
    .join("");
}

function renderSummary() {
  const transactions = getAllSummaryEntries();
  populateSummaryYearFilter(transactions);
  const filteredTransactions = getTransactionsForSummaryYear(transactions, activeSummaryYear);
  const hasPastEntries = filteredTransactions.some((transaction) => transaction.date <= TODAY);
  const referenceDate = hasPastEntries
    ? getLatestPastTransactionDate(filteredTransactions)
    : filteredTransactions.length > 0
      ? getLatestTransactionDate(filteredTransactions)
      : `${activeSummaryYear}-12-31`;
  summaryCards.innerHTML = renderPeriodCards(getPeriodSummary(filteredTransactions, referenceDate), referenceDate);
}

function populateRolloverYearOptions() {
  const years = getAvailableSummaryYears();
  const options = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  rolloverSourceYearSelect.innerHTML = options;
  rolloverTargetYearSelect.innerHTML = options;
}

function updateRolloverPreview() {
  const customer = getCustomerById(selectedCustomerId);
  const sourceYear = rolloverSourceYearSelect.value;
  if (!customer || !sourceYear) {
    rolloverPreviewChip.textContent = "Kaynak yılın açık bakiyesi burada görünecek.";
    return;
  }

  const suggestedAmount = getCustomerYearDebt(customer, sourceYear);
  rolloverPreviewChip.textContent = `${sourceYear} açık bakiyesi: ${formatCurrency(suggestedAmount)}`;
  if (!rolloverAmountInput.value) {
    rolloverAmountInput.value = suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "";
  }
}

function openRolloverDialog(rolloverId = null) {
  const customer = getCustomerById(selectedCustomerId);
  if (!customer) return;

  const years = getAvailableSummaryYears();
  populateRolloverYearOptions();
  rolloverForm.reset();
  rolloverIdInput.value = "";
  rolloverDialogTitle.textContent = `${customer.name} için devir kaydı`;
  rolloverSourceYearSelect.value = activeSummaryYear;
  rolloverTargetYearSelect.value = years.find((year) => Number(year) > Number(activeSummaryYear)) || years.at(-1) || activeSummaryYear;
  rolloverAmountInput.value = "";
  rolloverCollectedInput.value = "0";
  rolloverNoteInput.value = "";

  if (rolloverId) {
    const rollover = (customer.rollovers || []).find((item) => item.id === rolloverId);
    if (!rollover) return;
    rolloverIdInput.value = rollover.id;
    rolloverDialogTitle.textContent = `${customer.name} için devir düzenle`;
    rolloverSourceYearSelect.value = rollover.sourceYear;
    rolloverTargetYearSelect.value = rollover.targetYear;
    rolloverAmountInput.value = rollover.amount;
    rolloverCollectedInput.value = getRolloverCollectedTotal(rollover) || 0;
    rolloverNoteInput.value = rollover.note;
  }

  updateRolloverPreview();
  rolloverDialog.showModal();
}

function openRolloverCollectionDialog(rolloverId) {
  const customer = getCustomerById(selectedCustomerId);
  const rollover = getRolloverById(customer, rolloverId);
  if (!customer || !rollover || !rolloverCollectionDialog) return;

  const remaining = getRolloverRemaining(rollover);
  rolloverCollectionForm.reset();
  rolloverCollectionIdInput.value = rollover.id;
  rolloverCollectionTitle.textContent = `${customer.name} devir tahsilatı`;
  rolloverCollectionSummaryChip.textContent = `${rollover.sourceYear} -> ${rollover.targetYear} | Kalan: ${formatCurrency(remaining)}`;
  rolloverCollectionAmountInput.value = remaining > 0 ? remaining.toFixed(2) : "0";
  rolloverCollectionDateInput.value = TODAY;
  rolloverCollectionNoteInput.value = "";
  rolloverCollectionDialog.showModal();
}

async function applyRolloverCollection(rolloverId, amountValue, dateValue, noteValue) {
  const customer = getCustomerById(selectedCustomerId);
  const rollover = getRolloverById(customer, rolloverId);
  if (!customer || !rollover) return;

  const amount = Number(amountValue) || 0;
  const date = normalizeDateInput(dateValue);
  const remaining = getRolloverRemaining(rollover);

  if (amount <= 0) {
    showToast("Tahsilat tutarı sıfırdan büyük olmalı.", "warning");
    return;
  }

  if (amount > remaining) {
    showToast("Tahsilat tutarı kalan devir bakiyeden büyük olamaz.", "warning");
    return;
  }

  if (isApiEnabled()) {
    await apiRequest("rollover_collections.php", {
      method: "POST",
      data: {
        rollover_id: getNumericId(rollover.id),
        collection_date: date,
        amount,
        note: String(noteValue || "").trim(),
      },
    });
    await reloadStateFromApi({ silent: true });
    rolloverCollectionDialog.close();
    return;
  }

  rollover.collectionMovements = [
    ...(rollover.collectionMovements || []),
    { id: crypto.randomUUID(), date, amount, note: String(noteValue || "").trim() },
  ];
  rollover.collected = Math.max(Math.min(getCollectionTotal(rollover.collectionMovements), Number(rollover.amount) || 0), 0);

  persist();
  render();
  rolloverCollectionDialog.close();
  showToast(`${formatCurrency(amount)} devir tahsilatı kaydedildi.`, "success");
}

async function deleteRollover(rolloverId) {
  const customer = getCustomerById(selectedCustomerId);
  if (!customer) return;

  const approved = await confirmAction("Bu devir kaydını silmek istiyor musun?");
  if (!approved) return;

  if (isApiEnabled()) {
    await apiRequest("rollovers.php", {
      method: "DELETE",
      data: { id: getNumericId(rolloverId) },
    });
    await reloadStateFromApi({ silent: true });
    return;
  }

  customer.rollovers = (customer.rollovers || []).filter((r) => r.id !== rolloverId);
  persist();
  render();
}

function renderCustomerRolloverList(customer) {
  if (!customerRollovers) return;
  const allRollovers = (customer.rollovers || []).map((rollover) => ({
    ...rollover,
    remaining: getRolloverRemaining(rollover),
    collected: getRolloverCollectedTotal(rollover),
    collectionCount: (rollover.collectionMovements || []).length,
    recentCollections: [...(rollover.collectionMovements || [])]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 3),
  }));
  const rollovers = allRollovers.filter((rollover) => rollover.remaining > 0.001);

  if (!rollovers.length) {
    customerRollovers.className = "history-list scroll-list empty-state";
    customerRollovers.innerHTML = allRollovers.length
      ? makeEmptyState(ES_ICONS.check, 'Tüm devir kapandı', 'Açık devir bakiyesi kalmadı.')
      : makeEmptyState(ES_ICONS.clipboard, 'Devir kaydı yok', 'Bu müşteri için devir eklenmemiş.');
    return;
  }

  customerRollovers.className = "history-list scroll-list";
  customerRollovers.innerHTML = rollovers
    .map(
      (rollover) => `
        <article class="history-item">
          <div class="history-top">
            <strong>${rollover.sourceYear}'den devredilen bakiye</strong>
            <span class="pill">${formatCurrency(rollover.remaining)}</span>
          </div>
          <div class="meta-row">
            <span>Hedef yıl: ${rollover.targetYear}</span>
            <span>Devir: ${formatCurrency(rollover.amount)}</span>
            <span>Tahsil edilen: ${formatCurrency(rollover.collected)}</span>
            <span>Kalan: ${formatCurrency(rollover.remaining)}</span>
          </div>
          <div class="meta-row">
            <span>Tahsilat hareketi: ${rollover.collectionCount}</span>
            <span>Son tahsilat: ${rollover.collected ? formatDate(getLatestRolloverCollectionDate(rollover)) : "-"}</span>
          </div>
          ${
            rollover.recentCollections.length
              ? `<div class="meta-row">${rollover.recentCollections
                  .map((collection) => `<span>${formatDate(collection.date)} - ${formatCurrency(collection.amount)}</span>`)
                  .join("")}</div>`
              : ""
          }
          ${rollover.note ? `<div class="meta-row"><span>Not: ${rollover.note}</span></div>` : ""}
          <div class="action-row">
            <button type="button" class="ghost" data-action="edit-rollover" data-id="${rollover.id}">Düzenle</button>
            <button type="button" class="primary" data-action="collect-rollover" data-id="${rollover.id}">Tahsil Et</button>
            <button type="button" class="danger" data-action="delete-rollover" data-id="${rollover.id}">Kaydı Sil</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderClosedRolloverList(customer) {
  if (!customerClosedRollovers) return;
  const closedRollovers = (customer.rollovers || [])
    .map((rollover) => ({
      ...rollover,
      collected: getRolloverCollectedTotal(rollover),
      remaining: getRolloverRemaining(rollover),
      collectionCount: (rollover.collectionMovements || []).length,
      closedDate: getLatestRolloverCollectionDate(rollover) || "",
      allCollections: [...(rollover.collectionMovements || [])].sort(
        (a, b) => String(b.date || "").localeCompare(String(a.date || ""))
      ),
    }))
    .filter((rollover) => rollover.remaining <= 0.001 && rollover.amount > 0);

  if (!closedRollovers.length) {
    customerClosedRollovers.className = "history-list scroll-list empty-state";
    customerClosedRollovers.innerHTML = makeEmptyState(ES_ICONS.clipboard, 'Kapanmış devir yok', 'Ödenen devirler burada görünür.');
    return;
  }

  customerClosedRollovers.className = "history-list scroll-list";
  customerClosedRollovers.innerHTML = closedRollovers
    .map(
      (rollover) => `
        <article class="history-item closed-rollover-item">
          <div class="history-top">
            <strong>${rollover.sourceYear}'den devredilen bakiye</strong>
            <span class="pill pill-closed">KAPANDI</span>
          </div>
          <div class="meta-row">
            <span>İşlem: ${rollover.sourceYear} &rarr; ${rollover.targetYear}</span>
            <span>Toplam devir: ${formatCurrency(rollover.amount)}</span>
            <span>Tahsil edilen: ${formatCurrency(rollover.collected)}</span>
          </div>
          <div class="meta-row">
            <span>Kapanma tarihi: ${rollover.closedDate ? formatDate(rollover.closedDate) : "-"}</span>
            <span>Tahsilat hareketi: ${rollover.collectionCount}</span>
          </div>
          ${
            rollover.allCollections.length
              ? `<div class="meta-row">${rollover.allCollections
                  .map((c) => `<span>${formatDate(c.date)}: ${formatCurrency(c.amount)}${c.note ? " (" + escapeHtml(c.note) + ")" : ""}</span>`)
                  .join("")}</div>`
              : ""
          }
          ${rollover.note ? `<div class="meta-row"><span>Not: ${escapeHtml(rollover.note)}</span></div>` : ""}
        </article>
      `
    )
    .join("");
}

function stageMeta(transaction) {
  if (transaction.stage === "delivered") {
    return {
      text: transaction.fullyPaid ? "Teslim edildi / Kapandı" : "Teslim edildi",
      className: transaction.fullyPaid ? "closed" : "delivered",
    };
  }

  if (transaction.stage === "editing") {
    return { text: "Düzenleniyor", className: "editing" };
  }

  return { text: "İşlem alındı", className: "pending" };
}

function renderTransactionCards(transactions, options = {}) {
  const { showCustomer = false } = options;
  return transactions
    .map((transaction) => {
      const status = stageMeta(transaction);
      const remaining = getTransactionRemaining(transaction);
      const paymentMeta = getPaymentReminderMeta(transaction);
      const ownerAttr = transaction.customerId ? `data-customer-id="${transaction.customerId}"` : "";
      const deliveryText =
        transaction.stage === "delivered"
          ? remaining > 0
            ? "Teslim edildi, ödeme açık"
            : "Teslim edildi, kapandı"
          : "Teslim bekliyor";
      let primaryActionMarkup = `
        <button type="button" class="primary" data-action="deliver-transaction" data-id="${transaction.id}" ${ownerAttr}>
          Teslim Et
        </button>
      `;

      if (transaction.stage === "delivered" && remaining > 0) {
        primaryActionMarkup = `
          <button type="button" class="primary" data-action="collect-transaction" data-id="${transaction.id}" ${ownerAttr}>
            Ödeme İşle
          </button>
        `;
      } else if (transaction.stage === "delivered") {
        primaryActionMarkup = `
          <button type="button" class="primary" data-action="deliver-transaction" data-id="${transaction.id}" ${ownerAttr} disabled>
            Teslim Edildi
          </button>
        `;
      }

      return `
        <article class="transaction-item">
          <div class="transaction-top">
            <div>
              ${showCustomer
                ? `<strong class="cust-name">${transaction.customerName || "Müşteri"}</strong>`
                : `<strong>${formatDate(transaction.date)}</strong>`}
              <div class="transaction-meta">
                <span>Toplam adet: ${transaction.quantity}</span>
                ${showCustomer ? `<span>${formatDate(transaction.date)}</span>` : ""}
                <span>${deliveryText}</span>
                ${paymentMeta ? `<span class="status ${paymentMeta.className}">${paymentMeta.text}</span>` : ""}
              </div>
            </div>
            <span class="status ${status.className}">${status.text}</span>
          </div>
          <div class="meta-row">
            ${transaction.items.map((item) => `<span><span class="prod-name">${item.product}</span>: ${item.quantity}${item.unitPrice > 0 ? ` x ${formatCurrency(item.unitPrice)}` : ""}</span>`).join("")}
          </div>
          <div class="meta-row">
            <span>Toplam: ${formatCurrency(transaction.amount)}</span>
            <span>Alınan: ${formatCurrency(transaction.paid)}</span>
            <span>Kalan: ${formatCurrency(remaining)}</span>
          </div>
          ${transaction.note ? `<div class="meta-row"><span>Not: ${transaction.note}</span></div>` : ""}
          <div class="action-row">
            <button type="button" class="ghost" data-action="edit-transaction" data-id="${transaction.id}" ${ownerAttr}>Düzenle</button>
            <button type="button" class="danger" data-action="delete-transaction" data-id="${transaction.id}" ${ownerAttr}>Kaydı Sil</button>
            ${primaryActionMarkup}
          </div>
        </article>
      `;
    })
    .join("");
}

function getDailyOperations(period) {
  if (period === "upcoming") {
    return getAllTransactionsWithCustomer()
      .filter((transaction) => transaction.date > TODAY)
      .sort((a, b) => a.date.localeCompare(b.date) || compareTransactionsDesc(a, b));
  }

  const targetDate = period === "yesterday" ? daysAgo(1) : TODAY;
  return getAllTransactionsWithCustomer()
    .filter((transaction) => transaction.date === targetDate)
    .sort(compareTransactionsDesc);
}

function getDailyDueReminders(period) {
  if (period === "upcoming") {
    return [];
  }

  const targetDate = period === "yesterday" ? daysAgo(1) : TODAY;
  return getAllTransactionsWithCustomer()
    .filter((transaction) => transaction.paymentDueDate === targetDate && getTransactionRemaining(transaction) > 0)
    .sort(compareTransactionsDesc);
}

function populateQuickCustomerOptions() {
  if (!quickCustomerSelect) return;
  const currentValue = quickCustomerSelect.value;
  const matchedCustomer = getCustomerByName(currentValue);
  if (!currentValue) {
    if (quickCustomerIdInput) {
      quickCustomerIdInput.value = "";
    }
    return;
  }

  if (matchedCustomer) {
    setQuickCustomer(matchedCustomer);
    return;
  }

  if (quickCustomerIdInput && !matchedCustomer) {
    quickCustomerIdInput.value = "";
  }
}

function renderRecentCustomers() {
  if (!quickRecentCustomers) return;
  const customers = recentCustomerIds
    .map((id) => getCustomerById(id))
    .filter(Boolean)
    .slice(0, 5);

  if (!customers.length) {
    quickRecentCustomers.innerHTML = `<span class="muted">Henüz seçim yok.</span>`;
    return;
  }

  quickRecentCustomers.innerHTML = customers
    .map(
      (customer) => `
        <button type="button" class="ghost recent-customer-chip" data-recent-customer="${customer.id}">
          ${customer.name}
        </button>
      `
    )
    .join("");
}

function populateCatalogBrandOptions() {
  if (!productBrandSelect) return;
  const currentValue = productBrandSelect.value;
  productBrandSelect.innerHTML = state.catalog
    .map((group) => `<option value="${group.brand}">${group.brand}</option>`)
    .join("");
  productBrandSelect.value =
    currentValue && state.catalog.some((group) => group.brand === currentValue)
      ? currentValue
      : state.catalog[0]?.brand || "";
}

function renderCatalogManager() {
  populateCatalogBrandOptions();

  if (!catalogList) return;
  if (!state.catalog.length) {
    catalogList.className = "catalog-list scroll-list empty-state";
    catalogList.innerHTML = makeEmptyState(ES_ICONS.box, 'Katalog boş', 'Marka eklemek için + düğmesini kullan.');
    return;
  }

  catalogList.className = "catalog-list scroll-list";
  catalogList.innerHTML = state.catalog
    .map(
      (group) => `
        <article class="catalog-brand">
          <div class="section-head compact">
            <strong>${group.brand}</strong>
            <button type="button" class="danger small-button" data-action="delete-brand" data-brand="${group.brand}">Markayı Sil</button>
          </div>
          <div class="catalog-product-list">
            ${group.products
              .map(
                (product) => `
                  <div class="catalog-product-item">
                    <span>${product}</span>
                    <button type="button" class="ghost small-button" data-action="delete-product" data-brand="${group.brand}" data-product="${product}">Sil</button>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      `
    )
    .join("");
}

function renderDailyOperationsBoard() {
  if (!dailyOperationsList) return;
  dailyFilterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.dailyFilter === activeDailyFilter);
  });

  const operations = getDailyOperations(activeDailyFilter);
  const dueReminders = getDailyDueReminders(activeDailyFilter);
  if (!operations.length && !dueReminders.length) {
    dailyOperationsList.className = "history-list scroll-list empty-state";
    const [esIcon, esTitle, esHint] =
      activeDailyFilter === "today"
        ? [ES_ICONS.clipboard, 'Bugün kayıt yok', 'Yeni İşlem formundan ekle; kaydettiğin anda burada görünür.']
        : activeDailyFilter === "yesterday"
          ? [ES_ICONS.clipboard, 'Dün kayıt yok', 'Dünkü işlemler ve tahsilatlar burada görünür.']
          : [ES_ICONS.calendar, 'Planlı işlem yok', 'Tarihi ileriye alınan işlemler burada görünür.'];
    dailyOperationsList.innerHTML = makeEmptyState(esIcon, esTitle, esHint);
    return;
  }

  dailyOperationsList.className = "history-list scroll-list";
  dailyOperationsList.innerHTML = [
    dueReminders.length
      ? `
        <div class="history-group-title">Ödeme hatırlatmaları</div>
        ${renderTransactionCards(dueReminders, { showCustomer: true })}
      `
      : "",
    operations.length
      ? `
        <div class="history-group-title">${
          activeDailyFilter === "upcoming"
            ? "Tüm ileri tarihli işlemler"
            : "Günlük işlem kayıtları"
        }</div>
        ${renderTransactionCards(operations, { showCustomer: true })}
      `
      : "",
  ]
    .filter(Boolean)
    .join("");
}

function renderHistoryList(container, items, type) {
  if (!items.length) {
    container.className = container.className.includes("scroll-list")
      ? "history-list scroll-list empty-state"
      : "history-list empty-state";
    container.innerHTML = type === 'collection'
      ? makeEmptyState(ES_ICONS.banknote, 'Tahsilat kaydı yok', '"Tahsil Et" butonu ile ödeme kaydedebilirsin.')
      : makeEmptyState(ES_ICONS.file, 'İşlem geçmişi yok', 'Tamamlanan işlemler burada görünür.');
    return;
  }

  container.className = container.className.includes("scroll-list") ? "history-list scroll-list" : "history-list";
  container.innerHTML = items
    .map((item) => {
      if (type === "collection") {
        const canDelete = item.id && !String(item.id).startsWith("rollover-");
        return `
          <article class="history-item">
            <div class="history-top">
              <strong>${formatCurrency(item.amount)}</strong>
              <span class="pill">${formatDate(item.date)}</span>
            </div>
            <div class="meta-row">
              <span class="prod-name">${item.productSummary || "İşlem"}</span>
              <span>İşlem tarihi: ${typeof item.transactionDate === "string" && item.transactionDate.match(/^\d{4}-\d{2}-\d{2}$/) ? formatDate(item.transactionDate) : item.transactionDate}</span>
            </div>
            ${item.note ? `<div class="meta-row"><span>Not: ${escapeHtml(item.note)}</span></div>` : ""}
            ${canDelete ? `<div class="action-row"><button type="button" class="danger small-button" data-action="delete-collection" data-id="${item.id}" data-collection-type="${item.collectionType || "transaction"}">Tahsilatı Sil</button></div>` : ""}
          </article>
        `;
      }

      return `
        <article class="history-item">
          <div class="history-top">
            <strong>${item.customerName ? `<span class="cust-name">${item.customerName}</span> - ` : ""}<span class="prod-name">${item.productSummary || "Ürün seçilmedi"}</span></strong>
            <span class="pill">${formatDate(item.date)}</span>
          </div>
          <div class="meta-row">
            <span>Toplam: ${formatCurrency(item.amount)}</span>
            <span>Tahsilat: ${formatCurrency(item.paid)}</span>
            <span>Kalan: ${formatCurrency(Math.max(item.amount - item.paid, 0))}</span>
          </div>
          <div class="meta-row">
            <span>Durum: ${stageMeta(item).text}</span>
            <span>Toplam adet: ${item.isRollover ? "-" : item.quantity}</span>
          </div>
          ${item.note ? `<div class="meta-row"><span>Not: ${item.note}</span></div>` : ""}
          ${
            item.id && !item.isRollover
              ? `<div class="action-row">
                  <button type="button" class="ghost" data-action="edit-history-transaction" data-id="${item.id}" ${item.customerId ? `data-customer-id="${item.customerId}"` : ""}>Kaydı Düzenle</button>
                  <button type="button" class="danger" data-action="delete-history-transaction" data-id="${item.id}" ${item.customerId ? `data-customer-id="${item.customerId}"` : ""}>Kaydı Sil</button>
                </div>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderCustomers() {
  populateQuickCustomerOptions();
  const query = searchInput.value.trim().toLocaleLowerCase("tr-TR");
  const selectedLetter = letterFilter.value;
  const filtered = [...state.customers]
    .sort((a, b) => a.name.localeCompare(b.name, "tr"))
    .filter((customer) => customer.name.toLocaleLowerCase("tr-TR").includes(query))
    .filter((customer) => !selectedLetter || normalizeInitial(customer.name) === selectedLetter);

  customerCount.textContent = `${filtered.length} müşteri`;

  if (!filtered.length) {
    customerList.innerHTML = makeEmptyState(ES_ICONS.search, 'Eşleşen müşteri yok', 'Arama kriterini değiştir.');
    return;
  }

  customerList.innerHTML = filtered
    .map((customer, index) => {
      const ledger = getCustomerLedgerSummary(customer);
      const openCarryOverCount = customer.transactions.filter((transaction) => isCarryOverOpenTransaction(transaction)).length;
      return `
        <button class="customer-item ${customer.id === selectedCustomerId ? "active" : ""}" data-id="${customer.id}" style="--i:${index}">
          <div class="customer-row-main">
            <strong>${customer.name}</strong>
            ${openCarryOverCount > 0 ? `<span class="pill">${openCarryOverCount} açık</span>` : `<span class="pill pill-closed">Açık yok</span>`}
          </div>
          <div class="customer-row-meta">
            <span class="customer-meta-text">${getCustomerMetaText(customer)}</span>
            <span class="customer-balance${ledger.openBalance > 0 ? " customer-balance--owed" : ""}">${formatCurrency(ledger.openBalance)}</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderDetail() {
  const customer = getCustomerById(selectedCustomerId);
  quickOrderButton.disabled = !customer;
  deleteCustomerButton.disabled = !customer;
  printCustomerReportButton.disabled = !customer;
  if (downloadCustomerReportButton) downloadCustomerReportButton.disabled = !customer;
  openRolloverDialogButton.disabled = !customer;
  todayLabel.textContent = formatDate(TODAY);

  if (!customer) {
    detailName.textContent = "Müşteri seç";
    detailOverview.innerHTML = makeEmptyState(ES_ICONS.arrowLeft, 'Müşteri seçilmedi', 'Sol listeden bir müşteri seç.');
    customerLedger.innerHTML = makeEmptyState(ES_ICONS.chart, 'Cari hesap', 'Müşteri seçince hesap gösterilir.');
    renderCustomerRolloverList({ rollovers: [], transactions: [] });
    renderClosedRolloverList({ rollovers: [] });
    renderHistoryList(customerCollections, [], "collection");
    renderHistoryList(customerHistory, [], "transaction");
    const noSelectionHtml = makeEmptyState(ES_ICONS.arrowLeft, 'Müşteri seçilmedi', 'Sol listeden bir müşteri seç.');
    todayTransactionList.className = "transaction-list empty-state";
    todayTransactionList.innerHTML = noSelectionHtml;
    futureTransactionList.className = "transaction-list empty-state";
    futureTransactionList.innerHTML = noSelectionHtml;
    transactionList.className = "transaction-list empty-state";
    transactionList.innerHTML = noSelectionHtml;
    return;
  }

  const summaryEntries = getCustomerSummaryEntries(customer);
  const referenceDate = getLatestPastTransactionDate(summaryEntries);
  const periodSummary = getPeriodSummary(summaryEntries, referenceDate);
  const ledger = getCustomerLedgerSummary(customer);
  const rolloverSummary = getCustomerRolloverSummary(customer, activeSummaryYear);
  const todayTransactions = customer.transactions
    .filter((transaction) => transaction.date === TODAY && !isArchivedTransaction(transaction))
    .sort(compareTransactionsDesc);
  const futureTransactions = customer.transactions
    .filter((transaction) => transaction.date > TODAY)
    .sort((a, b) => a.date.localeCompare(b.date) || a.productSummary.localeCompare(b.productSummary, "tr"));
  const carryOverTransactions = customer.transactions
    .filter((transaction) => isCarryOverOpenTransaction(transaction))
    .sort(compareTransactionsDesc);

  detailName.textContent = customer.name;
  detailOverview.innerHTML = renderPeriodCards(periodSummary, referenceDate);
  customerLedger.innerHTML = `
    ${customer.contactPerson ? `<div class="overview-card"><div class="muted">Yetkili Kişi</div><div class="amount">${escapeHtml(customer.contactPerson)}</div></div>` : ""}
    ${customer.phone ? `<div class="overview-card"><div class="muted">Numara</div><div class="amount">${escapeHtml(customer.phone)}</div></div>` : ""}
    ${customer.taxNumber ? `<div class="overview-card"><div class="muted">Vergi No</div><div class="amount">${escapeHtml(customer.taxNumber)}</div></div>` : ""}
    ${customer.address ? `<div class="overview-card"><div class="muted">Adres</div><div class="amount">${escapeHtml(customer.address)}</div></div>` : ""}
    ${rolloverSummary.incomingEntries
      .map(
        (entry) => `
          <div class="overview-card">
            <div class="muted">${entry.sourceYear}'den Devredilen Bakiye</div>
            <div class="amount">${formatCurrency(entry.remaining)}</div>
          </div>
        `
      )
      .join("")}
    <div class="overview-card">
      <div class="muted">Toplam Satış</div>
      <div class="amount">${formatCurrency(ledger.totalSales)}</div>
    </div>
    <div class="overview-card">
      <div class="muted">Toplam Tahsilat</div>
      <div class="amount">${formatCurrency(ledger.totalCollections)}</div>
    </div>
    <div class="overview-card">
      <div class="muted">Açık Bakiye</div>
      <div class="amount">${formatCurrency(ledger.openBalance)}</div>
    </div>
    <div class="overview-card">
      <div class="muted">Açık İşlem Sayısı</div>
      <div class="amount">${ledger.unpaidTransactions}</div>
    </div>
    <div class="overview-card">
      <div class="muted">${activeSummaryYear} İçine Devredilen Bakiye</div>
      <div class="amount">${formatCurrency(rolloverSummary.incomingAmount)}</div>
    </div>
    <div class="overview-card">
      <div class="muted">${activeSummaryYear} İçinden Devredilen Bakiye</div>
      <div class="amount">${formatCurrency(rolloverSummary.outgoingAmount)}</div>
    </div>
    <div class="overview-card">
      <div class="muted">Toplam Devir Bakiyesi</div>
      <div class="amount">${formatCurrency(ledger.rolloverBalance)}</div>
    </div>
  `;

  renderCustomerRolloverList(customer);
  renderClosedRolloverList(customer);
  renderHistoryList(customerCollections, getCustomerCollectionMovements(customer), "collection");
  renderHistoryList(
    customerHistory,
    [
      ...customer.transactions
        .filter((transaction) => isArchivedTransaction(transaction))
        .map((transaction) => ({ customerId: customer.id, customerName: customer.name, ...transaction })),
      ...getRolloverHistoryEntries(customer),
    ].sort(compareTransactionsDesc),
    "transaction"
  );
  todayTransactionList.className = "transaction-list";
  futureTransactionList.className = "transaction-list";
  transactionList.className = "transaction-list";

  todayTransactionList.innerHTML = todayTransactions.length
    ? renderTransactionCards(todayTransactions)
    : makeEmptyState(ES_ICONS.check, 'Bugün işlem yok', '"Bugün İşlem Ekle" butonuna dokun.');

  futureTransactionList.innerHTML = futureTransactions.length
    ? renderTransactionCards(futureTransactions)
    : makeEmptyState(ES_ICONS.calendar, 'Planlı işlem yok', 'Tarihi bugünden ileriye alınan işlemler burada görünür.');

  transactionList.innerHTML = carryOverTransactions.length
    ? renderTransactionCards(carryOverTransactions)
    : makeEmptyState(ES_ICONS.check, 'Geciken işlem yok', 'Önceki günlerden açık kalan yok.');
}

function renderGlobalHistory() {
  historyFilterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.historyFilter === activeHistoryFilter);
  });
  renderHistoryList(
    globalHistory,
    getFilteredGlobalTransactions(activeHistoryFilter).filter((transaction) => isArchivedTransaction(transaction)),
    "transaction"
  );
}

const ozetTable = document.querySelector("#ozet-table");
const ozetSearch = document.querySelector("#ozet-search");
const ozetSummary = document.querySelector("#ozet-summary");

function formatMoneyShort(value) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function renderOzet() {
  if (!ozetTable) return;
  const query = (ozetSearch?.value || "").trim().toLocaleLowerCase("tr-TR");
  const monthPrefix = TODAY.slice(0, 7);

  const rows = [...state.customers]
    .sort((a, b) => a.name.localeCompare(b.name, "tr"))
    .map((customer) => {
      const openBalance = Math.max(getCustomerLedgerSummary(customer).openBalance, 0);
      const monthDebt = customer.transactions
        .filter((transaction) => String(transaction.date || "").startsWith(monthPrefix))
        .reduce((sum, transaction) => sum + getTransactionRemaining(transaction), 0);
      return {
        id: customer.id,
        name: customer.name,
        monthDebt,
        totalDebt: openBalance,
      };
    })
    .filter((row) => !query || row.name.toLocaleLowerCase("tr-TR").includes(query));

  if (!rows.length) {
    ozetTable.innerHTML = `<tr><td colspan="4" class="ozet-empty">${
      query ? "Aramaya uygun müşteri bulunamadı." : "Henüz müşteri yok."
    }</td></tr>`;
    return;
  }

  ozetTable.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td class="ozet-col-name"><button type="button" class="ozet-name-link" data-ozet-pdf="${row.id}">${escapeHtml(row.name)}</button></td>
          <td class="ozet-col-num">${formatMoneyShort(row.monthDebt)}</td>
          <td class="ozet-col-num">${formatMoneyShort(row.totalDebt)}</td>
          <td class="ozet-col-action">
            <button type="button" class="primary small-button ozet-islem-button" data-ozet-islem="${row.id}">İşlem Yap</button>
          </td>
        </tr>
      `
    )
    .join("");
}

function render() {
  renderOzet();
  renderControlCenter();
  renderSummary();
  renderCustomers();
  renderRecentCustomers();
  renderDetail();
  renderGlobalHistory();
  renderDailyOperationsBoard();
  renderCatalogManager();
  refreshAllProductSelects();
  syncDueNotifications();
}

async function downloadBackup() {
  try {
    const backup = isApiEnabled()
      ? (await apiRequest("backup.php")).backup
      : {
          version: 1,
          exportedAt: new Date().toISOString(),
          storageKey: STORAGE_KEY,
          data: state,
          brand: loadBrandSettings(),
        };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${getBrandDisplayName().toLowerCase().replace(/\s+/g, "-")}-yedek-${TODAY}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showToast(error.message || "Yedek indirilemedi.", "error");
  }
}

function importBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const approved = await confirmAction("Mevcut kayıtlar yedekten gelen verilerle değişsin mi?", { confirmLabel: "Evet, değiştir" });
      if (!approved) return;

      if (isApiEnabled()) {
        await apiRequest("backup.php", {
          method: "POST",
          data: parsed,
        });
        await reloadStateFromApi({ silent: true });
      } else {
        const nextState = hydrateState(parsed.data || parsed);
        state = nextState;
        selectedCustomerId = state.customers[0]?.id ?? null;
        persist();
        if (parsed.brand) {
          saveBrandSettings(parsed.brand);
        }
        applyBrandSettings();
        render();
      }

      showToast("Yedek başarıyla geri yüklendi.", "success");
    } catch (error) {
      console.error("Yedek geri yüklenemedi", error);
      showToast(error.message || "JSON yedeği okunamadı. Dosya yapısını kontrol et.", "error");
    } finally {
      importBackupInput.value = "";
    }
  };

  reader.onerror = () => {
    showToast("Dosya okunurken bir sorun oluştu.", "error");
    importBackupInput.value = "";
  };

  reader.readAsText(file, "utf-8");
}

function getSelectedQuickItems() {
  return collectItemsFromRows(quickProductRows);
}

function getSelectedItemsFromForm() {
  return collectItemsFromRows(productRows);
}

function fillProductSelection(items) {
  resetProductRows(productRows, "dialog", items);
  updateFormAmountFromRows(productRows, amountInput);
}

function openTransactionDialog(transactionId = null) {
  const customer = getCustomerById(selectedCustomerId);
  if (!customer) return;

  transactionForm.reset();
  transactionIdInput.value = "";
  transactionDateInput.value = TODAY;
  dialogDateChip.textContent = `İşlem günü: ${formatDate(TODAY)}`;
  resetProductRows(productRows, "dialog");
  transactionStageInput.value = "created";
  transactionPaymentPlanSelect.value = "0";
  transactionDueDateInput.value = "";
  transactionDueDateInput.dataset.autoDueDate = "";
  amountInput.value = "";
  paidInput.value = "0";
  noteInput.value = "";

  if (!transactionId) {
    dialogTitle.textContent = `${customer.name} için yeni işlem`;
    saveTransactionButton.textContent = "İşlemi Kaydet";
    transactionDialog.showModal();
    return;
  }

  const transaction = getTransactionById(customer, transactionId);
  if (!transaction) return;

  dialogTitle.textContent = `${customer.name} için işlem düzenle`;
  saveTransactionButton.textContent = "Değişiklikleri Kaydet";
  transactionIdInput.value = transaction.id;
  transactionDateInput.value = transaction.date;
  dialogDateChip.textContent = `İşlem günü: ${formatDate(transaction.date)}`;
  fillProductSelection(transaction.items);
  amountInput.value = transaction.amount;
  paidInput.value = transaction.paid;
  noteInput.value = transaction.note;
  transactionStageInput.value = normalizeStage(transaction.stage);
  transactionPaymentPlanSelect.value = transaction.paymentDueDate ? String(DEFERRED_PAYMENT_DAYS) : "0";
  transactionDueDateInput.value = transaction.paymentDueDate || "";
  transactionDueDateInput.dataset.autoDueDate = "";
  updateFormAmountFromRows(productRows, amountInput);
  transactionDialog.showModal();
}

function buildTransactionApiPayload(customer, payload) {
  const transactionDate = normalizeDateInput(payload.date);
  const paymentDueDate = normalizeDateInput(payload.paymentDueDate, "");
  return {
    customer_id: getNumericId(customer.id),
    transaction_date: transactionDate,
    stage: payload.stage || "created",
    payment_due_date: paymentDueDate || null,
    note: String(payload.note || "").trim(),
    items: (payload.items || []).map((item) => {
      const productMeta = getCatalogProductMeta(item.product);
      return {
        product_id: productMeta?.id || null,
        product_label: item.product,
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unitPrice) || 0,
      };
    }),
    collections: (payload.collections || []).map((collection) => ({
      collection_date: normalizeDateInput(collection.date, transactionDate),
      amount: Number(collection.amount) || 0,
      note: String(collection.note || "").trim(),
    })),
  };
}

async function upsertTransaction(customer, payload) {
  if (isApiEnabled()) {
    const requestData = buildTransactionApiPayload(customer, payload);
    if (payload.id) {
      requestData.id = getNumericId(payload.id);
      await apiRequest("transactions.php", { method: "PUT", data: requestData });
    } else {
      await apiRequest("transactions.php", { method: "POST", data: requestData });
    }
    await reloadStateFromApi({ silent: true });
    return;
  }

  const transaction = createTransaction(payload);
  if (payload.id) {
    const idx = customer.transactions.findIndex((t) => t.id === payload.id);
    if (idx >= 0) {
      customer.transactions[idx] = { ...transaction, id: payload.id };
    } else {
      customer.transactions.push(transaction);
    }
  } else {
    customer.transactions.push(transaction);
  }
  persist();
}

function buildCollectionsForManualSave(existingTransaction, paidValue, transactionDate) {
  if (!existingTransaction) {
    return paidValue > 0 ? [{ date: transactionDate, amount: paidValue, note: "İlk tahsilat" }] : [];
  }

  return reconcileCollections(existingTransaction.collections, paidValue, transactionDate);
}

function openCollectionDialog(transactionId) {
  const customer = getCustomerById(selectedCustomerId);
  const transaction = getTransactionById(customer, transactionId);
  if (!customer || !transaction) return;

  const remaining = Math.max(transaction.amount - transaction.paid, 0);
  collectionForm.reset();
  collectionTransactionIdInput.value = transaction.id;
  collectionTitle.textContent = `${customer.name} teslim kaydı`;
  collectionSummaryChip.textContent = `${transaction.productSummary || "Seçili ürün"} | Kalan: ${formatCurrency(remaining)}`;
  collectionAmountInput.value = remaining > 0 ? remaining : 0;
  collectionNoteInput.value = "";
  markDeliveredWithoutPaymentButton.hidden = transaction.stage === "delivered";
  collectionDialog.showModal();
}

async function applyCollection(transactionId, amountToCollect, noteText) {
  const customer = getCustomerById(selectedCustomerId);
  const transaction = getTransactionById(customer, transactionId);
  if (!customer || !transaction) return;

  const collectAmount = Number(amountToCollect) || 0;
  const remaining = Math.max(transaction.amount - transaction.paid, 0);

  if (collectAmount <= 0) {
    showToast("Tahsilat tutarı sıfırdan büyük olmalı. Para alınmadıysa 'Ürün Verildi, Para Alınmadı' seçeneğini kullan.", "warning");
    return;
  }

  if (collectAmount > remaining) {
    showToast("Tahsilat tutarı kalan borçtan fazla olamaz.", "warning");
    return;
  }

  if (isApiEnabled()) {
    if (transaction.stage !== "delivered") {
      await apiRequest("transactions.php", {
        method: "PUT",
        data: {
          ...buildTransactionApiPayload(customer, {
            ...transaction,
            stage: "delivered",
            collections: [
              ...(transaction.collections || []),
              { date: TODAY, amount: collectAmount, note: String(noteText || "").trim() },
            ],
          }),
          id: getNumericId(transaction.id),
        },
      });
    } else {
      await apiRequest("collections.php", {
        method: "POST",
        data: {
          transaction_id: getNumericId(transaction.id),
          collection_date: TODAY,
          amount: collectAmount,
          note: String(noteText || "").trim(),
        },
      });
    }
    await reloadStateFromApi({ silent: true });
    collectionDialog.close();
    showToast(`${formatCurrency(collectAmount)} tahsil edildi.`, "success");
    return;
  }

  transaction.stage = "delivered";
  transaction.delivered = true;
  transaction.collections = [
    ...(transaction.collections || []),
    { id: crypto.randomUUID(), date: TODAY, amount: collectAmount, note: String(noteText || "").trim() },
  ];
  transaction.paid = getCollectionTotal(transaction.collections);
  transaction.fullyPaid = transaction.paid >= transaction.amount && transaction.amount > 0;

  persist();
  render();
  collectionDialog.close();
  showToast(`${formatCurrency(collectAmount)} tahsil edildi.`, "success");
}

async function markTransactionDeliveredWithoutPayment(transactionId) {
  const customer = getCustomerById(selectedCustomerId);
  const transaction = getTransactionById(customer, transactionId);
  if (!customer || !transaction || transaction.stage === "delivered") return;

  if (isApiEnabled()) {
    await apiRequest("transactions.php", {
      method: "PUT",
      data: {
        ...buildTransactionApiPayload(customer, {
          ...transaction,
          stage: "delivered",
          collections: transaction.collections || [],
          note: transaction.note || "Ürün verildi, para alınmadı",
        }),
        id: getNumericId(transaction.id),
      },
    });
    await reloadStateFromApi({ silent: true });
    collectionDialog.close();
    return;
  }

  transaction.stage = "delivered";
  transaction.delivered = true;
  transaction.note = transaction.note || "Ürün verildi, para alınmadı";
  persist();
  render();
  collectionDialog.close();
}

async function deleteSelectedCustomer() {
  const customer = getCustomerById(selectedCustomerId);
  if (!customer) return;

  const approved = await confirmAction(`${customer.name} kaydını silmek istiyor musun? Bu işlem geri alınmaz.`);
  if (!approved) return;

  if (isApiEnabled()) {
    await apiRequest("customers.php", {
      method: "DELETE",
      data: { id: getNumericId(customer.id) },
    });
    await reloadStateFromApi({ silent: true });
    return;
  }

  state.customers = state.customers.filter((c) => c.id !== selectedCustomerId);
  selectedCustomerId = state.customers[0]?.id ?? null;
  persist();
  render();
}

async function deleteCollection(collectionId, collectionType) {
  const approved = await confirmAction("Bu tahsilat kaydını silmek istiyor musun? Bu işlem geri alınmaz.");
  if (!approved) return;

  if (isApiEnabled()) {
    const endpoint = collectionType === "rollover" ? "rollover_collections.php" : "collections.php";
    await apiRequest(endpoint, { method: "DELETE", data: { id: getNumericId(collectionId) } });
    await reloadStateFromApi({ silent: true });
    return;
  }

  if (collectionType === "rollover") {
    for (const c of state.customers) {
      for (const r of (c.rollovers || [])) {
        r.collectionMovements = (r.collectionMovements || []).filter((m) => m.id !== collectionId);
        r.collected = Math.max(Math.min(getCollectionTotal(r.collectionMovements), Number(r.amount) || 0), 0);
      }
    }
  } else {
    for (const c of state.customers) {
      for (const t of c.transactions) {
        const before = (t.collections || []).length;
        t.collections = (t.collections || []).filter((col) => col.id !== collectionId);
        if (t.collections.length !== before) {
          t.paid = getCollectionTotal(t.collections);
          t.fullyPaid = t.paid >= t.amount && t.amount > 0;
        }
      }
    }
  }

  persist();
  render();
}

async function deleteTransaction(transactionId) {
  const customer = getCustomerById(selectedCustomerId);
  const transaction = getTransactionById(customer, transactionId);
  if (!customer || !transaction) return;

  const approved = await confirmAction("Bu işlem kaydını silmek istiyor musun? Bu işlem geri alınmaz.");
  if (!approved) return;

  if (isApiEnabled()) {
    await apiRequest("transactions.php", {
      method: "DELETE",
      data: { id: getNumericId(transactionId) },
    });
    await reloadStateFromApi({ silent: true });
    return;
  }

  customer.transactions = customer.transactions.filter((t) => t.id !== transactionId);
  persist();
  render();
}

function openCatalogDialog() {
  renderCatalogManager();
  catalogDialog.showModal();
}

async function addBrand(brandName) {
  const nextBrand = String(brandName || "").trim();
  if (!nextBrand) return;

  if (state.catalog.some((group) => group.brand.toLocaleLowerCase("tr-TR") === nextBrand.toLocaleLowerCase("tr-TR"))) {
    showToast("Bu marka zaten katalogda bulunuyor.", "warning");
    return;
  }

  if (isApiEnabled()) {
    await apiRequest("brands.php", { method: "POST", data: { name: nextBrand } });
    await reloadStateFromApi({ silent: true });
    return;
  }

  state.catalog.push({ brand: nextBrand, products: [] });
  state.catalog = normalizeCatalog(state.catalog);
  persist();
  refreshAllProductSelects();
  renderCatalogManager();
}

async function addProductToCatalog(brandName, productName) {
  const nextProduct = String(productName || "").trim();
  if (!brandName || !nextProduct) return;

  if (isApiEnabled()) {
    const targetBrand = apiCatalogRecords.find((group) => group.name === brandName);
    if (!targetBrand) return;
    if ((targetBrand.products || []).some((p) => p.name.toLocaleLowerCase("tr-TR") === nextProduct.toLocaleLowerCase("tr-TR"))) {
      showToast("Bu ürün seçili markada zaten var.", "warning");
      return;
    }
    await apiRequest("products.php", {
      method: "POST",
      data: { brand_id: getNumericId(targetBrand.id), name: nextProduct },
    });
    await reloadStateFromApi({ silent: true });
    return;
  }

  const targetBrand = state.catalog.find((group) => group.brand === brandName);
  if (!targetBrand) return;

  if ((targetBrand.products || []).some((product) => product.toLocaleLowerCase("tr-TR") === nextProduct.toLocaleLowerCase("tr-TR"))) {
    showToast("Bu ürün seçili markada zaten var.", "warning");
    return;
  }

  targetBrand.products = [...(targetBrand.products || []), nextProduct];
  state.catalog = normalizeCatalog(state.catalog);
  persist();
  refreshAllProductSelects();
  renderCatalogManager();
}

async function deleteBrand(brandName) {
  const approved = await confirmAction(`${brandName} markasını katalogdan silmek istiyor musun?`);
  if (!approved) return;

  if (isApiEnabled()) {
    const targetBrand = apiCatalogRecords.find((group) => group.name === brandName);
    if (!targetBrand) return;
    await apiRequest("brands.php", { method: "DELETE", data: { id: getNumericId(targetBrand.id) } });
    await reloadStateFromApi({ silent: true });
    return;
  }

  state.catalog = state.catalog.filter((group) => group.brand !== brandName);
  state.catalog = normalizeCatalog(state.catalog);
  persist();
  refreshAllProductSelects();
  renderCatalogManager();
}

async function deleteProductFromCatalog(brandName, productName) {
  const approved = await confirmAction(`${productName} ürününü silmek istiyor musun?`);
  if (!approved) return;

  if (isApiEnabled()) {
    const targetBrand = apiCatalogRecords.find((group) => group.name === brandName);
    if (!targetBrand) return;
    const targetProduct = (targetBrand.products || []).find((p) => p.name === productName);
    if (!targetProduct) return;
    await apiRequest("products.php", { method: "DELETE", data: { id: getNumericId(targetProduct.id) } });
    await reloadStateFromApi({ silent: true });
    return;
  }

  const targetBrand = state.catalog.find((group) => group.brand === brandName);
  if (!targetBrand) return;

  targetBrand.products = (targetBrand.products || []).filter((product) => product !== productName);
  if (targetBrand.products.length === 0) {
    state.catalog = state.catalog.filter((group) => group.brand !== brandName);
  }
  state.catalog = normalizeCatalog(state.catalog);
  persist();
  refreshAllProductSelects();
  renderCatalogManager();
}

function getCustomerRolloverEntriesUntil(customer, cutoffDate) {
  return (customer.rollovers || [])
    .filter((rollover) => `${rollover.targetYear}-01-01` <= cutoffDate)
    .map((rollover) => {
      const paidUntilCutoff = (rollover.collectionMovements || [])
        .filter((collection) => String(collection.date || "") <= cutoffDate)
        .reduce((sum, collection) => sum + (Number(collection.amount) || 0), 0);

      return {
        id: `rollover-report-${rollover.id}`,
        date: `${rollover.targetYear}-01-01`,
        amount: Number(rollover.amount) || 0,
        paid: Math.min(paidUntilCutoff, Number(rollover.amount) || 0),
        stage: paidUntilCutoff >= (Number(rollover.amount) || 0) ? "delivered" : "editing",
        fullyPaid: paidUntilCutoff >= (Number(rollover.amount) || 0) && (Number(rollover.amount) || 0) > 0,
        productSummary: `${rollover.sourceYear}'den devredilen bakiye`,
        quantity: 0,
        isRollover: true,
        note: rollover.note,
      };
    })
    .sort(compareTransactionsDesc);
}

function getCustomerReportEntriesUntil(customer, cutoffDate) {
  return [
    ...getCustomerRolloverEntriesUntil(customer, cutoffDate),
    ...getCustomerTransactionsUntil(customer, cutoffDate),
  ];
}

function getCustomerTransactionsUntil(customer, cutoffDate) {
  return customer.transactions.filter((transaction) => transaction.date <= cutoffDate).sort(compareTransactionsDesc);
}

function buildCustomerReportHtml(customer, cutoffDate) {
  const reportTransactions = getCustomerTransactionsUntil(customer, cutoffDate);
  const reportRollovers = getCustomerRolloverEntriesUntil(customer, cutoffDate);
  const reportEntries = getCustomerReportEntriesUntil(customer, cutoffDate);
  const totalSales = reportTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalRolloverAmount = reportRollovers.reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalCollections = reportEntries.reduce((sum, transaction) => sum + transaction.paid, 0);
  const totalDebt = reportEntries.reduce((sum, transaction) => sum + Math.max(transaction.amount - transaction.paid, 0), 0);

  const rows = reportEntries.length
    ? reportEntries
        .map(
          (transaction) => `
            <tr>
              <td>${formatDate(transaction.date)}</td>
              <td>${transaction.productSummary || "-"}</td>
              <td>${formatCurrency(transaction.amount)}</td>
              <td>${formatCurrency(transaction.paid)}</td>
              <td>${formatCurrency(Math.max(transaction.amount - transaction.paid, 0))}</td>
              <td>${stageMeta(transaction).text}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6">Bu tarih aralığında kayıt bulunamadı.</td></tr>`;

  const safeName = escapeHtml(customer.name);
  const downloadName = customer.name.replace(/[^a-zA-Z0-9À-ɏ _-]/g, '') + '-cari-doküm.html';
  return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(getBrandDisplayName())} - ${safeName} Cari Dökümü</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; color: #17354a; }
        .toolbar { position: sticky; top: 0; z-index: 10; background: #eef8fc; border-bottom: 2px solid #bfd9e7; padding: 10px 16px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .toolbar-title { flex: 1; font-weight: 700; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .btn { display: inline-block; padding: 9px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; border: none; }
        .btn-primary { background: #0f7f95; color: #fff; }
        .btn-ghost { background: #fff; color: #17354a; border: 1px solid #bfd9e7; }
        .report-body { padding: 20px 16px; }
        h1, h2, p { margin: 0 0 10px; }
        .summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 20px 0; }
        @media (min-width: 600px) { .summary { grid-template-columns: repeat(4, 1fr); } }
        .box { border: 1px solid #bfd9e7; border-radius: 12px; padding: 14px; background: #f5fbff; }
        .label { font-size: 11px; text-transform: uppercase; color: #5f8297; margin-bottom: 6px; }
        .amount { font-size: 18px; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
        th, td { border: 1px solid #d7e8f0; padding: 8px 10px; text-align: left; }
        th { background: #eef8fc; }
        @media print { .toolbar { display: none !important; } .report-body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <span class="toolbar-title">${safeName} &mdash; Cari Döküm</span>
        <button class="btn btn-ghost" onclick="window.print()">Yazdır / PDF Kaydet</button>
        <button class="btn btn-primary" onclick="try{window.opener.__reportDownloadFn();}catch(e){try{window.opener.showToast('İndirme için ana sayfadan HTML Olarak İndir butonunu kullan.','info');}catch(_){}}">HTML İndir</button>
      </div>
      <div class="report-body">
      <h1>${safeName}</h1>
      <p>Rapor tarihi: ${formatDate(cutoffDate)}</p>
      <p>Kısa bilgi: ${customer.note || "-"}</p>
      <div class="summary">
        <div class="box"><div class="label">Toplam Satış</div><div class="amount">${formatCurrency(totalSales)}</div></div>
        <div class="box"><div class="label">Devreden Bakiye</div><div class="amount">${formatCurrency(totalRolloverAmount)}</div></div>
        <div class="box"><div class="label">Toplam Tahsilat</div><div class="amount">${formatCurrency(totalCollections)}</div></div>
        <div class="box"><div class="label">Açık Bakiye</div><div class="amount">${formatCurrency(totalDebt)}</div></div>
      </div>
      <h2>İşlem Dökümü</h2>
      <table>
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Ürünler</th>
            <th>Satış</th>
            <th>Tahsilat</th>
            <th>Kalan</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
    </body>
    </html>
  `;
}

function viewCustomerReport(customerId) {
  const customer = getCustomerById(customerId);
  if (!customer) return;
  const html = buildCustomerReportHtml(customer, TODAY);
  const fileName = customer.name.replace(/[^a-zA-Z0-9À-ɏ _-]/g, "").trim() + "-cari-dokum.html";
  window.__reportDownloadFn = () => {
    const dlBlob = new Blob([html], { type: "text/html;charset=utf-8" });
    const dlUrl = URL.createObjectURL(dlBlob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(dlUrl), 5000);
  };
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    showToast("Raporu açmak için tarayıcıda yeni sekmeye izin ver.", "warning");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function printCustomerReport() {
  const customer = getCustomerById(selectedCustomerId);
  if (!customer) return;
  const cutoffDate = reportCutoffDateInput.value || TODAY;
  const html = buildCustomerReportHtml(customer, cutoffDate);
  const fileName = customer.name.replace(/[^a-zA-Z0-9À-ɏ _-]/g, "").trim() + "-cari-dokum.html";
  window.__reportDownloadFn = () => {
    const dlBlob = new Blob([html], { type: "text/html;charset=utf-8" });
    const dlUrl = URL.createObjectURL(dlBlob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(dlUrl), 5000);
  };
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    showToast("Raporu açmak için tarayıcıda yeni sekmeye izin ver.", "warning");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadCustomerReport() {
  const customer = getCustomerById(selectedCustomerId);
  if (!customer) return;
  const cutoffDate = reportCutoffDateInput.value || TODAY;
  const html = buildCustomerReportHtml(customer, cutoffDate);
  const fileName = customer.name.replace(/[^a-zA-Z0-9À-ɏ _-]/g, "").trim() + "-cari-dokum.html";
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function updateQuickDueDate() {
  if (!quickDueDateInput || !quickPaymentPlanSelect || !quickDateInput) return;
  const suggestedDueDate = getDeferredDueDate(quickDateInput.value || TODAY, quickPaymentPlanSelect.value);
  const previousSuggestedDueDate = quickDueDateInput.dataset.autoDueDate || "";
  if (suggestedDueDate && (!quickDueDateInput.value || quickDueDateInput.value === previousSuggestedDueDate)) {
    quickDueDateInput.value = suggestedDueDate;
  }
  quickDueDateInput.dataset.autoDueDate = suggestedDueDate;
}

function updateDialogDueDate() {
  if (!transactionDueDateInput || !transactionPaymentPlanSelect || !transactionDateInput) return;
  const suggestedDueDate = getDeferredDueDate(transactionDateInput.value || TODAY, transactionPaymentPlanSelect.value);
  const previousSuggestedDueDate = transactionDueDateInput.dataset.autoDueDate || "";
  if (suggestedDueDate && (!transactionDueDateInput.value || transactionDueDateInput.value === previousSuggestedDueDate)) {
    transactionDueDateInput.value = suggestedDueDate;
  }
  transactionDueDateInput.dataset.autoDueDate = suggestedDueDate;
}

quickTransactionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  // Kutu boşsa müşteri yok sayılır (boş arama tüm müşterileri döndürüp ilkini
  // sessizce seçiyordu). ID'ler UUID olabilir → Number()'a çevrilmez.
  const typedCustomer = quickCustomerSelect.value.trim();
  const idMatchedCustomer = getCustomerById(quickCustomerIdInput?.value);
  const customer = typedCustomer
    ? (idMatchedCustomer?.name === typedCustomer ? idMatchedCustomer : null) ||
      getCustomerByName(typedCustomer) ||
      getQuickCustomerMatches(typedCustomer, 1)[0]
    : null;
  if (!customer) {
    showToast("Listeden geçerli bir müşteri seçmelisin.", "warning");
    const pickerEl = document.querySelector('.quick-customer-picker');
    pickerEl?.classList.add('field-error');
    pickerEl?.querySelector('input')?.focus();
    setTimeout(() => pickerEl?.classList.remove('field-error'), 1400);
    return;
  }
  setQuickCustomer(customer, { syncSelectedCustomer: true });
  // Form novalidate: müşteri uyarısı önce gelsin, ürün alanları sonra denetlensin
  // (müşteri kutusu salt okunur olduğu için tarayıcı onu hiç denetlemiyordu).
  if (!quickTransactionForm.reportValidity()) return;
  const items = getSelectedQuickItems();
  if (!items.length) {
    showToast("En az bir ürün seçip adet girmelisin.", "warning");
    return;
  }

  const transactionDate = quickDateInput.value || TODAY;
  const amount = Number(quickAmountInput.value) || 0;
  const paid = Number(quickPaidInput.value) || 0;
  const collections = paid > 0 ? [{ date: transactionDate, amount: paid, note: "Hızlı girişte peşinat" }] : [];
  const paymentDueDate = getEffectivePaymentDueDate(
    transactionDate,
    quickPaymentPlanSelect.value,
    quickDueDateInput.value
  );

  try {
    await upsertTransaction(customer, {
      date: transactionDate,
      items,
      amount,
      stage: "created",
      note: quickNoteInput.value,
      collections,
      paymentDueDate,
    });

    selectedCustomerId = customer.id;
    rememberRecentCustomer(selectedCustomerId);
    render();
    quickTransactionForm.reset();
    resetProductRows(quickProductRows, "quick");
    quickDateInput.value = TODAY;
    quickPaymentPlanSelect.value = "0";
    quickDueDateInput.value = "";
    quickDueDateInput.dataset.autoDueDate = "";
    quickAmountInput.value = "";
    quickPaidInput.value = "0";
    setQuickCustomer(customer);
    showToast(`${customer.name} için ${formatCurrency(amount)} tutarında işlem eklendi.`, "success");
  } catch (error) {
    showToast(error.message || "İşlem kaydedilemedi.", "error");
  }
});

searchInput.addEventListener("input", renderCustomers);
letterFilter.addEventListener("change", renderCustomers);
quickCustomerSelect?.addEventListener("click", () => openCustomerPickerDialog("quick"));
quickCustomerSelect?.addEventListener("focus", () => quickCustomerSelect.blur());
openCustomerPickerButton?.addEventListener("click", () => openCustomerPickerDialog("quick"));
closeCustomerPickerDialogButton?.addEventListener("click", () => customerPickerDialog?.close());
customerPickerSearchInput?.addEventListener("input", () => {
  renderCustomerPickerResults(customerPickerSearchInput.value);
});
customerPickerResults?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-picker-customer]");
  if (!button) return;
  const customer = getCustomerById(button.dataset.pickerCustomer);
  if (!customer) return;
  if (customerPickerMode === "editor") {
    selectedCustomerId = customer.id;
    populateCustomerEditorForm(customer);
    render();
  } else {
    setQuickCustomer(customer, { syncSelectedCustomer: true });
    rememberRecentCustomer(customer.id);
    renderRecentCustomers();
  }
  customerPickerDialog?.close();
});
quickRecentCustomers?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-recent-customer]");
  if (!button) return;
  const customer = getCustomerById(button.dataset.recentCustomer);
  if (!customer) return;
  selectedCustomerId = customer.id;
  setQuickCustomer(customer);
  rememberRecentCustomer(customer.id);
  render();
});
historyFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeHistoryFilter = button.dataset.historyFilter;
    renderGlobalHistory();
  });
});
dailyFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeDailyFilter = button.dataset.dailyFilter;
    renderDailyOperationsBoard();
  });
});
summaryYearFilter?.addEventListener("change", () => {
  activeSummaryYear = summaryYearFilter.value || TODAY.slice(0, 4);
  render();
});

customerList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  selectedCustomerId = button.dataset.id;
  rememberRecentCustomer(selectedCustomerId);
  render();
  // Telefonda detay listenin altında kalıyor: seçince detaya kaydır.
  if (window.matchMedia("(max-width: 980px)").matches) {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    detailName.closest(".card")?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  }
});

debtWatchList?.addEventListener("click", (event) => {
  const focusButton = event.target.closest("[data-customer-focus]");
  if (!focusButton) return;
  selectedCustomerId = focusButton.dataset.customerFocus;
  rememberRecentCustomer(selectedCustomerId);
  render();
  switchView("musteriler");
});

urgentWatchList?.addEventListener("click", (event) => {
  const focusButton = event.target.closest("[data-customer-focus]");
  if (focusButton) {
    selectedCustomerId = focusButton.dataset.customerFocus;
    rememberRecentCustomer(selectedCustomerId);
    render();
    switchView("musteriler");
    return;
  }

  handleTransactionListClick(event);
});

quickOrderButton.addEventListener("click", () => openTransactionDialog());
openAddCustomerDialogButton?.addEventListener("click", () => {
  openCustomerAddDialog();
});
openEditCustomerDialogButton?.addEventListener("click", () => {
  const customer = getCustomerById(selectedCustomerId);
  openCustomerEditorDialog(customer);
});
closeCustomerAddDialogButton?.addEventListener("click", () => customerAddDialog?.close());
openCustomerEditorPickerButton?.addEventListener("click", () => openCustomerPickerDialog("editor"));
customerEditorPickerNameInput?.addEventListener("click", () => openCustomerPickerDialog("editor"));
closeCustomerEditorDialogButton?.addEventListener("click", () => customerEditorDialog?.close());
customerAddForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = customerAddNameInput.value.trim();

  if (!name) {
    showToast("Müşteri adı zorunlu.", "warning");
    return;
  }

  const existing = state.customers.find(
    (customer) => customer.name.toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR")
  );

  if (existing) {
    selectedCustomerId = String(existing.id);
    rememberRecentCustomer(selectedCustomerId);
    render();
    customerAddDialog?.close();
    openCustomerEditorDialog(existing);
    showToast("Bu isimde müşteri zaten kayıtlı — düzenleme paneli açıldı.", "info");
    return;
  }

  try {
    if (isApiEnabled()) {
      const response = await apiRequest("customers.php", {
        method: "POST",
        data: {
          name,
          contact_person: customerAddContactPersonInput.value.trim(),
          phone: customerAddPhoneInput.value.trim(),
          tax_number: customerAddTaxNumberInput.value.trim(),
          address: customerAddAddressInput.value.trim(),
          note: customerAddNoteInput.value.trim(),
        },
      });
      await reloadStateFromApi({ silent: true });
      selectedCustomerId = String(response.customer?.id || selectedCustomerId);
      rememberRecentCustomer(selectedCustomerId);
      render();
      resetCustomerAddForm();
      customerAddDialog?.close();
      showToast("Müşteri eklendi.", "success");
      return;
    }

    const newCustomer = {
      id: crypto.randomUUID(),
      name,
      contactPerson: customerAddContactPersonInput.value.trim(),
      phone: customerAddPhoneInput.value.trim(),
      taxNumber: customerAddTaxNumberInput.value.trim(),
      address: customerAddAddressInput.value.trim(),
      note: customerAddNoteInput.value.trim(),
      transactions: [],
      rollovers: [],
      ledgerEntries: [],
    };

    state.customers.push(newCustomer);
    selectedCustomerId = newCustomer.id;
    rememberRecentCustomer(selectedCustomerId);
    persist();
    render();
    resetCustomerAddForm();
    customerAddDialog?.close();
    showToast("Müşteri eklendi.", "success");
  } catch (error) {
    showToast(error.message || "Müşteri eklenemedi.", "error");
  }
});
customerEditorForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const customerId = customerEditorIdInput.value.trim();
  const currentCustomer = getCustomerById(customerId);
  const name = customerEditorNameInput.value.trim() || currentCustomer?.name || "";

  if (!customerId) {
    showToast("Önce listeden bir müşteri seçmelisin.", "warning");
    return;
  }

  try {
    if (isApiEnabled()) {
      const response = await apiRequest("customers.php", {
        method: "PUT",
        data: {
          id: customerId,
          name,
          contact_person: customerEditorContactPersonInput.value.trim(),
          phone: customerEditorPhoneInput.value.trim(),
          tax_number: customerEditorTaxNumberInput.value.trim(),
          address: customerEditorAddressInput.value.trim(),
          note: customerEditorNoteInput.value.trim(),
        },
      });
      await reloadStateFromApi({ silent: true });
      selectedCustomerId = String(response.customer?.id || customerId || selectedCustomerId);
      rememberRecentCustomer(selectedCustomerId);
      render();
      const nextCustomer = getCustomerById(selectedCustomerId);
      if (nextCustomer) populateCustomerEditorForm(nextCustomer);
      customerEditorDialog?.close();
      showToast("Müşteri bilgileri güncellendi.", "success");
      return;
    }

    const customer = getCustomerById(customerId);
    if (!customer) throw new Error("Müşteri bulunamadı.");

    customer.name = name;
    customer.contactPerson = customerEditorContactPersonInput.value.trim();
    customer.phone = customerEditorPhoneInput.value.trim();
    customer.taxNumber = customerEditorTaxNumberInput.value.trim();
    customer.address = customerEditorAddressInput.value.trim();
    customer.note = customerEditorNoteInput.value.trim();

    selectedCustomerId = customerId;
    rememberRecentCustomer(selectedCustomerId);
    persist();
    render();
    populateCustomerEditorForm(customer);
    customerEditorDialog?.close();
    showToast("Müşteri bilgileri güncellendi.", "success");
  } catch (error) {
    showToast(error.message || "Müşteri güncellenemedi.", "error");
  }
});
openRolloverDialogButton?.addEventListener("click", () => {
  customerActionsDialog?.close();
  openRolloverDialog();
});
printCustomerReportButton.addEventListener("click", () => {
  customerActionsDialog?.close();
  printCustomerReport();
});
downloadCustomerReportButton?.addEventListener("click", () => {
  customerActionsDialog?.close();
  downloadCustomerReport();
});
deleteCustomerButton.addEventListener("click", async () => {
  customerActionsDialog?.close();
  try {
    await deleteSelectedCustomer();
  } catch (error) {
    showToast(error.message || "Müşteri silinemedi.", "error");
  }
});
toggleCustomerActionsButton?.addEventListener("click", () => {
  customerActionsDialog?.showModal();
});
closeDialogButton.addEventListener("click", () => transactionDialog.close());
closeCollectionDialogButton.addEventListener("click", () => collectionDialog.close());
markDeliveredWithoutPaymentButton?.addEventListener("click", async () => {
  try {
    await markTransactionDeliveredWithoutPayment(collectionTransactionIdInput.value);
    render();
    showToast("Teslim edildi olarak işaretlendi, ödeme açık kaldı.", "success");
  } catch (error) {
    showToast(error.message || "Teslim bilgisi kaydedilemedi.", "error");
  }
});
openSettingsDialogButton?.addEventListener("click", () => {
  renderBrandSettingsPanel();
  settingsDialog?.showModal();
});
closeSettingsDialogButton?.addEventListener("click", () => settingsDialog?.close());

businessNameInput?.addEventListener("change", () => {
  updateBrandSettings({ businessName: businessNameInput.value.trim() });
});
brandLogoUploadButton?.addEventListener("click", () => brandLogoInput?.click());
brandLogoInput?.addEventListener("change", async () => {
  const file = brandLogoInput.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImageFile(file, 300);
    updateBrandSettings({ logoDataUrl: dataUrl });
    showToast("Logo güncellendi.", "success");
  } catch (error) {
    showToast(error.message || "Logo yüklenemedi.", "error");
  } finally {
    brandLogoInput.value = "";
  }
});
brandLogoRemoveButton?.addEventListener("click", () => {
  updateBrandSettings({ logoDataUrl: null });
});
brandResetButton?.addEventListener("click", async () => {
  const approved = await confirmAction("İşletme adı ve logo varsayılana dönsün mü?", { confirmLabel: "Evet, sıfırla" });
  if (!approved) return;
  clearBrandSettings();
  applyBrandSettings();
  syncDueNotifications();
  renderBrandSettingsPanel();
  showToast("Varsayılan görünüme dönüldü.", "success");
});

// ===== Alt sekme (view) navigasyonu =====
const appViews = document.querySelectorAll("[data-view]");
const bottomNavButtons = document.querySelectorAll("[data-nav-target]");

function switchView(target) {
  let matched = false;
  appViews.forEach((view) => {
    const isActive = view.dataset.view === target;
    view.classList.toggle("active", isActive);
    if (isActive) matched = true;
  });
  bottomNavButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.navTarget === target));
  if (matched) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

bottomNavButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.navTarget;
    if (target === "ayarlar") {
      renderBrandSettingsPanel();
      settingsDialog?.showModal();
      return;
    }
    switchView(target);
  });
});

ozetSearch?.addEventListener("input", renderOzet);
ozetTable?.addEventListener("click", (event) => {
  const pdfButton = event.target.closest("[data-ozet-pdf]");
  if (pdfButton) {
    viewCustomerReport(pdfButton.dataset.ozetPdf);
    return;
  }
  const button = event.target.closest("[data-ozet-islem]");
  if (!button) return;
  openIslemMenu(button.dataset.ozetIslem);
});

// ===== İşlem Yap menusu + cari hareket (tahsilat / ekstra borç) =====
const islemMenuDialog = document.querySelector("#islem-menu-dialog");
const islemMenuTitle = document.querySelector("#islem-menu-title");
const closeIslemMenuButton = document.querySelector("#close-islem-menu-dialog");
const tahsilatDialog = document.querySelector("#tahsilat-dialog");
const tahsilatForm = document.querySelector("#tahsilat-form");
const tahsilatAmountInput = document.querySelector("#tahsilat-amount");
const tahsilatNoteInput = document.querySelector("#tahsilat-note");
const tahsilatCustomerNameEl = document.querySelector("#tahsilat-customer-name");
const tahsilatPreviewEl = document.querySelector("#tahsilat-preview");
const closeTahsilatButton = document.querySelector("#close-tahsilat-dialog");

let islemMenuCustomerId = null;

function openIslemMenu(customerId) {
  islemMenuCustomerId = customerId;
  const customer = getCustomerById(customerId);
  if (islemMenuTitle) {
    islemMenuTitle.textContent = customer ? customer.name : "İşlem Yap";
  }
  islemMenuDialog?.showModal();
}

function goToCustomerOpenItems(customerId) {
  selectedCustomerId = customerId;
  rememberRecentCustomer(selectedCustomerId);
  render();
  switchView("musteriler");
  const openPanel = document.querySelector("#customer-panel-open");
  if (openPanel) {
    setTimeout(() => openPanel.scrollIntoView({ behavior: "smooth", block: "start" }), 220);
  }
}

let tahsilatCustomerId = null;

function openTahsilatDialog(customerId) {
  const customer = getCustomerById(customerId);
  if (!customer) return;
  tahsilatCustomerId = customerId;
  if (tahsilatCustomerNameEl) tahsilatCustomerNameEl.textContent = customer.name;
  if (tahsilatAmountInput) { tahsilatAmountInput.value = ""; }
  if (tahsilatNoteInput) { tahsilatNoteInput.value = ""; }
  if (tahsilatPreviewEl) { tahsilatPreviewEl.style.display = "none"; tahsilatPreviewEl.textContent = ""; }
  tahsilatDialog?.showModal();
}

closeIslemMenuButton?.addEventListener("click", () => islemMenuDialog?.close());
closeTahsilatButton?.addEventListener("click", () => tahsilatDialog?.close());

islemMenuDialog?.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-islem-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.islemAction;
  const customerId = islemMenuCustomerId;
  islemMenuDialog.close();
  if (action === "tahsilat") {
    openTahsilatDialog(customerId);
  } else if (action === "devir") {
    selectedCustomerId = customerId;
    openRolloverDialog();
  }
});

tahsilatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = parseFloat(tahsilatAmountInput.value);
  const note = tahsilatNoteInput?.value?.trim() || null;

  if (!tahsilatCustomerId || isNaN(amount) || amount <= 0) {
    showToast("Geçerli bir tutar girin.", "warning");
    return;
  }

  const customer = getCustomerById(tahsilatCustomerId);
  if (!customer) return;

  const openTransactions = customer.transactions
    .filter((t) => Math.max(t.amount - t.paid, 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  let remaining = amount;
  let collectedTotal = 0;
  for (const t of openTransactions) {
    if (remaining <= 0) break;
    const openAmount = Math.max(t.amount - t.paid, 0);
    const toCollect = Math.min(remaining, openAmount);
    t.stage = "delivered";
    t.delivered = true;
    t.collections = [
      ...(t.collections || []),
      { id: crypto.randomUUID(), date: TODAY, amount: toCollect, note: note || "" },
    ];
    t.paid = getCollectionTotal(t.collections);
    t.fullyPaid = t.paid >= t.amount && t.amount > 0;
    remaining -= toCollect;
    collectedTotal += toCollect;
  }

  persist();
  render();
  tahsilatDialog?.close();

  if (collectedTotal <= 0) {
    showToast("Bu müşterinin açık işlemi yok, tahsilat dağıtılamadı.", "warning");
  } else if (remaining > 0.001) {
    showToast(`${formatCurrency(collectedTotal)} tahsil edildi. ${formatCurrency(remaining)} dağıtılamadı.`, "warning");
  } else {
    showToast(`${formatCurrency(collectedTotal)} tahsil edildi.`, "success");
  }
});


closeCustomerActionsDialogButton?.addEventListener("click", () => customerActionsDialog?.close());
openCatalogDialogButton.addEventListener("click", openCatalogDialog);
closeCatalogDialogButton.addEventListener("click", () => catalogDialog.close());
closeRolloverDialogButton?.addEventListener("click", () => rolloverDialog.close());
closeRolloverCollectionDialogButton?.addEventListener("click", () => rolloverCollectionDialog.close());
enableNotificationsButton?.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("Bu tarayıcı bildirim özelliğini desteklemiyor.", "warning");
    return;
  }

  const permission = await Notification.requestPermission();
  updateNotificationButtonLabel();

  if (permission === "granted") {
    syncDueNotifications();
    return;
  }

  showToast("Bildirim izni verilmezse uyarılar yalnızca panel içinde görünür.", "info");
});
exportBackupButton?.addEventListener("click", downloadBackup);
importBackupButton?.addEventListener("click", () => importBackupInput?.click());
importBackupInput?.addEventListener("change", (event) => {
  importBackupFile(event.target.files?.[0]);
});
rolloverSourceYearSelect?.addEventListener("change", updateRolloverPreview);

addProductRowButton.addEventListener("click", () => {
  addProductRow(productRows, "dialog");
  updateFormAmountFromRows(productRows, amountInput);
});
quickAddProductRowButton.addEventListener("click", () => {
  addProductRow(quickProductRows, "quick");
  updateFormAmountFromRows(quickProductRows, quickAmountInput);
});

function handleProductRowContainerClick(event, container, scope) {
  const removeButton = event.target.closest('[data-role="remove-product-row"]');
  if (!removeButton) return;
  const row = removeButton.closest("[data-product-row]");
  if (!row) return;
  row.remove();
  ensureAtLeastOneProductRow(container, scope);
  if (container === productRows) updateFormAmountFromRows(productRows, amountInput);
  if (container === quickProductRows) updateFormAmountFromRows(quickProductRows, quickAmountInput);
}

productRows.addEventListener("click", (event) => handleProductRowContainerClick(event, productRows, "dialog"));
quickProductRows.addEventListener("click", (event) => handleProductRowContainerClick(event, quickProductRows, "quick"));
productRows.addEventListener("input", () => updateFormAmountFromRows(productRows, amountInput));
quickProductRows.addEventListener("input", () => updateFormAmountFromRows(quickProductRows, quickAmountInput));
productRows.addEventListener("change", () => updateFormAmountFromRows(productRows, amountInput));
quickProductRows.addEventListener("change", () => updateFormAmountFromRows(quickProductRows, quickAmountInput));
transactionDateInput.addEventListener("change", () => {
  dialogDateChip.textContent = `İşlem günü: ${formatDate(transactionDateInput.value || TODAY)}`;
  updateDialogDueDate();
});
quickDateInput?.addEventListener("change", updateQuickDueDate);
quickPaymentPlanSelect?.addEventListener("change", updateQuickDueDate);
transactionPaymentPlanSelect?.addEventListener("change", updateDialogDueDate);
resetProductRows(productRows, "dialog");
resetProductRows(quickProductRows, "quick");
updateFormAmountFromRows(productRows, amountInput);
updateFormAmountFromRows(quickProductRows, quickAmountInput);
updateQuickDueDate();
updateDialogDueDate();

quickCollectButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const customer = getCustomerById(selectedCustomerId);
    const transaction = getTransactionById(customer, collectionTransactionIdInput.value);
    if (!transaction) return;

    const remaining = Math.max(transaction.amount - transaction.paid, 0);
    const ratio = Number(button.dataset.ratio) || 0;
    collectionAmountInput.value = (remaining * ratio).toFixed(2);
  });
});

async function handleTransactionListClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const transactionId = actionButton.dataset.id;
  const ownerCustomerId = actionButton.dataset.customerId || selectedCustomerId;
  if (ownerCustomerId) selectedCustomerId = ownerCustomerId;

  if (actionButton.dataset.action === "edit-transaction") {
    openTransactionDialog(transactionId);
    render();
  }

  if (actionButton.dataset.action === "deliver-transaction") {
    const customer = getCustomerById(selectedCustomerId);
    const transaction = getTransactionById(customer, transactionId);
    if (transaction?.stage === "delivered") return;
    openCollectionDialog(transactionId);
    render();
  }

  if (actionButton.dataset.action === "collect-transaction") {
    openCollectionDialog(transactionId);
    render();
  }

  if (actionButton.dataset.action === "delete-transaction") {
    try {
      await deleteTransaction(transactionId);
    } catch (error) {
      showToast(error.message || "İşlem silinemedi.", "error");
    }
  }
}

todayTransactionList.addEventListener("click", handleTransactionListClick);
futureTransactionList.addEventListener("click", handleTransactionListClick);
transactionList.addEventListener("click", handleTransactionListClick);
dailyOperationsList.addEventListener("click", handleTransactionListClick);

customerCollections.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-action='delete-collection']");
  if (!btn) return;
  try {
    await deleteCollection(btn.dataset.id, btn.dataset.collectionType);
  } catch (error) {
    showToast(error.message || "Tahsilat silinemedi.", "error");
  }
});

customerHistory.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  if (actionButton.dataset.customerId) {
    selectedCustomerId = actionButton.dataset.customerId;
  }

  if (actionButton.dataset.action === "edit-history-transaction") {
    openTransactionDialog(actionButton.dataset.id);
    return;
  }

  if (actionButton.dataset.action === "delete-history-transaction") {
    try {
      await deleteTransaction(actionButton.dataset.id);
    } catch (error) {
      showToast(error.message || "Kayıt silinemedi.", "error");
    }
  }
});

globalHistory.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const transactionId = actionButton.dataset.id;
  const owner =
    (actionButton.dataset.customerId && getCustomerById(actionButton.dataset.customerId)) ||
    state.customers.find((customer) => customer.transactions.some((transaction) => transaction.id === transactionId));
  if (!owner) return;
  selectedCustomerId = owner.id;

  if (actionButton.dataset.action === "edit-history-transaction") {
    openTransactionDialog(transactionId);
    render();
    return;
  }

  if (actionButton.dataset.action === "delete-history-transaction") {
    try {
      await deleteTransaction(transactionId);
    } catch (error) {
      showToast(error.message || "Kayıt silinemedi.", "error");
    }
  }
});

customerRollovers?.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  if (actionButton.dataset.action === "edit-rollover") {
    openRolloverDialog(actionButton.dataset.id);
    return;
  }

  if (actionButton.dataset.action === "collect-rollover") {
    openRolloverCollectionDialog(actionButton.dataset.id);
    return;
  }

  if (actionButton.dataset.action === "delete-rollover") {
    try {
      await deleteRollover(actionButton.dataset.id);
    } catch (error) {
      showToast(error.message || "Devir kaydı silinemedi.", "error");
    }
  }
});

transactionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const customer = getCustomerById(selectedCustomerId);
  if (!customer) return;

  const items = getSelectedItemsFromForm();
  if (!items.length) {
    showToast("En az bir ürün seçip adet girmelisin.", "warning");
    return;
  }

  const formData = new FormData(transactionForm);
  const existingTransaction = getTransactionById(customer, formData.get("transactionId"));
  const transactionDate = formData.get("transactionDate") || TODAY;
  const paidValue = Number(formData.get("paid")) || 0;
  const collections = buildCollectionsForManualSave(existingTransaction, paidValue, transactionDate);
  const paymentDueDate = getEffectivePaymentDueDate(
    transactionDate,
    formData.get("paymentPlan"),
    formData.get("paymentDueDate")
  );

  try {
    await upsertTransaction(customer, {
      id: formData.get("transactionId") || undefined,
      date: transactionDate,
      items,
      amount: formData.get("amount"),
      stage: formData.get("stage"),
      note: formData.get("note"),
      collections,
      paymentDueDate,
    });

    render();
    transactionDialog.close();
    showToast("İşlem kaydedildi.", "success");
  } catch (error) {
    showToast(error.message || "İşlem kaydedilemedi.", "error");
  }
});

collectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(collectionForm);
  try {
    await applyCollection(
      formData.get("transactionId"),
      formData.get("collectionAmount"),
      formData.get("collectionNote")
    );
  } catch (error) {
    showToast(error.message || "Tahsilat kaydedilemedi.", "error");
  }
});

rolloverForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const customer = getCustomerById(selectedCustomerId);
  if (!customer) return;

  const formData = new FormData(rolloverForm);
  const rolloverId = String(formData.get("rolloverId") || "");
  const sourceYear = String(formData.get("sourceYear") || "");
  const targetYear = String(formData.get("targetYear") || "");
  const amount = Number(formData.get("amount")) || 0;
  const note = String(formData.get("note") || "").trim();

  if (!sourceYear || !targetYear || sourceYear === targetYear) {
    showToast("Kaynak ve hedef yıl farklı olmalı.", "warning");
    return;
  }

  if (Number(targetYear) <= Number(sourceYear)) {
    showToast("Hedef yıl kaynak yıldan büyük olmalı.", "warning");
    return;
  }

  if (amount <= 0) {
    showToast("Devir bakiye sıfırdan büyük olmalı.", "warning");
    return;
  }

  const existingConflict = (customer.rollovers || []).find(
    (rollover) => rollover.sourceYear === sourceYear && rollover.id !== rolloverId
  );
  if (existingConflict) {
    showToast("Bu kaynak yıl için zaten bir devir kaydı var.", "warning");
    return;
  }

  try {
    if (isApiEnabled()) {
      await apiRequest("rollovers.php", {
        method: rolloverId ? "PUT" : "POST",
        data: {
          id: rolloverId ? getNumericId(rolloverId) : undefined,
          customer_id: getNumericId(customer.id),
          source_year: Number(sourceYear),
          target_year: Number(targetYear),
          amount,
          note,
        },
      });
      await reloadStateFromApi({ silent: true });
      render();
      rolloverDialog.close();
      return;
    }

    const rolloverData = {
      id: rolloverId || crypto.randomUUID(),
      sourceYear,
      targetYear,
      amount,
      note,
      collectionMovements: [],
      collected: 0,
      createdAt: new Date().toISOString(),
    };

    if (rolloverId) {
      const existing = getRolloverById(customer, rolloverId);
      if (existing) {
        rolloverData.collectionMovements = existing.collectionMovements || [];
        rolloverData.collected = Math.max(Math.min(getCollectionTotal(rolloverData.collectionMovements), amount), 0);
      }
      const idx = (customer.rollovers || []).findIndex((r) => r.id === rolloverId);
      if (idx >= 0) customer.rollovers[idx] = rolloverData;
      else customer.rollovers = [...(customer.rollovers || []), rolloverData];
    } else {
      customer.rollovers = [...(customer.rollovers || []), rolloverData];
    }

    persist();
    render();
    rolloverDialog.close();
    showToast("Devir kaydı kaydedildi.", "success");
  } catch (error) {
    showToast(error.message || "Devir kaydı kaydedilemedi.", "error");
  }
});

rolloverCollectionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(rolloverCollectionForm);
  try {
    await applyRolloverCollection(
      formData.get("rolloverId"),
      formData.get("amount"),
      formData.get("date"),
      formData.get("note")
    );
  } catch (error) {
    showToast(error.message || "Devir tahsilatı kaydedilemedi.", "error");
  }
});

brandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const brandName = brandNameInput.value.trim();
  if (!brandName) {
    showToast("Marka adı boş olamaz.", "warning");
    return;
  }
  try {
    await addBrand(brandName);
    brandForm.reset();
  } catch (error) {
    showToast(error.message || "Marka eklenemedi.", "error");
  }
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const brandName = productBrandSelect.value;
  const productName = productNameInput.value.trim();
  if (!brandName || !productName) {
    showToast("Marka ve ürün adını birlikte girmelisin.", "warning");
    return;
  }
  try {
    await addProductToCatalog(brandName, productName);
    productForm.reset();
    populateCatalogBrandOptions();
    productBrandSelect.value = brandName;
  } catch (error) {
    showToast(error.message || "Ürün eklenemedi.", "error");
  }
});

catalogList.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  if (actionButton.dataset.action === "delete-brand") {
    try {
      await deleteBrand(actionButton.dataset.brand);
    } catch (error) {
      showToast(error.message || "Marka silinemedi.", "error");
    }
  }
  if (actionButton.dataset.action === "delete-product") {
    try {
      await deleteProductFromCatalog(actionButton.dataset.brand, actionButton.dataset.product);
    } catch (error) {
      showToast(error.message || "Ürün silinemedi.", "error");
    }
  }
});

window.addEventListener("focus", () => {
  syncDueNotifications();
  if (isApiEnabled() && activeUser) {
    reloadStateFromApi({ silent: true });
  }
});
document.addEventListener("click", (event) => {
  if (!customerActionsDialog?.open) return;
  if (customerActionsDialog.contains(event.target) || toggleCustomerActionsButton?.contains(event.target)) return;
  customerActionsDialog.close();
});

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = authUsernameInput?.value.trim() || "";
  const password = authPasswordInput?.value || "";
  if (!username || !password) {
    setAuthFeedback("Kullanıcı adı ve şifre zorunlu.", "error");
    return;
  }
  try {
    setAuthFeedback("Giriş kontrol ediliyor...", "success");
    await loginWithCredentials(username, password);
    setAuthFeedback("");
    await reloadStateFromApi({ silent: true });
    startApiAutoSync();
    render();
    authForm.reset();
  } catch (error) {
    setAuthFeedback(error.message || "Giriş başarısız.", "error");
  }
});

logoutButton?.addEventListener("click", async () => {
  await logoutSession();
});

initTopbarHandle();
initializeApplication();

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select, [contenteditable]')) return;
  if (document.querySelector('dialog[open]')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !e.shiftKey && !e.altKey) {
    const views = { '1': 'operasyon', '2': 'musteriler', '3': 'ozet', '4': 'kontrol', '5': 'ayarlar' };
    if (views[e.key]) { e.preventDefault(); switchView(views[e.key]); }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTransactionDialog(); }
  }
});

(function initTrackSlideIndicators() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const groups = [
    { panel: '.customer-operation-panel', track: '.customer-operation-track', slide: '.customer-operation-slide', label: 'Müşteri işlem panelleri' },
    { panel: '.ledger-detail-panel', track: '.ledger-detail-track', slide: '.ledger-detail-slide', label: 'Cari hesap detay panelleri' },
  ];

  groups.forEach(({ panel, track, slide, label }) => {
    const panelEl = document.querySelector(panel);
    const trackEl = panelEl?.querySelector(track);
    const slides = trackEl ? [...trackEl.querySelectorAll(slide)] : [];
    if (!panelEl || !trackEl || slides.length < 2) return;

    const dots = document.createElement('div');
    dots.className = 'track-dots';
    dots.setAttribute('role', 'tablist');
    dots.setAttribute('aria-label', label);

    const buttons = slides.map((slideEl, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'track-dot';
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `${index + 1}. bölüme git`);
      dot.addEventListener('click', () => {
        slideEl.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
      });
      dots.appendChild(dot);
      return dot;
    });

    panelEl.appendChild(dots);

    const setActive = (activeIndex) => {
      buttons.forEach((dot, index) => {
        const isActive = index === activeIndex;
        dot.classList.toggle('active', isActive);
        dot.setAttribute('aria-selected', String(isActive));
      });
    };
    setActive(0);

    let frame = null;
    trackEl.addEventListener('scroll', () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const trackLeft = trackEl.getBoundingClientRect().left;
        let closestIndex = 0;
        let closestDistance = Infinity;
        slides.forEach((slideEl, index) => {
          const distance = Math.abs(slideEl.getBoundingClientRect().left - trackLeft);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
          }
        });
        setActive(closestIndex);
      });
    }, { passive: true });
  });
})();

(function initDemoBanner() {
  const banner = document.getElementById('demo-banner');
  if (!banner) return;
  if (isApiEnabled() || localStorage.getItem('trackdesk-welcome-seen')) {
    banner.remove();
    return;
  }
  document.getElementById('dismiss-demo-banner')?.addEventListener('click', () => {
    localStorage.setItem('trackdesk-welcome-seen', '1');
    banner.classList.add('demo-banner--out');
    banner.addEventListener('transitionend', () => banner.remove(), { once: true });
  });
})();
