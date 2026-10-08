/**
 * Build slim admin dataset from WooCommerce JSON exports.
 * Output: data/admin/admin-data.json (gitignored — contains PII)
 * Run: node build-admin-data.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC_ORDERS = path.join(ROOT, "exports", "json", "woocommerce-orders.json");
const SRC_CUSTOMERS = path.join(ROOT, "exports", "json", "woocommerce-customers.json");
const OUT_DIR = path.join(ROOT, "data", "admin");
const OUT_FILE = path.join(OUT_DIR, "admin-data.json");

function slimOrder(o) {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    currency: o.currency,
    date: o.date_created,
    paid: o.date_paid,
    completed: o.date_completed,
    total: o.total,
    discount: o.discount_total,
    shipping: o.shipping_total,
    payment: o.payment_method_title || o.payment_method || "",
    method: o.payment_method || "",
    txn: o.transaction_id || "",
    customerId: o.customer_id || 0,
    note: o.customer_note || "",
    b: {
      first: o.billing?.first_name || "",
      last: o.billing?.last_name || "",
      email: o.billing?.email || "",
      phone: o.billing?.phone || "",
      city: o.billing?.city || "",
      country: o.billing?.country || "",
      address: o.billing?.address_1 || "",
    },
    items: (o.line_items || []).map((i) => ({
      id: i.product_id,
      vid: i.variation_id || 0,
      name: i.name,
      qty: i.quantity,
      total: i.total,
      sku: i.sku || "",
      attrs: (i.meta_data || [])
        .filter((m) => !String(m.key || "").startsWith("_"))
        .slice(0, 6)
        .map((m) => `${m.display_key || m.key}: ${m.display_value || m.value}`),
    })),
  };
}

function slimCustomer(c) {
  return {
    id: c.id,
    date: c.date_created,
    email: c.email || "",
    first: c.first_name || "",
    last: c.last_name || "",
    username: c.username || "",
    orders: c.orders_count || 0,
    spent: c.total_spent || "0",
    paying: !!c.is_paying_customer,
    phone: c.billing?.phone || "",
    city: c.billing?.city || "",
    country: c.billing?.country || "",
    address: c.billing?.address_1 || "",
  };
}

if (!fs.existsSync(SRC_ORDERS) || !fs.existsSync(SRC_CUSTOMERS)) {
  console.error("Missing WooCommerce JSON exports. Run the API fetch first.");
  process.exit(1);
}

console.log("Reading exports...");
const orders = JSON.parse(fs.readFileSync(SRC_ORDERS, "utf8")).map(slimOrder);
const customers = JSON.parse(fs.readFileSync(SRC_CUSTOMERS, "utf8")).map(slimCustomer);

const statusCounts = {};
for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;

const payload = {
  generatedAt: new Date().toISOString(),
  site: "https://waqfehsan.org.sa",
  counts: {
    orders: orders.length,
    customers: customers.length,
    items: orders.reduce((s, o) => s + (o.items?.length || 0), 0),
  },
  statusCounts,
  orders,
  customers,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
const mb = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
console.log(`Wrote ${OUT_FILE} (${mb} MB)`);
console.log(payload.counts);
console.log(statusCounts);
