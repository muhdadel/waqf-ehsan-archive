/**
 * Admin panel for local WooCommerce archive data.
 * Fixed credentials (change here if needed):
 *   username: admin
 *   password: WaqfEhsan@Admin2026
 *
 * Data file: data/admin/admin-data.json (private / gitignored)
 */
const ADMIN_USER = "admin";
const ADMIN_PASS = "WaqfEhsan@Admin2026";
const SESSION_KEY = "waqf_admin_session_v1";
const PAGE_SIZE = 25;

const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const main = document.querySelector("#admin-main");
const dialog = document.querySelector("#detail-dialog");
const detailTitle = document.querySelector("#detail-title");
const detailBody = document.querySelector("#detail-body");

let data = null;
let tab = "dashboard";
let orderPage = 1;
let customerPage = 1;
let orderFilters = {
  q: "",
  status: "",
  payment: "",
  from: "",
  to: "",
  minTotal: "",
  maxTotal: "",
};
let customerFilters = {
  q: "",
  paying: "",
  minOrders: "",
  minSpent: "",
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function money(value, currency = "SAR") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: n % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n);
  return `${formatted} ${currency === "SAR" ? "ر.س" : currency}`;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 19);
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fullName(b = {}) {
  return [b.first, b.last].filter(Boolean).join(" ").trim();
}

function isLoggedIn() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed && parsed.ok === true && parsed.user === ADMIN_USER;
  } catch {
    return false;
  }
}

function setSession(ok) {
  if (ok) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ok: true, user: ADMIN_USER, at: Date.now() }));
  else sessionStorage.removeItem(SESSION_KEY);
}

function statusLabel(status) {
  const map = {
    processing: "قيد التنفيذ",
    pending: "بانتظار الدفع",
    completed: "مكتمل",
    cancelled: "ملغي",
    failed: "فشل",
    refunded: "مسترد",
    "on-hold": "معلّق",
  };
  return map[status] || status;
}

async function loadData() {
  main.innerHTML = `<div class="loading">جاري تحميل بيانات الطلبات والعملاء...</div>`;
  const res = await fetch("data/admin/admin-data.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      "تعذر تحميل data/admin/admin-data.json. شغّل محلياً: node build-admin-data.js ثم افتح الموقع عبر خادم محلي."
    );
  }
  data = await res.json();
}

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  render();
}

function showLogin(message = "") {
  appView.hidden = true;
  loginView.hidden = false;
  loginError.hidden = !message;
  loginError.textContent = message;
}

function paymentOptions() {
  const set = new Set();
  for (const o of data.orders) if (o.payment) set.add(o.payment);
  return [...set].sort((a, b) => a.localeCompare(b, "ar"));
}

function filteredOrders() {
  let list = data.orders;
  const q = norm(orderFilters.q);
  const minTotal = orderFilters.minTotal === "" ? null : Number(orderFilters.minTotal);
  const maxTotal = orderFilters.maxTotal === "" ? null : Number(orderFilters.maxTotal);
  const from = orderFilters.from ? new Date(orderFilters.from) : null;
  const to = orderFilters.to ? new Date(orderFilters.to + "T23:59:59") : null;

  if (orderFilters.status) list = list.filter((o) => o.status === orderFilters.status);
  if (orderFilters.payment) list = list.filter((o) => o.payment === orderFilters.payment);

  if (from || to || minTotal != null || maxTotal != null || q) {
    list = list.filter((o) => {
      const total = Number(o.total);
      if (minTotal != null && !(total >= minTotal)) return false;
      if (maxTotal != null && !(total <= maxTotal)) return false;
      if (from || to) {
        const d = new Date(o.date);
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      if (!q) return true;
      const hay = norm(
        [
          o.id,
          o.number,
          o.status,
          o.payment,
          o.txn,
          o.customerId,
          o.note,
          fullName(o.b),
          o.b?.email,
          o.b?.phone,
          o.b?.city,
          o.b?.address,
          ...(o.items || []).map((i) => `${i.name} ${i.sku} ${(i.attrs || []).join(" ")}`),
        ].join(" ")
      );
      return q.split(" ").every((token) => hay.includes(token));
    });
  }
  return list;
}

function filteredCustomers() {
  let list = data.customers;
  const q = norm(customerFilters.q);
  const minOrders = customerFilters.minOrders === "" ? null : Number(customerFilters.minOrders);
  const minSpent = customerFilters.minSpent === "" ? null : Number(customerFilters.minSpent);

  if (customerFilters.paying === "1") list = list.filter((c) => c.paying);
  if (customerFilters.paying === "0") list = list.filter((c) => !c.paying);

  list = list.filter((c) => {
    if (minOrders != null && !(Number(c.orders) >= minOrders)) return false;
    if (minSpent != null && !(Number(c.spent) >= minSpent)) return false;
    if (!q) return true;
    const hay = norm([c.id, c.email, c.first, c.last, c.username, c.phone, c.city, c.address].join(" "));
    return q.split(" ").every((token) => hay.includes(token));
  });
  return list;
}

function pager(page, total, onAttr) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safe = Math.min(Math.max(1, page), pages);
  return `<div class="pager">
    <span class="muted">${total.toLocaleString("en-US")} نتيجة · صفحة ${safe} من ${pages}</span>
    <div style="display:flex;gap:8px">
      <button type="button" data-${onAttr}="${safe - 1}" ${safe <= 1 ? "disabled" : ""}>السابق</button>
      <button type="button" data-${onAttr}="${safe + 1}" ${safe >= pages ? "disabled" : ""}>التالي</button>
    </div>
  </div>`;
}

function renderDashboard() {
  const statuses = Object.entries(data.statusCounts || {})
    .sort((a, b) => b[1] - a[1])
    .map(
      ([status, count]) =>
        `<div class="stat"><b>${count.toLocaleString("en-US")}</b><span>${esc(statusLabel(status))}</span></div>`
    )
    .join("");
  const revenue = data.orders
    .filter((o) => o.status === "processing" || o.status === "completed")
    .reduce((s, o) => s + Number(o.total || 0), 0);
  const recent = data.orders.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);

  main.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${(data.counts?.orders || data.orders.length).toLocaleString("en-US")}</b><span>طلب</span></div>
      <div class="stat"><b>${(data.counts?.customers || data.customers.length).toLocaleString("en-US")}</b><span>عميل</span></div>
      <div class="stat"><b>${(data.counts?.items || 0).toLocaleString("en-US")}</b><span>بند منتجات</span></div>
      <div class="stat"><b class="money">${esc(money(revenue))}</b><span>تقريبي (مكتمل + قيد التنفيذ)</span></div>
    </div>
    <div class="stats">${statuses}</div>
    <div class="panel" style="padding:16px">
      <h2 style="margin:0 0 10px">أحدث الطلبات</h2>
      <div class="table-wrap" style="box-shadow:none;border:0">
        <table>
          <thead><tr><th>رقم</th><th>الحالة</th><th>الإجمالي</th><th>العميل</th><th>التاريخ</th></tr></thead>
          <tbody>
            ${recent
              .map(
                (o) => `<tr class="clickable" data-order="${o.id}">
                  <td>#${esc(o.number || o.id)}</td>
                  <td><span class="badge ${esc(o.status)}">${esc(statusLabel(o.status))}</span></td>
                  <td class="money">${esc(money(o.total, o.currency))}</td>
                  <td>${esc(fullName(o.b) || o.b?.phone || o.b?.email || "—")}</td>
                  <td>${esc(formatDate(o.date))}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
    <p class="muted" style="margin-top:12px">آخر تحديث للبيانات: ${esc(formatDate(data.generatedAt))}</p>
  `;
}

function renderOrders(keepSearchFocus = false) {
  const active = document.activeElement;
  const keepQ = keepSearchFocus && active && active.matches?.("[data-of='q']");
  const caret = keepQ ? active.selectionStart : null;
  const list = filteredOrders().slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  orderPage = Math.min(Math.max(1, orderPage), pages);
  const slice = list.slice((orderPage - 1) * PAGE_SIZE, orderPage * PAGE_SIZE);
  const statuses = Object.keys(data.statusCounts || {}).sort();
  const payments = paymentOptions();

  main.innerHTML = `
    <div class="toolbar">
      <label class="field search">بحث
        <input data-of="q" value="${esc(orderFilters.q)}" placeholder="رقم الطلب، جوال، بريد، اسم، منتج..." />
      </label>
      <label class="field">الحالة
        <select data-of="status">
          <option value="">الكل</option>
          ${statuses
            .map(
              (s) =>
                `<option value="${esc(s)}" ${orderFilters.status === s ? "selected" : ""}>${esc(statusLabel(s))}</option>`
            )
            .join("")}
        </select>
      </label>
      <label class="field">طريقة الدفع
        <select data-of="payment">
          <option value="">الكل</option>
          ${payments
            .map(
              (p) =>
                `<option value="${esc(p)}" ${orderFilters.payment === p ? "selected" : ""}>${esc(p)}</option>`
            )
            .join("")}
        </select>
      </label>
      <label class="field">من تاريخ
        <input data-of="from" type="date" value="${esc(orderFilters.from)}" />
      </label>
      <label class="field">إلى تاريخ
        <input data-of="to" type="date" value="${esc(orderFilters.to)}" />
      </label>
      <label class="field">حد أدنى
        <input data-of="minTotal" type="number" min="0" step="0.01" value="${esc(orderFilters.minTotal)}" />
      </label>
      <label class="field">حد أقصى
        <input data-of="maxTotal" type="number" min="0" step="0.01" value="${esc(orderFilters.maxTotal)}" />
      </label>
      <button type="button" class="btn" id="reset-orders">مسح الفلاتر</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>الطلب</th>
            <th>الحالة</th>
            <th>الإجمالي</th>
            <th>العميل</th>
            <th>التواصل</th>
            <th>الدفع</th>
            <th>التاريخ</th>
          </tr>
        </thead>
        <tbody>
          ${
            slice.length
              ? slice
                  .map((o) => {
                    const name = fullName(o.b) || "—";
                    return `<tr class="clickable" data-order="${o.id}">
                      <td><strong>#${esc(o.number || o.id)}</strong><div class="muted">${esc((o.items || []).length)} بند</div></td>
                      <td><span class="badge ${esc(o.status)}">${esc(statusLabel(o.status))}</span></td>
                      <td class="money">${esc(money(o.total, o.currency))}</td>
                      <td>${esc(name)}</td>
                      <td><div>${esc(o.b?.phone || "—")}</div><div class="muted">${esc(o.b?.email || "")}</div></td>
                      <td>${esc(o.payment || "—")}</td>
                      <td>${esc(formatDate(o.date))}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="7" class="empty">لا توجد طلبات مطابقة</td></tr>`
          }
        </tbody>
      </table>
    </div>
    ${pager(orderPage, list.length, "opage")}
  `;
  if (keepQ) {
    const input = main.querySelector("[data-of='q']");
    if (input) {
      input.focus();
      if (caret != null) input.setSelectionRange(caret, caret);
    }
  }
}

function renderCustomers(keepSearchFocus = false) {
  const active = document.activeElement;
  const keepQ = keepSearchFocus && active && active.matches?.("[data-cf='q']");
  const caret = keepQ ? active.selectionStart : null;
  const list = filteredCustomers()
    .slice()
    .sort((a, b) => Number(b.spent) - Number(a.spent) || Number(b.orders) - Number(a.orders));
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  customerPage = Math.min(Math.max(1, customerPage), pages);
  const slice = list.slice((customerPage - 1) * PAGE_SIZE, customerPage * PAGE_SIZE);

  main.innerHTML = `
    <div class="toolbar">
      <label class="field search">بحث
        <input data-cf="q" value="${esc(customerFilters.q)}" placeholder="اسم، بريد، جوال، معرف..." />
      </label>
      <label class="field">دفع سابقاً؟
        <select data-cf="paying">
          <option value="">الكل</option>
          <option value="1" ${customerFilters.paying === "1" ? "selected" : ""}>نعم</option>
          <option value="0" ${customerFilters.paying === "0" ? "selected" : ""}>لا</option>
        </select>
      </label>
      <label class="field">حد أدنى للطلبات
        <input data-cf="minOrders" type="number" min="0" value="${esc(customerFilters.minOrders)}" />
      </label>
      <label class="field">حد أدنى للإنفاق
        <input data-cf="minSpent" type="number" min="0" step="0.01" value="${esc(customerFilters.minSpent)}" />
      </label>
      <button type="button" class="btn" id="reset-customers">مسح الفلاتر</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>العميل</th>
            <th>التواصل</th>
            <th>الطلبات</th>
            <th>إجمالي الإنفاق</th>
            <th>المدينة</th>
            <th>التسجيل</th>
          </tr>
        </thead>
        <tbody>
          ${
            slice.length
              ? slice
                  .map((c) => {
                    const name = [c.first, c.last].filter(Boolean).join(" ") || c.username || "—";
                    return `<tr class="clickable" data-customer="${c.id}">
                      <td><strong>${esc(name)}</strong><div class="muted">#${esc(c.id)}</div></td>
                      <td><div>${esc(c.phone || "—")}</div><div class="muted">${esc(c.email || "")}</div></td>
                      <td>${esc(c.orders)}</td>
                      <td class="money">${esc(money(c.spent))}</td>
                      <td>${esc(c.city || "—")}</td>
                      <td>${esc(formatDate(c.date))}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="6" class="empty">لا يوجد عملاء مطابقون</td></tr>`
          }
        </tbody>
      </table>
    </div>
    ${pager(customerPage, list.length, "cpage")}
  `;
  if (keepQ) {
    const input = main.querySelector("[data-cf='q']");
    if (input) {
      input.focus();
      if (caret != null) input.setSelectionRange(caret, caret);
    }
  }
}

function render() {
  for (const btn of document.querySelectorAll(".tabs button")) {
    btn.classList.toggle("is-on", btn.dataset.tab === tab);
  }
  if (tab === "orders") renderOrders();
  else if (tab === "customers") renderCustomers();
  else renderDashboard();
}

function openOrder(id) {
  const o = data.orders.find((x) => String(x.id) === String(id));
  if (!o) return;
  detailTitle.textContent = `طلب #${o.number || o.id}`;
  detailBody.innerHTML = `
    <dl class="kv">
      <dt>الحالة</dt><dd><span class="badge ${esc(o.status)}">${esc(statusLabel(o.status))}</span></dd>
      <dt>الإجمالي</dt><dd class="money">${esc(money(o.total, o.currency))}</dd>
      <dt>التاريخ</dt><dd>${esc(formatDate(o.date))}</dd>
      <dt>تاريخ الدفع</dt><dd>${esc(formatDate(o.paid))}</dd>
      <dt>طريقة الدفع</dt><dd>${esc(o.payment || "—")}</dd>
      <dt>رقم العملية</dt><dd>${esc(o.txn || "—")}</dd>
      <dt>معرف العميل</dt><dd>${esc(o.customerId || "زائر")}</dd>
      <dt>الاسم</dt><dd>${esc(fullName(o.b) || "—")}</dd>
      <dt>الجوال</dt><dd>${esc(o.b?.phone || "—")}</dd>
      <dt>البريد</dt><dd>${esc(o.b?.email || "—")}</dd>
      <dt>العنوان</dt><dd>${esc([o.b?.address, o.b?.city, o.b?.country].filter(Boolean).join(" — ") || "—")}</dd>
      <dt>ملاحظة</dt><dd>${esc(o.note || "—")}</dd>
    </dl>
    <h3>المنتجات</h3>
    <div class="items-list">
      ${(o.items || [])
        .map(
          (i) => `<div class="item-row">
            <strong>${esc(i.name)}</strong>
            <div class="muted">الكمية: ${esc(i.qty)} · الإجمالي: ${esc(money(i.total, o.currency))}${i.sku ? ` · SKU: ${esc(i.sku)}` : ""}</div>
            ${i.attrs?.length ? `<div class="muted">${esc(i.attrs.join(" | "))}</div>` : ""}
          </div>`
        )
        .join("") || `<div class="muted">لا توجد بنود</div>`}
    </div>
  `;
  dialog.showModal();
}

function openCustomer(id) {
  const c = data.customers.find((x) => String(x.id) === String(id));
  if (!c) return;
  const related = data.orders
    .filter((o) => String(o.customerId) === String(c.id) || (c.email && o.b?.email === c.email))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 20);
  const name = [c.first, c.last].filter(Boolean).join(" ") || c.username || `#${c.id}`;
  detailTitle.textContent = name;
  detailBody.innerHTML = `
    <dl class="kv">
      <dt>المعرف</dt><dd>${esc(c.id)}</dd>
      <dt>البريد</dt><dd>${esc(c.email || "—")}</dd>
      <dt>الجوال</dt><dd>${esc(c.phone || "—")}</dd>
      <dt>العنوان</dt><dd>${esc([c.address, c.city, c.country].filter(Boolean).join(" — ") || "—")}</dd>
      <dt>عدد الطلبات</dt><dd>${esc(c.orders)}</dd>
      <dt>إجمالي الإنفاق</dt><dd class="money">${esc(money(c.spent))}</dd>
      <dt>عميل دافع</dt><dd>${c.paying ? "نعم" : "لا"}</dd>
      <dt>تاريخ التسجيل</dt><dd>${esc(formatDate(c.date))}</dd>
    </dl>
    <h3>آخر الطلبات المرتبطة</h3>
    <div class="items-list">
      ${
        related.length
          ? related
              .map(
                (o) => `<button type="button" class="item-row" data-order="${o.id}" style="width:100%;text-align:right;border:0;cursor:pointer">
                  <strong>#${esc(o.number || o.id)}</strong> · ${esc(statusLabel(o.status))} · <span class="money">${esc(money(o.total, o.currency))}</span>
                  <div class="muted">${esc(formatDate(o.date))}</div>
                </button>`
              )
              .join("")
          : `<div class="muted">لا توجد طلبات مرتبطة في البيانات المحملة</div>`
      }
    </div>
  `;
  dialog.showModal();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.querySelector("#username").value.trim();
  const password = document.querySelector("#password").value;
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    showLogin("بيانات الدخول غير صحيحة");
    return;
  }
  setSession(true);
  try {
    await loadData();
    showApp();
  } catch (e) {
    setSession(false);
    showLogin(e.message || "تعذر تحميل البيانات");
  }
});

document.querySelector("#logout").addEventListener("click", () => {
  setSession(false);
  data = null;
  showLogin();
});

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    tab = btn.dataset.tab;
    orderPage = 1;
    customerPage = 1;
    render();
  });
});

document.querySelector("#detail-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

main.addEventListener("click", (event) => {
  const orderBtn = event.target.closest("[data-order]");
  if (orderBtn) {
    openOrder(orderBtn.dataset.order);
    return;
  }
  const customerBtn = event.target.closest("[data-customer]");
  if (customerBtn) {
    openCustomer(customerBtn.dataset.customer);
    return;
  }
  const opage = event.target.closest("[data-opage]");
  if (opage && !opage.disabled) {
    orderPage = Number(opage.dataset.opage);
    renderOrders();
    return;
  }
  const cpage = event.target.closest("[data-cpage]");
  if (cpage && !cpage.disabled) {
    customerPage = Number(cpage.dataset.cpage);
    renderCustomers();
  }
  if (event.target.id === "reset-orders") {
    orderFilters = { q: "", status: "", payment: "", from: "", to: "", minTotal: "", maxTotal: "" };
    orderPage = 1;
    renderOrders();
  }
  if (event.target.id === "reset-customers") {
    customerFilters = { q: "", paying: "", minOrders: "", minSpent: "" };
    customerPage = 1;
    renderCustomers();
  }
});

detailBody.addEventListener("click", (event) => {
  const orderBtn = event.target.closest("[data-order]");
  if (orderBtn) openOrder(orderBtn.dataset.order);
});

main.addEventListener("change", (event) => {
  const of = event.target.closest("[data-of]");
  if (of) {
    orderFilters[of.dataset.of] = of.value;
    orderPage = 1;
    renderOrders();
    return;
  }
  const cf = event.target.closest("[data-cf]");
  if (cf) {
    customerFilters[cf.dataset.cf] = cf.value;
    customerPage = 1;
    renderCustomers();
  }
});

main.addEventListener("input", (event) => {
  const of = event.target.closest("[data-of='q']");
  if (of) {
    orderFilters.q = of.value;
    orderPage = 1;
    // debounce lightly via rAF batching
    clearTimeout(main._qTimer);
    main._qTimer = setTimeout(() => renderOrders(true), 200);
    return;
  }
  const cf = event.target.closest("[data-cf='q']");
  if (cf) {
    customerFilters.q = cf.value;
    customerPage = 1;
    clearTimeout(main._cqTimer);
    main._cqTimer = setTimeout(() => renderCustomers(true), 200);
  }
});

(async function boot() {
  if (!isLoggedIn()) {
    showLogin();
    return;
  }
  try {
    await loadData();
    showApp();
  } catch (e) {
    setSession(false);
    showLogin(e.message || "تعذر تحميل البيانات");
  }
})();
