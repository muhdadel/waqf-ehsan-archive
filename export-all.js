/**
 * Full local export from WordPress.2026-10-06.xml
 * - structured JSON datasets
 * - Excel workbooks
 * - TXT info files
 * - downloads media into media/
 * - rebuilds data/catalog.js with local image paths when files exist
 *
 * Run: node export-all.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");
const ExcelJS = require("exceljs");

const ROOT = __dirname;
const XML_PATH = path.join(ROOT, "WordPress.2026-10-06.xml");
const MEDIA_DIR = path.join(ROOT, "media");
const EXPORT_DIR = path.join(ROOT, "exports");
const EXCEL_DIR = path.join(EXPORT_DIR, "excel");
const INFO_DIR = path.join(EXPORT_DIR, "info");
const JSON_DIR = path.join(EXPORT_DIR, "json");
const DATA_DIR = path.join(ROOT, "data");

const CONCURRENCY = 6;
const DOWNLOAD_TIMEOUT_MS = 45000;

function ensureDirs() {
  for (const dir of [MEDIA_DIR, EXPORT_DIR, EXCEL_DIR, INFO_DIR, JSON_DIR, DATA_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function decodeSlug(value) {
  const raw = String(value || "").trim();
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cdata(block, tag) {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`);
  const match = block.match(re);
  return match ? match[1] : "";
}

function plainTag(block, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const match = block.match(re);
  return match ? match[1].trim() : "";
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ");
}

function plainText(htmlOrText) {
  return decodeEntities(stripTags(htmlOrText)).replace(/\s+/g, " ").trim();
}

function num(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseMeta(item) {
  const meta = new Map();
  const re =
    /<wp:postmeta>\s*<wp:meta_key><!\[CDATA\[([\s\S]*?)\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[([\s\S]*?)\]\]><\/wp:meta_value>\s*<\/wp:postmeta>/g;
  for (const match of item.matchAll(re)) {
    if (!meta.has(match[1])) meta.set(match[1], []);
    meta.get(match[1]).push(match[2]);
  }
  return meta;
}

function metaFirst(meta, key) {
  const values = meta.get(key);
  return values && values.length ? values[0] : "";
}

function parseCategories(item) {
  const categories = [];
  const re = /<category domain="([^"]+)" nicename="([^"]*)"><!\[CDATA\[([\s\S]*?)\]\]><\/category>/g;
  for (const match of item.matchAll(re)) {
    categories.push({
      domain: match[1],
      slug: decodeSlug(match[2]),
      name: decodeEntities(match[3]).trim(),
    });
  }
  return categories;
}

function localPathFromRemote(url) {
  try {
    const cleaned = cleanUploadUrl(url);
    if (!cleaned) return null;
    const parsed = new URL(cleaned);
    if (!/waqfehsan\.org\.sa$/i.test(parsed.hostname)) return null;
    let pathname = decodeURIComponent(parsed.pathname);
    const marker = "/wp-content/uploads/";
    const idx = pathname.toLowerCase().indexOf(marker);
    if (idx === -1) return null;
    const relative = pathname.slice(idx + marker.length).replace(/^\/+/, "");
    if (!relative || relative.includes("..") || /[<>:"|?*]/.test(relative)) return null;
    return {
      absolute: path.join(MEDIA_DIR, "uploads", relative),
      webPath: "media/uploads/" + relative.replace(/\\/g, "/"),
      relative,
    };
  } catch {
    return null;
  }
}

function cleanUploadUrl(raw) {
  if (!raw) return null;
  let value = decodeEntities(String(raw)).replace(/&amp;/g, "&").trim();
  value = value.replace(/\\+\//g, "/");
  value = value.split(/[",'\\<>\s]|\\u0/)[0];
  value = value.replace(/[),.;]+$/g, "");
  if (!/^https?:\/\/waqfehsan\.org\.sa\/wp-content\/uploads\//i.test(value)) return null;
  if (!/\.(png|jpe?g|gif|webp|svg|pdf|mp4|webm|ico|avif)(\?.*)?$/i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.pathname.includes("..")) return null;
    return parsed.origin + parsed.pathname;
  } catch {
    return null;
  }
}

function toLocalOrRemote(url) {
  if (!url) return { remote: null, local: null, web: null, exists: false };
  const mapped = localPathFromRemote(url);
  if (!mapped) return { remote: url, local: null, web: null, exists: false };
  const exists = fs.existsSync(mapped.absolute);
  return {
    remote: url,
    local: mapped.absolute,
    web: mapped.webPath,
    exists,
    display: exists ? mapped.webPath : url,
  };
}

function writeJson(name, data) {
  const file = path.join(JSON_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return file;
}

function writeInfo(name, lines) {
  const file = path.join(INFO_DIR, name);
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return file;
}

async function writeSheet(filename, sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Waqf Ehsan local export";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width || Math.max(12, Math.min(40, column.header.length + 4)),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF143D34" },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (const row of rows) sheet.addRow(row);
  sheet.views = [{ state: "frozen", ySplit: 1, rightToLeft: true }];
  const file = path.join(EXCEL_DIR, filename);
  await workbook.xlsx.writeFile(file);
  return file;
}

function downloadFile(url, dest) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      return resolve({ url, dest, status: "exists" });
    }
    const temp = dest + ".part";
    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(
      url,
      {
        timeout: DOWNLOAD_TIMEOUT_MS,
        headers: {
          "User-Agent": "WaqfEhsanLocalExport/1.0",
          Accept: "*/*",
        },
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          return downloadFile(response.headers.location, dest).then(resolve);
        }
        if (response.statusCode !== 200) {
          response.resume();
          return resolve({ url, dest, status: "http_" + response.statusCode });
        }
        const stream = fs.createWriteStream(temp);
        response.pipe(stream);
        stream.on("finish", () => {
          stream.close(() => {
            fs.renameSync(temp, dest);
            resolve({ url, dest, status: "downloaded" });
          });
        });
        stream.on("error", () => {
          try {
            fs.unlinkSync(temp);
          } catch {}
          resolve({ url, dest, status: "write_error" });
        });
      }
    );
    request.on("timeout", () => {
      request.destroy();
      resolve({ url, dest, status: "timeout" });
    });
    request.on("error", () => resolve({ url, dest, status: "network_error" }));
  });
}

async function downloadAll(urls) {
  const unique = [...new Set(urls.filter(Boolean))];
  const jobs = [];
  for (const url of unique) {
    const mapped = localPathFromRemote(url);
    if (!mapped) continue;
    jobs.push({ url, dest: mapped.absolute, web: mapped.webPath });
  }
  const results = [];
  let index = 0;
  async function worker() {
    while (index < jobs.length) {
      const current = jobs[index++];
      const result = await downloadFile(current.url, current.dest);
      results.push(result);
      if (results.length % 25 === 0 || results.length === jobs.length) {
        console.log(`media ${results.length}/${jobs.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()));
  return results;
}

function parseExport() {
  const xml = fs.readFileSync(XML_PATH, "utf8");
  const [head, ...itemChunks] = xml.split("<item>");
  const items = itemChunks.map((chunk) => chunk.split("</item>")[0]);

  const site = {
    title: plainText(cdata(head, "title")) || "وقف إحسان",
    url: plainTag(head, "link") || "https://waqfehsan.org.sa",
    language: plainTag(head, "language") || "ar",
    exportedAt: "2026-10-06",
    wxrVersion: cdata(head, "wp:wxr_version") || plainTag(head, "wp:wxr_version"),
  };

  const authors = [];
  for (const match of head.matchAll(/<wp:author>([\s\S]*?)<\/wp:author>/g)) {
    const block = match[1];
    authors.push({
      id: plainTag(block, "wp:author_id"),
      login: cdata(block, "wp:author_login"),
      email: cdata(block, "wp:author_email"),
      displayName: cdata(block, "wp:author_display_name"),
      firstName: cdata(block, "wp:author_first_name"),
      lastName: cdata(block, "wp:author_last_name"),
    });
  }

  const categoriesWp = [];
  for (const match of head.matchAll(/<wp:category>([\s\S]*?)<\/wp:category>/g)) {
    const block = match[1];
    categoriesWp.push({
      id: plainTag(block, "wp:term_id"),
      slug: decodeSlug(cdata(block, "wp:category_nicename")),
      parent: decodeSlug(cdata(block, "wp:category_parent")),
      name: decodeEntities(cdata(block, "wp:cat_name")).trim(),
    });
  }

  const terms = [];
  for (const match of head.matchAll(/<wp:term>([\s\S]*?)<\/wp:term>/g)) {
    const block = match[1];
    terms.push({
      id: plainTag(block, "wp:term_id"),
      taxonomy: cdata(block, "wp:term_taxonomy"),
      slug: decodeSlug(cdata(block, "wp:term_slug")),
      parent: decodeSlug(cdata(block, "wp:term_parent")),
      name: decodeEntities(cdata(block, "wp:term_name")).trim(),
    });
  }

  const termIndex = new Map();
  for (const term of terms) {
    termIndex.set(`${term.taxonomy}::${term.slug}`, term);
  }

  const attachments = [];
  const products = [];
  const variations = [];
  const posts = [];
  const pages = [];
  const coupons = [];
  const otherItems = [];
  const typeCounts = {};
  const mediaUrls = new Set();

  for (const item of items) {
    const type = cdata(item, "wp:post_type");
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    const id = plainTag(item, "wp:post_id");
    const status = cdata(item, "wp:status");
    const title = decodeEntities(cdata(item, "title")).trim();
    const link = (item.match(/<link>([^<]+)<\/link>/) || [])[1] || "";
    const date = cdata(item, "wp:post_date");
    const modified = cdata(item, "wp:post_modified");
    const slug = decodeSlug(cdata(item, "wp:post_name"));
    const parent = plainTag(item, "wp:post_parent");
    const creator = cdata(item, "dc:creator");
    const content = cdata(item, "content:encoded");
    const excerpt = cdata(item, "excerpt:encoded");
    const meta = parseMeta(item);
    const cats = parseCategories(item);

    if (type === "attachment") {
      const url = cleanUploadUrl(cdata(item, "wp:attachment_url")) || cdata(item, "wp:attachment_url");
      if (cleanUploadUrl(url)) mediaUrls.add(cleanUploadUrl(url));
      attachments.push({
        id,
        title,
        status,
        parent,
        creator,
        date,
        modified,
        mime: metaFirst(meta, "_wp_attachment_image_alt") ? "image" : "",
        file: metaFirst(meta, "_wp_attached_file"),
        url: cleanUploadUrl(url) || url,
        alt: metaFirst(meta, "_wp_attachment_image_alt"),
      });
      continue;
    }

    if (type === "product_variation") {
      const attributes = [];
      for (const [key, values] of meta.entries()) {
        if (!key.startsWith("attribute_") || !values[0]) continue;
        const taxonomy = decodeSlug(key.slice("attribute_".length));
        const attrSlug = values[0];
        const term = termIndex.get(`${taxonomy}::${decodeSlug(attrSlug)}`) || termIndex.get(`${taxonomy}::${attrSlug}`);
        attributes.push({
          key: taxonomy,
          label: decodeSlug(taxonomy.replace(/^pa_/, "")).replace(/[-_]+/g, " "),
          slug: attrSlug,
          value: term ? term.name : decodeSlug(attrSlug).replace(/[-_]+/g, " "),
        });
      }
      variations.push({
        id,
        parent,
        title,
        status,
        date,
        price: num(metaFirst(meta, "_price") || metaFirst(meta, "_regular_price")),
        regularPrice: num(metaFirst(meta, "_regular_price")),
        stockStatus: metaFirst(meta, "_stock_status"),
        stock: metaFirst(meta, "_stock"),
        sku: metaFirst(meta, "_sku"),
        imageId: metaFirst(meta, "_thumbnail_id"),
        description: plainText(metaFirst(meta, "_variation_description")),
        attributesText: attributes.map((attribute) => `${attribute.label}: ${attribute.value}`).join(" | "),
        attributesJson: JSON.stringify(attributes, null, 0),
      });
      continue;
    }

    if (type === "product") {
      const productType = cats.find((category) => category.domain === "product_type");
      const productCats = cats.filter((category) => category.domain === "product_cat");
      const visibility = cats.filter((category) => category.domain === "product_visibility").map((category) => category.name);
      const prices = (meta.get("_price") || []).map(num).filter((value) => value != null);
      const galleryIds = String(metaFirst(meta, "_product_image_gallery") || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      products.push({
        id,
        title,
        slug,
        status,
        link,
        date,
        modified,
        creator,
        kind: productType ? productType.slug : "simple",
        categories: productCats.map((category) => category.name).join(" | "),
        categorySlugs: productCats.map((category) => category.slug).join(" | "),
        visibility: visibility.join(" | "),
        price: prices[0] ?? num(metaFirst(meta, "_regular_price")),
        regularPrice: num(metaFirst(meta, "_regular_price")),
        stockStatus: metaFirst(meta, "_stock_status"),
        stock: metaFirst(meta, "_stock"),
        sku: metaFirst(meta, "_sku"),
        totalSales: num(metaFirst(meta, "total_sales")) || 0,
        imageId: metaFirst(meta, "_thumbnail_id"),
        galleryIds: galleryIds.join(","),
        excerpt: plainText(excerpt),
        contentText: plainText(content).slice(0, 5000),
        contentHtmlLength: content.length,
      });
      continue;
    }

    if (type === "post") {
      posts.push({
        id,
        title,
        slug,
        status,
        link,
        date,
        modified,
        creator,
        categories: cats.filter((category) => category.domain === "category").map((category) => category.name).join(" | "),
        excerpt: plainText(excerpt),
        contentText: plainText(content).slice(0, 8000),
        contentHtmlLength: content.length,
        imageId: metaFirst(meta, "_thumbnail_id"),
      });
      continue;
    }

    if (type === "page") {
      pages.push({
        id,
        title,
        slug,
        status,
        link,
        date,
        modified,
        creator,
        parent,
        excerpt: plainText(excerpt),
        contentText: plainText(content).slice(0, 8000),
        contentHtmlLength: content.length,
        imageId: metaFirst(meta, "_thumbnail_id"),
      });
      continue;
    }

    if (type === "shop_coupon") {
      coupons.push({
        id,
        title,
        status,
        date,
        amount: metaFirst(meta, "coupon_amount"),
        discountType: metaFirst(meta, "discount_type"),
        usageCount: metaFirst(meta, "usage_count"),
        expiry: metaFirst(meta, "expiry_date") || metaFirst(meta, "date_expires"),
        description: plainText(excerpt || content),
      });
      continue;
    }

    otherItems.push({
      id,
      type,
      title,
      status,
      link,
      date,
      creator,
      contentHtmlLength: content.length,
    });
  }

  // collect urls from content too
  for (const match of xml.matchAll(/https?:\/\/waqfehsan\.org\.sa\/wp-content\/uploads\/[^"'\\\s<>]+/g)) {
    const cleaned = cleanUploadUrl(match[0]);
    if (cleaned) mediaUrls.add(cleaned);
  }

  return {
    site,
    authors,
    categoriesWp,
    terms,
    attachments,
    products,
    variations,
    posts,
    pages,
    coupons,
    otherItems,
    typeCounts,
    mediaUrls: [...mediaUrls],
    itemCount: items.length,
  };
}

function attachImagePaths(dataset) {
  const byId = new Map(dataset.attachments.map((attachment) => [attachment.id, attachment]));
  for (const attachment of dataset.attachments) {
    const mapped = toLocalOrRemote(attachment.url);
    attachment.localPath = mapped.exists ? mapped.web : "";
    attachment.downloadStatus = mapped.exists ? "local" : "remote_only";
  }
  for (const product of dataset.products) {
    const thumb = byId.get(product.imageId);
    const mapped = toLocalOrRemote(thumb && thumb.url);
    product.imageUrl = thumb ? thumb.url : "";
    product.imageLocal = mapped.exists ? mapped.web : "";
    product.imageDisplay = mapped.display || "";
  }
  for (const variation of dataset.variations) {
    const thumb = byId.get(variation.imageId);
    const mapped = toLocalOrRemote(thumb && thumb.url);
    variation.imageUrl = thumb ? thumb.url : "";
    variation.imageLocal = mapped.exists ? mapped.web : "";
  }
  for (const post of dataset.posts) {
    const thumb = byId.get(post.imageId);
    const mapped = toLocalOrRemote(thumb && thumb.url);
    post.imageUrl = thumb ? thumb.url : "";
    post.imageLocal = mapped.exists ? mapped.web : "";
  }
  for (const page of dataset.pages) {
    const thumb = byId.get(page.imageId);
    const mapped = toLocalOrRemote(thumb && thumb.url);
    page.imageUrl = thumb ? thumb.url : "";
    page.imageLocal = mapped.exists ? mapped.web : "";
  }
}

function buildFrontendCatalog(dataset) {
  // Reuse the existing builder by shelling? Better: spawn build-catalog then patch local URLs.
  // For reliability, call node's child process.
  return dataset;
}

async function main() {
  ensureDirs();
  console.log("Parsing WordPress export...");
  const dataset = parseExport();
  console.log("Items:", dataset.itemCount);
  console.log("Types:", dataset.typeCounts);

  console.log("Downloading media...");
  const downloadResults = await downloadAll(dataset.mediaUrls);
  const summary = downloadResults.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  console.log("Download summary:", summary);

  attachImagePaths(dataset);

  writeJson("site.json", dataset.site);
  writeJson("authors.json", dataset.authors);
  writeJson("categories.json", dataset.categoriesWp);
  writeJson("terms.json", dataset.terms);
  writeJson("attachments.json", dataset.attachments);
  writeJson("products.json", dataset.products);
  writeJson("variations.json", dataset.variations);
  writeJson("posts.json", dataset.posts);
  writeJson("pages.json", dataset.pages);
  writeJson("coupons.json", dataset.coupons);
  writeJson("other-items.json", dataset.otherItems);
  writeJson("download-report.json", {
    summary,
    results: downloadResults.map((item) => ({
      status: item.status,
      url: item.url,
      local: path.relative(ROOT, item.dest).replace(/\\/g, "/"),
    })),
  });

  console.log("Writing Excel files...");
  await writeSheet(
    "01-products.xlsx",
    "Products",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Title", key: "title", width: 42 },
      { header: "Status", key: "status", width: 12 },
      { header: "Type", key: "kind", width: 12 },
      { header: "Price", key: "price", width: 12 },
      { header: "Regular Price", key: "regularPrice", width: 14 },
      { header: "Stock", key: "stockStatus", width: 12 },
      { header: "Total Sales", key: "totalSales", width: 12 },
      { header: "Categories", key: "categories", width: 36 },
      { header: "Visibility", key: "visibility", width: 28 },
      { header: "SKU", key: "sku", width: 14 },
      { header: "Image Local", key: "imageLocal", width: 42 },
      { header: "Image URL", key: "imageUrl", width: 50 },
      { header: "Excerpt", key: "excerpt", width: 40 },
      { header: "Content Text", key: "contentText", width: 50 },
      { header: "Link", key: "link", width: 40 },
      { header: "Date", key: "date", width: 20 },
      { header: "Author", key: "creator", width: 24 },
    ],
    dataset.products
  );

  await writeSheet(
    "02-variations.xlsx",
    "Variations",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Parent Product ID", key: "parent", width: 16 },
      { header: "Status", key: "status", width: 12 },
      { header: "Price", key: "price", width: 12 },
      { header: "Regular Price", key: "regularPrice", width: 14 },
      { header: "Stock", key: "stockStatus", width: 12 },
      { header: "Attributes", key: "attributesText", width: 42 },
      { header: "Description", key: "description", width: 36 },
      { header: "Image Local", key: "imageLocal", width: 42 },
      { header: "Image URL", key: "imageUrl", width: 50 },
      { header: "Date", key: "date", width: 20 },
    ],
    dataset.variations
  );

  await writeSheet(
    "03-categories-terms.xlsx",
    "Terms",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Taxonomy", key: "taxonomy", width: 22 },
      { header: "Name", key: "name", width: 28 },
      { header: "Slug", key: "slug", width: 28 },
      { header: "Parent", key: "parent", width: 20 },
    ],
    dataset.terms
  );

  await writeSheet(
    "04-posts.xlsx",
    "Posts",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Title", key: "title", width: 42 },
      { header: "Status", key: "status", width: 12 },
      { header: "Date", key: "date", width: 20 },
      { header: "Categories", key: "categories", width: 28 },
      { header: "Excerpt", key: "excerpt", width: 40 },
      { header: "Content Text", key: "contentText", width: 50 },
      { header: "Image Local", key: "imageLocal", width: 42 },
      { header: "Image URL", key: "imageUrl", width: 50 },
      { header: "Link", key: "link", width: 40 },
      { header: "Author", key: "creator", width: 24 },
    ],
    dataset.posts
  );

  await writeSheet(
    "05-pages.xlsx",
    "Pages",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Title", key: "title", width: 36 },
      { header: "Status", key: "status", width: 12 },
      { header: "Date", key: "date", width: 20 },
      { header: "Parent", key: "parent", width: 10 },
      { header: "Excerpt", key: "excerpt", width: 30 },
      { header: "Content Text", key: "contentText", width: 50 },
      { header: "Image Local", key: "imageLocal", width: 42 },
      { header: "Link", key: "link", width: 40 },
      { header: "Author", key: "creator", width: 24 },
    ],
    dataset.pages
  );

  await writeSheet(
    "06-attachments.xlsx",
    "Attachments",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Title", key: "title", width: 28 },
      { header: "File", key: "file", width: 36 },
      { header: "Local Path", key: "localPath", width: 42 },
      { header: "Remote URL", key: "url", width: 55 },
      { header: "Status", key: "downloadStatus", width: 14 },
      { header: "Parent", key: "parent", width: 10 },
      { header: "Date", key: "date", width: 20 },
      { header: "Alt", key: "alt", width: 24 },
    ],
    dataset.attachments
  );

  await writeSheet(
    "07-authors.xlsx",
    "Authors",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Login", key: "login", width: 28 },
      { header: "Email", key: "email", width: 32 },
      { header: "Display Name", key: "displayName", width: 22 },
      { header: "First Name", key: "firstName", width: 16 },
      { header: "Last Name", key: "lastName", width: 16 },
    ],
    dataset.authors
  );

  await writeSheet(
    "08-coupons.xlsx",
    "Coupons",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Code/Title", key: "title", width: 24 },
      { header: "Status", key: "status", width: 12 },
      { header: "Amount", key: "amount", width: 12 },
      { header: "Discount Type", key: "discountType", width: 16 },
      { header: "Usage Count", key: "usageCount", width: 12 },
      { header: "Expiry", key: "expiry", width: 16 },
      { header: "Description", key: "description", width: 40 },
      { header: "Date", key: "date", width: 20 },
    ],
    dataset.coupons
  );

  await writeSheet(
    "09-other-content.xlsx",
    "Other",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Type", key: "type", width: 22 },
      { header: "Title", key: "title", width: 36 },
      { header: "Status", key: "status", width: 12 },
      { header: "Date", key: "date", width: 20 },
      { header: "Author", key: "creator", width: 24 },
      { header: "Content Length", key: "contentHtmlLength", width: 14 },
      { header: "Link", key: "link", width: 40 },
    ],
    dataset.otherItems
  );

  const localMediaCount = dataset.attachments.filter((attachment) => attachment.localPath).length;
  const productSales = dataset.products.reduce((sum, product) => sum + (product.totalSales || 0), 0);

  writeInfo("00-README.txt", [
    "وقف إحسان — Local Data Export",
    "==============================",
    "",
    `Source file: WordPress.2026-10-06.xml`,
    `Site: ${dataset.site.title} (${dataset.site.url})`,
    `Export date in XML: ${dataset.site.exportedAt}`,
    `Generated at: ${new Date().toISOString()}`,
    "",
    "What this package contains",
    "--------------------------",
    "1) exports/excel/   Excel workbooks for every available content type",
    "2) exports/json/    Same datasets as JSON",
    "3) exports/info/    Human-readable info notes",
    "4) media/uploads/   Downloaded media files from the old website",
    "5) data/catalog.js  Frontend catalog used by index.html",
    "",
    "Important limitations from WordPress export",
    "------------------------------------------",
    "- NO customer/user accounts for shoppers",
    "- NO order details / invoices / payments",
    "- Only product total_sales counters exist (aggregate sold quantity)",
    "- Authors listed are WordPress editors/admins, not customers",
    "",
    "Counts",
    "------",
    `All items: ${dataset.itemCount}`,
    `Products: ${dataset.products.length}`,
    `Variations: ${dataset.variations.length}`,
    `Posts: ${dataset.posts.length}`,
    `Pages: ${dataset.pages.length}`,
    `Attachments listed: ${dataset.attachments.length}`,
    `Attachments saved locally: ${localMediaCount}`,
    `Authors: ${dataset.authors.length}`,
    `Coupons: ${dataset.coupons.length}`,
    `Terms: ${dataset.terms.length}`,
    `Sum of product total_sales counters: ${productSales}`,
    "",
    "Post type breakdown",
    "-------------------",
    ...Object.entries(dataset.typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}: ${count}`),
    "",
    "Media download summary",
    "----------------------",
    ...Object.entries(summary).map(([status, count]) => `${status}: ${count}`),
  ]);

  writeInfo("01-products-info.txt", [
    "Products Info",
    "=============",
    "",
    "Source: WooCommerce products inside the WordPress XML export.",
    "",
    `Count: ${dataset.products.length}`,
    `Published: ${dataset.products.filter((product) => product.status === "publish").length}`,
    `Draft: ${dataset.products.filter((product) => product.status === "draft").length}`,
    `Variable products: ${dataset.products.filter((product) => product.kind === "variable").length}`,
    `Simple products: ${dataset.products.filter((product) => product.kind === "simple").length}`,
    "",
    "Fields available:",
    "- title, status, type (simple/variable)",
    "- price / regular price",
    "- stock status",
    "- total_sales (order count counter only)",
    "- categories and visibility flags",
    "- excerpt and cleaned content text",
    "- thumbnail/gallery references + local media path when downloaded",
    "",
    "Excel: exports/excel/01-products.xlsx",
    "JSON:  exports/json/products.json",
    "",
    "Top products by total_sales:",
    ...dataset.products
      .slice()
      .sort((a, b) => b.totalSales - a.totalSales)
      .slice(0, 15)
      .map((product, index) => `${index + 1}. ${product.title} — ${product.totalSales}`),
  ]);

  writeInfo("02-orders-users-info.txt", [
    "Orders & Users Info",
    "===================",
    "",
    "Orders: NOT available in this export.",
    "Shop customers: NOT available in this export.",
    "",
    "What exists instead:",
    `- Product total_sales counters on ${dataset.products.length} products`,
    `- Combined counter total: ${productSales}`,
    `- ${dataset.authors.length} WordPress authors/editors (site staff accounts)`,
    "",
    "To get real orders/customers you need:",
    "- a WooCommerce orders export, or",
    "- database dump / WooCommerce analytics export from the old host",
    "",
    "Staff authors found in XML:",
    ...dataset.authors.map((author) => `- ${author.login} <${author.email}>`),
  ]);

  writeInfo("03-media-info.txt", [
    "Media Info",
    "==========",
    "",
    "Media was taken from attachment URLs and upload links inside the XML,",
    "then downloaded from https://waqfehsan.org.sa into media/uploads/.",
    "",
    `Attachment records: ${dataset.attachments.length}`,
    `Unique download targets: ${downloadResults.length}`,
    `Saved locally: ${localMediaCount}`,
    "",
    "Folder layout:",
    "media/uploads/YYYY/MM/filename.ext",
    "",
    "Download statuses:",
    ...Object.entries(summary).map(([status, count]) => `- ${status}: ${count}`),
    "",
    "Excel inventory: exports/excel/06-attachments.xlsx",
    "JSON report: exports/json/download-report.json",
  ]);

  writeInfo("04-content-info.txt", [
    "Content Info",
    "============",
    "",
    `Posts (articles): ${dataset.posts.length}`,
    `Pages: ${dataset.pages.length}`,
    `Coupons: ${dataset.coupons.length}`,
    `Other WordPress items (menus, Elementor, theme parts, etc.): ${dataset.otherItems.length}`,
    "",
    "Useful pages include about/governance/licenses/contact content.",
    "Many pages are theme/WooCommerce utility pages and were kept in Excel",
    "even if the frontend catalog shows only the cleaned Arabic pages.",
    "",
    "Excel:",
    "- exports/excel/04-posts.xlsx",
    "- exports/excel/05-pages.xlsx",
    "- exports/excel/08-coupons.xlsx",
    "- exports/excel/09-other-content.xlsx",
  ]);

  writeInfo("05-how-to-use.txt", [
    "How to use this package",
    "=======================",
    "",
    "1. Browse the website:",
    "   open index.html",
    "",
    "2. Open Excel data:",
    "   exports/excel/*.xlsx",
    "",
    "3. Read explanations:",
    "   exports/info/*.txt",
    "",
    "4. Re-run full export + media download:",
    "   node export-all.js",
    "",
    "5. Rebuild frontend catalog only:",
    "   node build-catalog.js",
    "",
    "Notes:",
    "- Frontend prefers local media paths when the file exists under media/uploads.",
    "- If a local file is missing, the remote URL is used as fallback.",
  ]);

  // Rebuild frontend catalog, then rewrite image URLs to local when present.
  console.log("Rebuilding frontend catalog...");
  require("child_process").execFileSync(process.execPath, [path.join(ROOT, "build-catalog.js")], {
    cwd: ROOT,
    stdio: "inherit",
  });

  const catalogPath = path.join(DATA_DIR, "catalog.js");
  let catalogCode = fs.readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(catalogCode.replace(/^window\.CATALOG = /, "").replace(/;\s*$/, ""));

  function localizeUrl(url) {
    const mapped = toLocalOrRemote(url);
    return mapped.exists ? mapped.web : url;
  }

  function localizeBlocks(blocks) {
    return (blocks || []).map((block) => {
      if (block.type === "img" && block.src) return { ...block, src: localizeUrl(block.src) };
      if (block.type === "a" && block.href) {
        const mapped = toLocalOrRemote(block.href);
        if (mapped.exists) return { ...block, href: mapped.web };
      }
      return block;
    });
  }

  catalog.site.logo = localizeUrl(catalog.site.logo);
  for (const product of catalog.products) {
    product.image = localizeUrl(product.image);
    product.gallery = (product.gallery || []).map(localizeUrl);
    product.blocks = localizeBlocks(product.blocks);
    for (const variation of product.variations || []) {
      variation.image = localizeUrl(variation.image);
    }
  }
  for (const post of catalog.posts) {
    post.image = localizeUrl(post.image);
    post.blocks = localizeBlocks(post.blocks);
  }
  for (const page of catalog.pages) {
    page.image = localizeUrl(page.image);
    page.blocks = localizeBlocks(page.blocks);
  }

  fs.writeFileSync(catalogPath, "window.CATALOG = " + JSON.stringify(catalog) + ";\n", "utf8");

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "WordPress.2026-10-06.xml",
    site: dataset.site,
    counts: {
      items: dataset.itemCount,
      products: dataset.products.length,
      variations: dataset.variations.length,
      posts: dataset.posts.length,
      pages: dataset.pages.length,
      attachments: dataset.attachments.length,
      attachmentsLocal: localMediaCount,
      authors: dataset.authors.length,
      coupons: dataset.coupons.length,
      terms: dataset.terms.length,
      otherItems: dataset.otherItems.length,
      productSalesCountersSum: productSales,
    },
    downloadSummary: summary,
    folders: {
      excel: "exports/excel",
      info: "exports/info",
      json: "exports/json",
      media: "media/uploads",
      frontendCatalog: "data/catalog.js",
    },
    missingFromExport: ["shop orders", "customer accounts", "payment transactions"],
  };
  writeJson("manifest.json", manifest);
  writeInfo(
    "00-README.txt",
    fs
      .readFileSync(path.join(INFO_DIR, "00-README.txt"), "utf8")
      .trimEnd()
      .split("\n")
      .concat(["", `Manifest: exports/json/manifest.json`])
  );

  console.log("Done.");
  console.log(JSON.stringify(manifest.counts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
