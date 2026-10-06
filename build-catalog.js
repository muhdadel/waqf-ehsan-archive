/**
 * Reads WordPress.2026-10-06.xml and writes data/catalog.js
 * Run: node build-catalog.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const xml = fs.readFileSync(path.join(ROOT, "WordPress.2026-10-06.xml"), "utf8");
const [head, ...itemChunks] = xml.split("<item>");

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

function attr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const match = tag.match(re);
  return match ? decodeEntities(match[1]) : "";
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ");
}

function arabicRatio(text) {
  const arabic = (String(text).match(/[\u0600-\u06FF]/g) || []).length;
  const letters = (String(text).match(/[A-Za-z\u0600-\u06FF]/g) || []).length;
  return letters ? arabic / letters : 0;
}

function isSafeUrl(href) {
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
}

function linkLabel(href, text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  const generic = !cleaned || /^(اضغط هنا|فتح الملف|هنا|تحميل|download|click here)/i.test(cleaned);
  if (!generic && cleaned.length > 2) return cleaned.slice(0, 180);
  const file = href.split("?")[0].split("/").pop() || "";
  let name = file;
  try {
    name = decodeURIComponent(file);
  } catch {
    name = file;
  }
  name = name.replace(/\.(pdf|png|jpe?g|webp)$/i, "").replace(/[-_]+/g, " ").trim();
  return (name || cleaned || "فتح الملف").slice(0, 180);
}

function num(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function htmlToBlocks(raw) {
  if (!raw || !raw.trim()) return [];
  let source = raw.replace(/\r/g, "");
  source = source.replace(/<!--[\s\S]*?-->/g, "");
  source = source.replace(/<style[\s\S]*?<\/style>/gi, "");
  source = source.replace(/<script[\s\S]*?<\/script>/gi, "");
  source = source.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  source = source.replace(/<svg[\s\S]*?<\/svg>/gi, "");
  source = source.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  source = source.replace(/<(link|meta|form|input|button|source|video|audio|object|embed|canvas)\b[^>]*>/gi, "");

  const images = [];
  source = source.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attr(tag, "src");
    if (!src || src.startsWith("data:") || /\.svg($|\?)/i.test(src)) return "";
    if (/\/themes\/|\/plugins\/|emoji|gravatar/i.test(src)) return "";
    const sized = src.match(/-(\d+)x(\d+)\./);
    if (sized && Number(sized[1]) < 160 && Number(sized[2]) < 160) return "";
    images.push(src);
    return `\n[[IMG:${images.length - 1}]]\n`;
  });

  const links = [];
  source = source.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (full, inner) => {
    const href = attr(full, "href");
    const imgTokens = inner.match(/\[\[IMG:\d+\]\]/g) || [];
    const text = stripTags(inner)
      .replace(/\[\[IMG:\d+\]\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    let out = imgTokens.join("\n");
    const fileLink = /\.pdf($|\?)/i.test(href);
    if (href && isSafeUrl(href) && (text || fileLink)) {
      links.push({ href, text: linkLabel(href, text) });
      out += `\n[[A:${links.length - 1}]]\n`;
    } else if (text) {
      out += ` ${text} `;
    }
    return `\n${out}\n`;
  });

  source = source.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const text = stripTags(inner).replace(/\s+/g, " ").trim();
    if (!text) return "";
    const kind = Number(level) <= 2 ? "H2" : "H3";
    return `\n[[${kind}:${encodeURIComponent(text)}]]\n`;
  });

  source = source.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
    const text = stripTags(inner).replace(/\s+/g, " ").trim();
    return text ? `\n[[LI:${encodeURIComponent(text)}]]\n` : "";
  });

  source = source.replace(/<br\s*\/?>/gi, "\n");
  source = source.replace(/<\/(p|div|section|article|tr|blockquote|figcaption|td|li)>/gi, "\n");
  source = stripTags(source);
  source = decodeEntities(source).replace(/\u00a0/g, " ");

  const blocks = [];
  const seen = new Set();
  for (const line of source.split("\n")) {
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    let match;
    if ((match = trimmed.match(/^\[\[IMG:(\d+)\]\]$/))) {
      const src = images[Number(match[1])];
      if (src && !blocks.some((block) => block.type === "img" && block.src === src)) {
        blocks.push({ type: "img", src });
      }
      continue;
    }
    if ((match = trimmed.match(/^\[\[A:(\d+)\]\]$/))) {
      const link = links[Number(match[1])];
      if (link) blocks.push({ type: "a", href: link.href, text: link.text.slice(0, 180) });
      continue;
    }
    if ((match = trimmed.match(/^\[\[(H2|H3):([\s\S]*)\]\]$/))) {
      const text = safeDecode(match[2]);
      if (text && isUsefulText(text)) blocks.push({ type: match[1].toLowerCase(), text });
      continue;
    }
    if ((match = trimmed.match(/^\[\[LI:([\s\S]*)\]\]$/))) {
      const text = safeDecode(match[1]);
      if (text && isUsefulText(text)) blocks.push({ type: "li", text });
      continue;
    }
    if (!isUsefulText(trimmed)) continue;
    if (trimmed.length > 40) {
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
    }
    blocks.push({ type: "p", text: trimmed });
    if (blocks.length >= 120) break;
  }
  return blocks;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isUsefulText(text) {
  if (!text || text.length < 2) return false;
  if (/^[\d\s.,:+\-–—|%/]+$/.test(text)) return false;
  if (/[{}]/.test(text) && (text.match(/;/g) || []).length > 1) return false;
  if (/^(read more|add to cart|dashboard|my account|sale|home|menu|skip to content)$/i.test(text)) return false;
  if (!/[\u0600-\u06FF]/.test(text) && text.length > 28 && !/^https?:/i.test(text)) return false;
  if (text.length > 500 && arabicRatio(text) < 0.25) return false;
  return true;
}

function plainText(htmlOrText) {
  return decodeEntities(stripTags(htmlOrText)).replace(/\s+/g, " ").trim();
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

const terms = [];
const termRe =
  /<wp:term>([\s\S]*?)<\/wp:term>/g;
for (const match of head.matchAll(termRe)) {
  const block = match[1];
  const taxonomy = cdata(block, "wp:term_taxonomy");
  if (!taxonomy) continue;
  terms.push({
    id: plainTag(block, "wp:term_id"),
    taxonomy,
    slug: decodeSlug(cdata(block, "wp:term_slug")),
    parentSlug: decodeSlug(cdata(block, "wp:term_parent")),
    name: decodeEntities(cdata(block, "wp:term_name")).trim(),
  });
}

const termIndex = new Map();
for (const term of terms) {
  termIndex.set(`${term.taxonomy}::${term.slug}`, term);
  termIndex.set(`${term.taxonomy}::${decodeSlug(term.slug)}`, term);
}

function lookupTerm(taxonomy, slug) {
  const decoded = decodeSlug(slug);
  return (
    termIndex.get(`${taxonomy}::${slug}`) ||
    termIndex.get(`${taxonomy}::${decoded}`) ||
    null
  );
}

const items = itemChunks.map((chunk) => chunk.split("</item>")[0]);
const attachments = new Map();
const variations = [];
const products = [];
const posts = [];
const pages = [];

const SKIP_PAGE_IDS = new Set([
  "2", "7", "8", "9", "10", "11", "13", "19", "21", "23", "25", "27",
  "1582", "1583", "1584", "1586", "1651", "2239", "2360", "2376",
  "3444", "26689", "28164",
]);

for (const item of items) {
  const type = cdata(item, "wp:post_type");
  const id = plainTag(item, "wp:post_id");
  const status = cdata(item, "wp:status");
  const title = decodeEntities(cdata(item, "title")).trim();
  const link = (item.match(/<link>([^<]+)<\/link>/) || [])[1] || "";
  const date = cdata(item, "wp:post_date").slice(0, 10);
  const meta = parseMeta(item);

  if (type === "attachment") {
    const url = cdata(item, "wp:attachment_url");
    if (url) attachments.set(id, url);
    continue;
  }

  if (type === "product_variation") {
    const attributes = [];
    for (const [key, values] of meta.entries()) {
      if (!key.startsWith("attribute_") || !values[0]) continue;
      const taxonomy = decodeSlug(key.slice("attribute_".length));
      const slug = values[0];
      const term = lookupTerm(taxonomy, slug);
      const label = decodeSlug(taxonomy.replace(/^pa_/, "")).replace(/[-_]+/g, " ").trim();
      attributes.push({
        key: taxonomy,
        label: label || "الخيار",
        slug,
        value: term ? term.name : decodeSlug(slug).replace(/[-_]+/g, " "),
      });
    }
    variations.push({
      id,
      parent: plainTag(item, "wp:post_parent"),
      status,
      price: num(metaFirst(meta, "_price") || metaFirst(meta, "_regular_price")),
      regularPrice: num(metaFirst(meta, "_regular_price")),
      stockStatus: metaFirst(meta, "_stock_status") || "instock",
      imageId: metaFirst(meta, "_thumbnail_id"),
      description: plainText(metaFirst(meta, "_variation_description")).slice(0, 400),
      attributes,
    });
    continue;
  }

  if (type !== "product" && type !== "post" && type !== "page") continue;
  if (status !== "publish" && status !== "draft") continue;

  const content = cdata(item, "content:encoded");
  const excerptRaw = cdata(item, "excerpt:encoded");
  const blocks = htmlToBlocks(content);
  const excerpt = plainText(excerptRaw) || (blocks.find((block) => block.type === "p") || {}).text || "";
  const categories = parseCategories(item).filter((category) =>
    type === "product" ? category.domain === "product_cat" : category.domain === "category"
  );

  const base = {
    id,
    title,
    link,
    date,
    status,
    excerpt: excerpt.slice(0, 280),
    blocks,
    imageId: metaFirst(meta, "_thumbnail_id"),
    categories: categories
      .filter((category) => category.name && category.slug !== "uncategorized" && category.name !== "غير مصنف")
      .map((category) => ({ slug: category.slug, name: category.name })),
  };

  if (type === "product") {
    const productType = parseCategories(item).find((category) => category.domain === "product_type");
    const prices = (meta.get("_price") || []).map(num).filter((value) => value != null);
    const regulars = (meta.get("_regular_price") || []).map(num).filter((value) => value != null);
    products.push({
      ...base,
      kind: productType ? productType.slug : "simple",
      price: prices[0] ?? regulars[0] ?? null,
      regularPrice: regulars[0] ?? prices[0] ?? null,
      stockStatus: metaFirst(meta, "_stock_status") || "instock",
      totalSales: num(metaFirst(meta, "total_sales")) || 0,
      galleryIds: String(metaFirst(meta, "_product_image_gallery") || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    });
  } else if (type === "post") {
    if (!title) continue;
    posts.push(base);
  } else if (!SKIP_PAGE_IDS.has(id) && title && status === "publish") {
    if (id === "15") base.title = "من نحن";
    if (id === "17") base.title = "تواصل معنا";
    const text = blocks.filter((block) => block.text).map((block) => block.text).join(" ");
    const readable = text.length >= 40 && arabicRatio(text) >= 0.35;
    const visual = arabicRatio(base.title) >= 0.4 && blocks.length > 0 && text.length >= 8;
    if (readable || visual) pages.push(base);
  }
}

const variationsByParent = new Map();
for (const variation of variations) {
  if (variation.status !== "publish" && variation.status !== "inherit") continue;
  if (!variationsByParent.has(variation.parent)) variationsByParent.set(variation.parent, []);
  variationsByParent.get(variation.parent).push(variation);
}

function imageUrl(id) {
  if (!id || id === "0") return null;
  return attachments.get(id) || null;
}

const catalogProducts = products
  .map((product) => {
    const productVariations = (variationsByParent.get(product.id) || [])
      .map((variation, index) => {
        const attributes = variation.attributes.length
          ? variation.attributes
          : [{
              key: "option",
              label: "الخيار",
              slug: variation.id,
              value: variation.description || `خيار ${index + 1}`,
            }];
        return {
          id: variation.id,
          price: variation.price,
          regularPrice: variation.regularPrice,
          stockStatus: variation.stockStatus,
          image: imageUrl(variation.imageId),
          description: variation.description,
          attributes,
        };
      })
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

    const priced = productVariations.map((variation) => variation.price).filter((value) => value != null);
    const priceMin = priced.length ? Math.min(...priced) : product.price;
    const priceMax = priced.length ? Math.max(...priced) : product.price;
    const gallery = [];
    const main = imageUrl(product.imageId);
    if (main) gallery.push(main);
    for (const galleryId of product.galleryIds) {
      const url = imageUrl(galleryId);
      if (url && !gallery.includes(url)) gallery.push(url);
    }
    for (const variation of productVariations) {
      if (variation.image && !gallery.includes(variation.image)) gallery.push(variation.image);
    }

    const search = [
      product.title,
      product.excerpt,
      ...product.categories.map((category) => category.name),
      ...productVariations.flatMap((variation) => variation.attributes.map((attribute) => attribute.value)),
    ].join(" ");

    return {
      id: product.id,
      title: product.title,
      link: product.link,
      date: product.date,
      status: product.status,
      kind: product.kind,
      excerpt: product.excerpt,
      blocks: product.blocks,
      categories: product.categories,
      image: gallery[0] || null,
      gallery,
      priceMin,
      priceMax,
      stockStatus: product.stockStatus,
      totalSales: product.totalSales,
      variations: product.kind === "variable" ? productVariations : [],
      search,
    };
  })
  .sort((a, b) => (a.date < b.date ? 1 : -1));

function publicEntry(entry) {
  const search = [entry.title, entry.excerpt, ...entry.blocks.filter((block) => block.text).map((block) => block.text)]
    .join(" ")
    .slice(0, 2500);
  return {
    id: entry.id,
    title: entry.title,
    link: entry.link,
    date: entry.date,
    status: entry.status,
    excerpt: entry.excerpt,
    blocks: entry.blocks,
    categories: entry.categories,
    image: imageUrl(entry.imageId) || entry.blocks.find((block) => block.type === "img")?.src || null,
    search,
  };
}

const pageOrder = ["15", "3724", "3510", "3451", "3520", "3554", "3629", "3600", "17", "3"];
const catalogPages = pages
  .map(publicEntry)
  .sort((a, b) => {
    const ai = pageOrder.indexOf(a.id);
    const bi = pageOrder.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

const catalogPosts = posts.map(publicEntry).sort((a, b) => (a.date < b.date ? 1 : -1));

const usedSlugs = new Set(catalogProducts.flatMap((product) => product.categories.map((category) => category.slug)));
const catalogCategories = terms
  .filter((term) => term.taxonomy === "product_cat" && term.slug !== "uncategorized")
  .filter((term) => usedSlugs.has(term.slug) || terms.some((child) => child.parentSlug === term.slug && usedSlugs.has(child.slug)))
  .map((term) => ({
    id: term.id,
    slug: term.slug,
    name: term.name,
    parentSlug: term.parentSlug,
  }));

const catalog = {
  site: {
    title: "وقف إحسان",
    url: "https://waqfehsan.org.sa",
    logo: "https://waqfehsan.org.sa/wp-content/uploads/2025/09/logo.png",
    exportedAt: "2026-10-06",
    language: "ar",
  },
  categories: catalogCategories,
  products: catalogProducts,
  posts: catalogPosts,
  pages: catalogPages,
};

const outDir = path.join(ROOT, "data");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "catalog.js");
fs.writeFileSync(outFile, "window.CATALOG = " + JSON.stringify(catalog) + ";\n", "utf8");

console.log("products", catalog.products.length);
console.log("published", catalog.products.filter((product) => product.status === "publish").length);
console.log("with image", catalog.products.filter((product) => product.image).length);
console.log("variable", catalog.products.filter((product) => product.variations.length).length);
console.log("posts", catalog.posts.length);
console.log("pages", catalog.pages.map((page) => `${page.id} ${page.title} (${page.blocks.length})`).join(" | "));
const sample = catalog.products.find((product) => product.variations.length && product.status === "publish");
if (sample) {
  console.log("SAMPLE", sample.title, sample.priceMin, sample.priceMax);
  console.log(JSON.stringify(sample.variations[0], null, 2));
}
console.log("bytes", fs.statSync(outFile).size);
