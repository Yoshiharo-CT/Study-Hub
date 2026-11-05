// ============================================================
// Study Hub front-desk app.
// Every panel loads its data lazily the first time its tab is
// opened, then is refreshed after any action inside that panel.
// ============================================================

const API = {
  auth: `${baseApiUrl}/auth.php`,
  customers: `${baseApiUrl}/customers.php`,
  staff: `${baseApiUrl}/staff.php`,
  spaces: `${baseApiUrl}/spaces.php`,
  reservations: `${baseApiUrl}/reservations.php`,
  sessions: `${baseApiUrl}/sessions.php`,
  walkin: `${baseApiUrl}/walkin.php`,
  products: `${baseApiUrl}/products.php`,
  orders: `${baseApiUrl}/orders.php`,
  promotions: `${baseApiUrl}/promotions.php`,
  billing: `${baseApiUrl}/billing.php`,
  payments: `${baseApiUrl}/payments.php`,
  notifications: `${baseApiUrl}/notifications.php`,
  reports: `${baseApiUrl}/reports.php`,
};
const ACTIVE_PANEL_KEY = "study-hub-active-panel";

async function call(url, operation, params = {}) {
  return apiClient.post(url, toFormData({ operation, ...params }));
}

function peso(n) {
  return Number(n || 0).toFixed(2);
}

function badge(status) {
  return `<span class="badge ${status}">${status.replace("_", " ")}</span>`;
}

function setMsg(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? "#22c55e" : "#ef4444";
}

let ME = null; // current staff session

// ---------------- Bootstrap ----------------
(async function init() {
  const res = await call(API.auth, "me");
  if (!res.data.success || res.data.account_type !== "staff") {
    window.location.href = "login.html";
    return;
  }
  ME = res.data.staff;
  const staffName = `${ME.first_name || ""} ${ME.last_name || ""}`.trim();
  document.getElementById("staff-name-badge").textContent =
    staffName || "Staff member";
  document.getElementById("staff-role-badge").textContent =
    ME.role_name || "Staff";
  document.getElementById("staff-avatar").textContent =
    staffName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((namePart) => namePart[0])
      .join("")
      .toUpperCase() || "S";

  applyPermissions();
  wireTabs();
  wireForms();

  let savedPanel = null;
  try {
    savedPanel = sessionStorage.getItem(ACTIVE_PANEL_KEY);
  } catch {}
  const savedButton = [...document.querySelectorAll(".tab-btn")].find(
    (button) =>
      button.dataset.target === savedPanel &&
      !button.classList.contains("hidden"),
  );
  const firstVisibleButton = document.querySelector(".tab-btn:not(.hidden)");
  const initialPanel =
    savedButton?.dataset.target ||
    firstVisibleButton?.dataset.target ||
    "panel-dashboard";

  await Promise.all([
    loadDashboard(),
    loadCustomerOptions(),
    loadSpaceOptions(),
    loadStaffOptions(),
  ]);

  if (initialPanel !== "panel-dashboard") switchTab(initialPanel);
})();

function applyPermissions() {
  const perms = (ME.permissions || "").split(",").map((p) => p.trim());
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const perm = btn.dataset.perm;
    if (perm && !perms.includes(perm)) btn.classList.add("hidden");
  });
}

function wireTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.target));
  });
  document.getElementById("btn-logout").addEventListener("click", async () => {
    await call(API.auth, "logout");
    window.location.href = "login.html";
  });
}

const PANEL_LOADERS = {
  "panel-dashboard": loadDashboard,
  "panel-customers": loadCustomers,
  "panel-spaces": loadSpacesPanel,
  "panel-maintenance": loadMaintenance,
  "panel-reservations": loadReservations,
  "panel-walkins": loadWalkins,
  "panel-sessions": loadSessions,
  "panel-orders": loadOrdersPanel,
  "panel-promotions": loadPromotions,
  "panel-billing": loadBilling,
  "panel-payments": loadPayments,
  "panel-staff": loadStaffPanel,
  "panel-reports": () => {},
  "panel-notifications": loadNotifications,
};

function switchTab(target) {
  const panel = document.getElementById(target);
  const button = [...document.querySelectorAll(".tab-btn")].find(
    (item) => item.dataset.target === target,
  );
  if (!panel || !button || button.classList.contains("hidden")) return;

  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.target === target));
  document
    .querySelectorAll(".panel")
    .forEach((p) => p.classList.toggle("active", p.id === target));
  try {
    sessionStorage.setItem(ACTIVE_PANEL_KEY, target);
  } catch {}
  const loader = PANEL_LOADERS[target];
  if (loader) loader();
}

// ============================================================
// Shared dropdown data
// ============================================================
let CUSTOMERS = [];
let SPACES = [];
let SPACE_TYPES = [];
let STAFF_LIST = [];
let PRODUCTS = [];

async function loadCustomerOptions() {
  const res = await call(API.customers, "list");
  CUSTOMERS = res.data.data || [];
  const opts = CUSTOMERS.map(
    (c) =>
      `<option value="${c.customer_id}">${c.first_name} ${c.last_name} (#${c.customer_id})</option>`,
  ).join("");
  [
    "res-customer",
    "checkin-customer",
    "order-customer",
    "billing-customer",
    "payment-customer",
    "walkin-customer",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<option value="">Select customer…</option>` + opts;
  });
}

async function loadSpaceOptions() {
  const [typesRes, spacesRes] = await Promise.all([
    call(API.spaces, "listTypes"),
    call(API.spaces, "listSpaces"),
  ]);
  SPACE_TYPES = typesRes.data.data || [];
  SPACES = spacesRes.data.data || [];

  const typeOpts = SPACE_TYPES.map(
    (t) =>
      `<option value="${t.space_type_id}">${t.type_name} (₱${peso(t.base_rate)}/hr)</option>`,
  ).join("");
  const spaceOpts = SPACES.map(
    (s) =>
      `<option value="${s.space_id}">${s.space_name} — ${s.type_name} (${s.status})</option>`,
  ).join("");

  ["space-type-select"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = typeOpts;
  });
  ["walkin-type"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<option value="">Select type…</option>` + typeOpts;
  });
  ["res-space", "checkin-space", "maint-space"].forEach((id) => {
    const el = document.getElementById(id);
    if (el)
      el.innerHTML = `<option value="">Select space…</option>` + spaceOpts;
  });
}

async function loadStaffOptions() {
  const [staffRes, rolesRes] = await Promise.all([
    call(API.staff, "list"),
    call(API.staff, "roles"),
  ]);
  STAFF_LIST = staffRes.data.data || [];
  const staffOpts = STAFF_LIST.map(
    (s) =>
      `<option value="${s.staff_id}">${s.first_name} ${s.last_name} (${s.role_name})</option>`,
  ).join("");
  const el = document.getElementById("order-staff");
  if (el) el.innerHTML = staffOpts;
  const roleOpts = (rolesRes.data.data || [])
    .map((r) => `<option value="${r.role_id}">${r.role_name}</option>`)
    .join("");
  const roleEl = document.getElementById("staff-role");
  if (roleEl) roleEl.innerHTML = roleOpts;
}

async function loadProductOptions() {
  const [catRes, prodRes, paperRes, printRes] = await Promise.all([
    call(API.products, "listCategories"),
    call(API.products, "listProducts"),
    call(API.products, "listPaperSizes"),
    call(API.products, "listPrintTypes"),
  ]);
  PRODUCTS = prodRes.data.data || [];
  const prodEl = document.getElementById("order-product");
  if (prodEl)
    prodEl.innerHTML = PRODUCTS.map(
      (p) =>
        `<option value="${p.product_id}">${p.item_name} — ₱${peso(p.unit_price)} (${p.category_name})</option>`,
    ).join("");
  const paperEl = document.getElementById("print-paper-size");
  if (paperEl)
    paperEl.innerHTML = (paperRes.data.data || [])
      .map((p) => `<option value="${p.paper_size_id}">${p.size_name}</option>`)
      .join("");
  const printEl = document.getElementById("print-type");
  if (printEl)
    printEl.innerHTML = (printRes.data.data || [])
      .map((p) => `<option value="${p.print_type_id}">${p.label}</option>`)
      .join("");
}

async function loadPaymentMethodOptions() {
  const res = await call(API.payments, "methods");
  const el = document.getElementById("payment-method");
  if (el)
    el.innerHTML = (res.data.data || [])
      .map(
        (m) =>
          `<option value="${m.payment_method_id}">${m.method_name}</option>`,
      )
      .join("");
}

async function loadBillingOptions(customerId) {
  const sessionEl = document.getElementById("billing-session-id");
  const orderEl = document.getElementById("billing-order-id");
  const promoEl = document.getElementById("billing-promo");
  sessionEl.innerHTML = '<option value="">Select checked-out session…</option>';
  orderEl.innerHTML = '<option value="">Select unbilled order…</option>';
  promoEl.innerHTML = '<option value="">No promotion</option>';
  if (!customerId) return;

  const res = await call(API.billing, "options", { customer_id: customerId });
  sessionEl.innerHTML += (res.data.sessions || [])
    .map(
      (s) =>
        `<option value="${s.session_id}">Session #${s.session_id} — ₱${peso(s.total_amount)} (${s.check_out_time})</option>`,
    )
    .join("");
  orderEl.innerHTML += (res.data.orders || [])
    .map(
      (o) =>
        `<option value="${o.order_id}">Order #${o.order_id} — ₱${peso(o.total_amount)} (${o.order_datetime})</option>`,
    )
    .join("");
  promoEl.innerHTML += (res.data.promotions || [])
    .map(
      (p) =>
        `<option value="${p.code}">${p.code} — ${p.discount_type === "percent" ? `${p.discount_value}% off` : `₱${peso(p.discount_value)} off`}</option>`,
    )
    .join("");
}

async function loadPaymentTransactions(customerId) {
  const transactionEl = document.getElementById("payment-transaction-id");
  const amountEl = document.getElementById("payment-amount");
  transactionEl.innerHTML =
    '<option value="">Select unpaid transaction…</option>';
  amountEl.value = "";
  if (!customerId) return;

  const res = await call(API.payments, "transactions", {
    customer_id: customerId,
  });
  transactionEl.innerHTML += (res.data.data || [])
    .map(
      (t) =>
        `<option value="${t.transaction_id}" data-balance="${t.balance_due}">Transaction #${t.transaction_id} — balance ₱${peso(t.balance_due)}</option>`,
    )
    .join("");
}

async function updateOrderSessionDisplay() {
  const customerId = val("order-customer");
  const display = document.getElementById("order-session-display");
  display.value = "";
  if (!customerId) return;
  const res = await call(API.orders, "activeSession", {
    customer_id: customerId,
  });
  const session = res.data.data;
  display.value = session
    ? `Session #${session.session_id} — ${session.space_name} (checked in ${session.check_in_time})`
    : "No active session; order will not be linked to one.";
}

async function updateCheckinReservationDisplay() {
  const display = document.getElementById("checkin-reservation-display");
  const customerId = val("checkin-customer");
  const spaceId = val("checkin-space");
  display.value = "No active reservation";
  if (!customerId || !spaceId) return;
  const res = await call(API.sessions, "checkInReservation", {
    customer_id: customerId,
    space_id: spaceId,
  });
  if (res.data.data) display.value = `Reservation #${res.data.data}`;
}

// ============================================================
// Dashboard (Phase 10.1)
// ============================================================
async function loadDashboard() {
  const [kpiRes, spacesRes] = await Promise.all([
    call(API.reports, "dashboard"),
    call(API.reports, "spaceAvailability"),
  ]);
  const k = kpiRes.data.data || {};
  document.getElementById("kpi-occupied").textContent = k.occupied ?? "–";
  document.getElementById("kpi-available").textContent = k.available ?? "–";
  document.getElementById("kpi-sessions").textContent =
    k.active_sessions ?? "–";
  document.getElementById("kpi-reservations").textContent =
    k.pending_reservations_today ?? "–";
  document.getElementById("kpi-waiting").textContent = k.waiting_walkins ?? "–";
  document.getElementById("kpi-revenue").textContent =
    "₱" + peso(k.today_revenue);

  const rows = spacesRes.data.data || [];
  document.getElementById("dashboard-spaces-table").innerHTML = rows
    .map(
      (s) => `
    <tr><td>${s.space_name}</td><td>${s.type_name}</td><td>${s.capacity}</td><td>₱${peso(s.base_rate)}</td><td>${badge(s.status)}</td></tr>
  `,
    )
    .join("");
}

// ============================================================
// Customers (Phase 1.1, 10.2 area)
// ============================================================
async function loadCustomers() {
  await loadCustomerOptions();
  document.getElementById("customers-table").innerHTML = CUSTOMERS.map(
    (c) => `
    <tr><td>${c.customer_id}</td><td>${c.first_name} ${c.last_name}</td><td>${c.phone_number}</td><td>${c.email}</td><td>${c.username ?? "—"}</td></tr>
  `,
  ).join("");
}

// ============================================================
// Spaces (Phase 0.3, 2.1, 10.3)
// ============================================================
async function loadSpacesPanel() {
  await loadSpaceOptions();
  document.getElementById("space-types-table").innerHTML = SPACE_TYPES.map(
    (t) => `
    <tr><td>${t.space_type_id}</td><td>${t.type_name}</td><td>₱${peso(t.base_rate)}</td><td>${t.default_capacity}</td><td>${t.description ?? ""}</td></tr>
  `,
  ).join("");
  document.getElementById("spaces-table").innerHTML = SPACES.map(
    (s) => `
    <tr>
      <td>${s.space_id}</td><td>${s.space_name}</td><td>${s.type_name}</td><td>${s.capacity}</td><td>₱${peso(s.base_rate)}</td>
      <td>${badge(s.status)}</td>
      <td>
        <select data-space="${s.space_id}" class="status-select">
          ${["available", "occupied", "reserved", "maintenance", "inactive"].map((st) => `<option value="${st}" ${st === s.status ? "selected" : ""}>${st}</option>`).join("")}
        </select>
      </td>
    </tr>
  `,
  ).join("");
  document.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      await call(API.spaces, "updateStatus", {
        space_id: sel.dataset.space,
        status: sel.value,
      });
      await loadSpacesPanel();
      await loadDashboard();
    });
  });
}

// ============================================================
// Maintenance (Phase 10.3, 11.2)
// ============================================================
async function loadMaintenance() {
  const res = await call(API.spaces, "listMaintenance");
  document.getElementById("maintenance-table").innerHTML = (res.data.data || [])
    .map(
      (m) => `
    <tr>
      <td>${m.maintenance_id}</td><td>${m.space_name}</td><td>${m.start_datetime}</td><td>${m.end_datetime}</td>
      <td>${m.reason ?? ""}</td><td>${badge(m.status)}</td>
      <td>${m.status !== "completed" ? `<button data-id="${m.maintenance_id}" class="ok btn-complete-maint">Mark done</button>` : ""}</td>
    </tr>
  `,
    )
    .join("");
  document.querySelectorAll(".btn-complete-maint").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await call(API.spaces, "completeMaintenance", {
        maintenance_id: btn.dataset.id,
      });
      await loadMaintenance();
      await loadSpaceOptions();
    });
  });
}

// ============================================================
// Reservations (Phase 2.2, 3.1, 3.2, 3.3)
// ============================================================
async function loadReservations() {
  const res = await call(API.reservations, "list");
  document.getElementById("reservations-table").innerHTML = (
    res.data.data || []
  )
    .map(
      (r) => `
    <tr>
      <td>${r.reservation_id}</td><td>${r.customer_name}</td><td>${r.space_name}</td><td>${r.reservation_date}</td>
      <td>${r.start_time}–${r.end_time}</td><td>${r.number_of_people}</td><td>${badge(r.status)}</td>
      <td>
        ${r.status === "pending" ? `<button class="ok btn-confirm-res" data-id="${r.reservation_id}">Confirm</button>` : ""}
        ${["pending", "confirmed"].includes(r.status) ? `<button class="danger btn-cancel-res" data-id="${r.reservation_id}">Cancel</button>` : ""}
        ${r.status === "confirmed" ? `<button class="btn-noshow-res" data-id="${r.reservation_id}">No-show</button>` : ""}
      </td>
    </tr>
  `,
    )
    .join("");
  document.querySelectorAll(".btn-confirm-res").forEach((b) =>
    b.addEventListener("click", async () => {
      await call(API.reservations, "confirm", { reservation_id: b.dataset.id });
      await loadReservations();
      await loadDashboard();
    }),
  );
  document.querySelectorAll(".btn-cancel-res").forEach((b) =>
    b.addEventListener("click", async () => {
      await call(API.reservations, "cancel", { reservation_id: b.dataset.id });
      await loadReservations();
      await loadDashboard();
    }),
  );
  document.querySelectorAll(".btn-noshow-res").forEach((b) =>
    b.addEventListener("click", async () => {
      await call(API.reservations, "noShow", { reservation_id: b.dataset.id });
      await loadReservations();
      await loadDashboard();
    }),
  );
}

// ============================================================
// Walk-in queue (Phase 4.2)
// ============================================================
async function loadWalkins() {
  const res = await call(API.walkin, "list");
  document.getElementById("walkin-table").innerHTML = (res.data.data || [])
    .map(
      (w) => `
    <tr>
      <td>${w.queue_id}</td><td>${w.customer_name}</td><td>${w.type_name}</td><td>${w.queued_at}</td><td>${badge(w.status)}</td>
      <td>${w.status === "waiting" ? `<button class="danger btn-cancel-walkin" data-id="${w.queue_id}">Remove</button>` : ""}</td>
    </tr>
  `,
    )
    .join("");
  document.querySelectorAll(".btn-cancel-walkin").forEach((b) =>
    b.addEventListener("click", async () => {
      await call(API.walkin, "cancel", { queue_id: b.dataset.id });
      await loadWalkins();
    }),
  );
}

// ============================================================
// Sessions (Phase 4.1, 5.1, 6.2, 9.1)
// ============================================================
async function loadSessions() {
  const res = await call(API.sessions, "listActive");
  document.getElementById("active-sessions-table").innerHTML = (
    res.data.data || []
  )
    .map(
      (s) => `
    <tr>
      <td>${s.session_id}</td><td>${s.customer_name}</td><td>${s.space_name}</td><td>${s.check_in_time}</td>
      <td><code>${s.wifi_password}</code></td><td>₱${peso(s.fee_so_far)}</td>
      <td>
        <button class="btn-extend" data-id="${s.session_id}">Extend +1hr</button>
        <button class="ok btn-checkout" data-id="${s.session_id}">Check out</button>
      </td>
    </tr>
  `,
    )
    .join("");
  document.querySelectorAll(".btn-extend").forEach((b) =>
    b.addEventListener("click", async () => {
      const r = await call(API.sessions, "extendSession", {
        session_id: b.dataset.id,
        extra_minutes: 60,
      });
      if (r.data.success) await loadSessions();
    }),
  );
  document.querySelectorAll(".btn-checkout").forEach((b) =>
    b.addEventListener("click", async () => {
      const r = await call(API.sessions, "checkOut", {
        session_id: b.dataset.id,
      });
      if (r.data.success) {
        await loadSessions();
        await loadDashboard();
        await loadSpaceOptions();
      }
    }),
  );
}

// ============================================================
// Orders / POS (Phase 6.3)
// ============================================================
let CART = [];

function renderCart() {
  const list = document.getElementById("cart-list");
  let total = 0;
  list.innerHTML = CART.map((item, idx) => {
    total += item.subtotal;
    const printLabel = item.printing
      ? ` (printing: ${item.printing.label})`
      : "";
    return `<div class="cart-item"><span>${item.name} × ${item.quantity}${printLabel}</span><span>₱${peso(item.subtotal)} <button data-idx="${idx}" class="danger btn-remove-cart">✕</button></span></div>`;
  }).join("");
  document.getElementById("cart-total").textContent = peso(total);
  document.querySelectorAll(".btn-remove-cart").forEach((b) =>
    b.addEventListener("click", () => {
      CART.splice(Number(b.dataset.idx), 1);
      renderCart();
    }),
  );
}

async function loadOrdersPanel() {
  await loadProductOptions();
  const res = await call(API.orders, "list");
  document.getElementById("orders-table").innerHTML = (res.data.data || [])
    .map(
      (o) => `
    <tr><td>${o.order_id}</td><td>${o.customer_name}</td><td>${o.staff_name}</td><td>${o.order_datetime}</td><td>₱${peso(o.total_amount)}</td></tr>
  `,
    )
    .join("");

  const productSelect = document.getElementById("order-product");
  const printingFields = document.getElementById("printing-fields");
  function togglePrinting() {
    const prod = PRODUCTS.find(
      (p) => String(p.product_id) === productSelect.value,
    );
    printingFields.classList.toggle(
      "show",
      !!prod && prod.category_name === "Printing",
    );
  }
  productSelect.onchange = togglePrinting;
  togglePrinting();
}

// ============================================================
// Promotions (Phase 6.4, 10.4, 11.2)
// ============================================================
async function loadPromotions() {
  const res = await call(API.promotions, "list");
  document.getElementById("promotions-table").innerHTML = (res.data.data || [])
    .map(
      (p) => `
    <tr><td>${p.code}</td><td>${p.description ?? ""}</td><td>${p.discount_type}</td><td>${p.discount_type === "percent" ? p.discount_value + "%" : "₱" + peso(p.discount_value)}</td>
    <td>${p.valid_from} → ${p.valid_to}</td><td>${p.is_active ? "Yes" : "No"}</td></tr>
  `,
    )
    .join("");
}

// ============================================================
// Billing (Phase 7.1)
// ============================================================
async function loadBilling() {
  const res = await call(API.billing, "list");
  document.getElementById("transactions-table").innerHTML = (
    res.data.data || []
  )
    .map(
      (t) => `
    <tr><td>${t.transaction_id}</td><td>${t.customer_name}</td><td>₱${peso(t.subtotal)}</td><td>₱${peso(t.discount_amount)}</td>
    <td>₱${peso(t.total_amount)}</td><td>${badge(t.status)}</td></tr>
  `,
    )
    .join("");
}

// ============================================================
// Payments (Phase 8.1, 8.2)
// ============================================================
async function loadPayments() {
  await loadPaymentMethodOptions();
  const res = await call(API.payments, "list");
  document.getElementById("payments-table").innerHTML = (res.data.data || [])
    .map(
      (p) => `
    <tr>
      <td>${p.payment_id}</td><td>${p.customer_name}</td><td>${p.transaction_id ?? "—"}</td><td>${p.payment_method}</td>
      <td>${p.reference_number ?? "—"}</td><td>${badge(p.payment_status)}</td><td>₱${peso(p.amount_paid)}</td><td>${p.payment_date}</td>
      <td>
        ${p.payment_status === "pending" ? `<button class="ok btn-verify-pay" data-id="${p.payment_id}">Verify</button><button class="danger btn-reject-pay" data-id="${p.payment_id}">Reject</button>` : ""}
      </td>
    </tr>
  `,
    )
    .join("");
  document.querySelectorAll(".btn-verify-pay").forEach((b) =>
    b.addEventListener("click", async () => {
      await call(API.payments, "verify", { payment_id: b.dataset.id });
      await loadPayments();
      await loadBilling();
    }),
  );
  document.querySelectorAll(".btn-reject-pay").forEach((b) =>
    b.addEventListener("click", async () => {
      await call(API.payments, "reject", { payment_id: b.dataset.id });
      await loadPayments();
    }),
  );
}

// ============================================================
// Staff (Phase 0.2, 10.2)
// ============================================================
async function loadStaffPanel() {
  await loadStaffOptions();
  document.getElementById("staff-table").innerHTML = STAFF_LIST.map(
    (s) => `
    <tr>
      <td>${s.staff_id}</td><td>${s.first_name} ${s.last_name}</td><td>${s.phone_number}</td><td>${s.role_name}</td>
      <td>${badge(s.account_status || "active")}</td>
      <td>
        ${s.account_status !== "suspended" ? `<button class="danger btn-suspend" data-id="${s.staff_id}">Suspend</button>` : `<button class="ok btn-activate" data-id="${s.staff_id}">Reactivate</button>`}
      </td>
    </tr>
  `,
  ).join("");
  document.querySelectorAll(".btn-suspend").forEach((b) =>
    b.addEventListener("click", async () => {
      await call(API.staff, "setStatus", {
        staff_id: b.dataset.id,
        account_status: "suspended",
      });
      await loadStaffPanel();
    }),
  );
  document.querySelectorAll(".btn-activate").forEach((b) =>
    b.addEventListener("click", async () => {
      await call(API.staff, "setStatus", {
        staff_id: b.dataset.id,
        account_status: "active",
      });
      await loadStaffPanel();
    }),
  );
}

// ============================================================
// Notifications
// ============================================================
async function loadNotifications() {
  const res = await call(API.notifications, "list");
  document.getElementById("notif-list").innerHTML = (res.data.data || [])
    .map(
      (n) => `
    <div class="notif-item ${n.is_read ? "" : "unread"}">${n.message}<div class="hint">${n.created_at}</div></div>
  `,
    )
    .join("");
}

// ============================================================
// Forms
// ============================================================
function wireForms() {
  document
    .getElementById("customer-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.customers, "add", {
        first_name: val("cust-first-name"),
        last_name: val("cust-last-name"),
        phone_number: val("cust-phone"),
        email: val("cust-email"),
      });
      setMsg(
        "customer-msg",
        r.data.message || (r.data.success ? "Added." : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadCustomers();
      }
    });

  document
    .getElementById("space-type-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      await call(API.spaces, "addType", {
        type_name: val("type-name"),
        base_rate: val("type-rate"),
        default_capacity: val("type-capacity"),
        description: val("type-desc"),
      });
      e.target.reset();
      await loadSpacesPanel();
    });

  document
    .getElementById("space-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.spaces, "addSpace", {
        space_type_id: val("space-type-select"),
        space_name: val("space-name"),
        capacity: val("space-capacity"),
      });
      setMsg(
        "space-msg",
        r.data.message || (r.data.success ? "Added." : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadSpacesPanel();
      }
    });

  document
    .getElementById("maintenance-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.spaces, "scheduleMaintenance", {
        space_id: val("maint-space"),
        start_datetime: val("maint-start").replace("T", " ") + ":00",
        end_datetime: val("maint-end").replace("T", " ") + ":00",
        reason: val("maint-reason"),
      });
      setMsg(
        "maintenance-msg",
        r.data.message || (r.data.success ? "Scheduled." : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadMaintenance();
        await loadSpaceOptions();
      }
    });

  document
    .getElementById("btn-check-availability")
    .addEventListener("click", async () => {
      const r = await call(API.spaces, "checkAvailability", {
        date: val("avail-date"),
        start_time: val("avail-start"),
        end_time: val("avail-end"),
      });
      document.getElementById("availability-table").innerHTML =
        (r.data.data || [])
          .map(
            (s) => `
      <tr><td>${s.space_name}</td><td>${s.type_name}</td><td>${s.capacity}</td><td>₱${peso(s.base_rate)}</td></tr>
    `,
          )
          .join("") ||
        '<tr><td colspan="4">No spaces available for that window.</td></tr>';
    });

  document
    .getElementById("reservation-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.reservations, "create", {
        customer_id: val("res-customer"),
        space_id: val("res-space"),
        reservation_date: val("res-date"),
        start_time: val("res-start"),
        end_time: val("res-end"),
        number_of_people: val("res-people"),
      });
      setMsg(
        "reservation-msg",
        r.data.message ||
          (r.data.success
            ? `Reservation #${r.data.reservation_id} created (pending).`
            : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadReservations();
        await loadDashboard();
      }
    });

  document
    .getElementById("walkin-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.walkin, "add", {
        customer_id: val("walkin-customer"),
        space_type_id: val("walkin-type"),
      });
      setMsg(
        "walkin-msg",
        r.data.message || (r.data.success ? "Added to queue." : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadWalkins();
        await loadDashboard();
      }
    });

  document
    .getElementById("checkin-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.sessions, "checkIn", {
        customer_id: val("checkin-customer"),
        space_id: val("checkin-space"),
      });
      setMsg(
        "checkin-msg",
        r.data.success
          ? `Checked in. Wi-Fi password: ${r.data.wifi_password}`
          : r.data.message,
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadSessions();
        await loadDashboard();
        await loadSpaceOptions();
      }
    });

  document
    .getElementById("checkin-customer")
    .addEventListener("change", updateCheckinReservationDisplay);
  document
    .getElementById("checkin-space")
    .addEventListener("change", updateCheckinReservationDisplay);
  document
    .getElementById("order-customer")
    .addEventListener("change", updateOrderSessionDisplay);
  document
    .getElementById("billing-customer")
    .addEventListener("change", (e) => loadBillingOptions(e.target.value));
  document
    .getElementById("payment-customer")
    .addEventListener("change", (e) => loadPaymentTransactions(e.target.value));
  document
    .getElementById("payment-transaction-id")
    .addEventListener("change", (e) => {
      const option = e.target.selectedOptions[0];
      document.getElementById("payment-amount").value =
        option?.dataset.balance || "";
    });

  document.getElementById("btn-add-cart").addEventListener("click", () => {
    const prod = PRODUCTS.find(
      (p) => String(p.product_id) === val("order-product"),
    );
    if (!prod) {
      showSystemMessage("Select a café item before adding it to the cart.", false);
      return;
    }
    const qty = Math.max(1, Number(val("order-qty") || 1));
    const item = {
      product_id: prod.product_id,
      name: prod.item_name,
      quantity: qty,
      subtotal: Number(prod.unit_price) * qty,
    };
    if (prod.category_name === "Printing") {
      const paperSel = document.getElementById("print-paper-size");
      const printSel = document.getElementById("print-type");
      item.printing = {
        paper_size_id: paperSel.value,
        print_type_id: printSel.value,
        page_count: val("print-page-count") || 1,
        label: `${paperSel.options[paperSel.selectedIndex]?.text} / ${printSel.options[printSel.selectedIndex]?.text} / ${val("print-page-count")}pg`,
      };
    }
    CART.push(item);
    renderCart();
    showSystemMessage(`${prod.item_name} added to the order.`, true);
  });

  document
    .getElementById("btn-place-order")
    .addEventListener("click", async () => {
      if (CART.length === 0) {
        setMsg("order-msg", "Add at least one item to the cart.", false);
        return;
      }
      const r = await call(API.orders, "create", {
        customer_id: val("order-customer"),
        staff_id: val("order-staff"),
        items: JSON.stringify(
          CART.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            printing: i.printing,
          })),
        ),
      });
      setMsg(
        "order-msg",
        r.data.message ||
          (r.data.success
            ? `Order #${r.data.order_id} placed — ₱${peso(r.data.total_amount)}`
            : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        CART = [];
        renderCart();
        await loadOrdersPanel();
      }
    });

  document
    .getElementById("promo-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.promotions, "add", {
        code: val("promo-code"),
        description: val("promo-desc"),
        discount_type: val("promo-type"),
        discount_value: val("promo-value"),
        valid_from: val("promo-from"),
        valid_to: val("promo-to"),
      });
      setMsg(
        "promo-msg",
        r.data.message || (r.data.success ? "Added." : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadPromotions();
      }
    });

  document
    .getElementById("billing-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.billing, "create", {
        customer_id: val("billing-customer"),
        session_id: val("billing-session-id") || undefined,
        order_id: val("billing-order-id") || undefined,
        promo_code: val("billing-promo") || undefined,
      });
      setMsg(
        "billing-msg",
        r.data.message ||
          (r.data.success
            ? `Transaction #${r.data.transaction_id} — total ₱${peso(r.data.total_amount)}`
            : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadBillingOptions("");
        await loadBilling();
      }
    });

  document
    .getElementById("payment-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.payments, "record", {
        customer_id: val("payment-customer"),
        transaction_id: val("payment-transaction-id"),
        payment_method_id: val("payment-method"),
        amount_paid: val("payment-amount"),
      });
      setMsg(
        "payment-msg",
        r.data.message ||
          (r.data.success
            ? `Payment recorded — reference ${r.data.reference_number}, pending verification.`
            : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadPaymentTransactions("");
        await loadPayments();
      }
    });

  document
    .getElementById("staff-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await call(API.staff, "add", {
        first_name: val("staff-first-name"),
        last_name: val("staff-last-name"),
        phone_number: val("staff-phone"),
        role_id: val("staff-role"),
        username: val("staff-new-username"),
        password: val("staff-new-password"),
      });
      setMsg(
        "staff-msg",
        r.data.message || (r.data.success ? "Staff added." : "Failed."),
        r.data.success,
      );
      if (r.data.success) {
        e.target.reset();
        await loadStaffPanel();
      }
    });

  document.getElementById("btn-run-eod").addEventListener("click", async () => {
    const r = await call(API.reports, "endOfDay", {
      date: val("eod-date") || undefined,
    });
    const d = r.data.data;
    if (!d) {
      document.getElementById("eod-output").textContent =
        r.data.message || "Failed.";
      return;
    }
    document.getElementById("eod-output").innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="hint">Revenue</div><div class="kpi-value">₱${peso(d.revenue)}</div></div>
        <div class="kpi-card"><div class="hint">Sessions</div><div class="kpi-value">${d.sessions_count}</div></div>
        <div class="kpi-card"><div class="hint">Walk-ins</div><div class="kpi-value">${d.walkins_count}</div></div>
        <div class="kpi-card"><div class="hint">Reserved check-ins</div><div class="kpi-value">${d.reserved_count}</div></div>
      </div>
      <h3>Top products</h3>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Revenue</th></tr></thead><tbody>
        ${(d.top_products || []).map((p) => `<tr><td>${p.item_name}</td><td>${p.qty}</td><td>₱${peso(p.revenue)}</td></tr>`).join("") || '<tr><td colspan="3">No sales.</td></tr>'}
      </tbody></table>
      <h3>Outstanding balances</h3>
      <table><thead><tr><th>Transaction</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead><tbody>
        ${(d.outstanding_balances || []).map((o) => `<tr><td>${o.transaction_id}</td><td>#${o.customer_id}</td><td>₱${peso(o.total_amount)}</td><td>${badge(o.status)}</td></tr>`).join("") || '<tr><td colspan="4">None.</td></tr>'}
      </tbody></table>
    `;
  });

  document
    .getElementById("btn-run-audit")
    .addEventListener("click", async () => {
      const r = await call(API.reports, "auditLog", {
        table_name: val("audit-table") || undefined,
        date_from: val("audit-from") || undefined,
        date_to: val("audit-to") || undefined,
      });
      document.getElementById("audit-table-body").innerHTML = (
        r.data.data || []
      )
        .map(
          (a) => `
      <tr><td>${a.created_at}</td><td>${a.actor_label}</td><td>${a.action}</td><td>${a.table_name}</td><td>${a.record_id ?? ""}</td><td>${a.details ?? ""}</td></tr>
    `,
        )
        .join("");
    });

  document
    .getElementById("btn-mark-all-read")
    .addEventListener("click", async () => {
      await call(API.notifications, "markAllRead");
      await loadNotifications();
    });
}

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}
