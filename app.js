const catalog = window.CATALOG;
const app = document.querySelector("#app");
const searchForm = document.querySelector(".search");
const searchInput = document.querySelector("#q");
const nav = document.querySelector("#site-nav");
const navToggle = document.querySelector(".nav-toggle");

const ui = { qty: {}, picked: {}, photo: {} };
let lastPath = "";

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

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return "غير محدد";
  const amount = Number(value);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return `\u2066${formatted}\u00A0ر.س\u2069`;
}

function priceText(item) {
  if (item.priceMin == null && item.priceMax == null) return "غير محدد";
  if (item.priceMin === item.priceMax) return money(item.priceMin);
  return `من ${money(item.priceMin)} إلى ${money(item.priceMax)}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso + "T00:00:00");
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function stockLabel(status) {
  if (status === "outofstock") return "غير متوفر";
  if (status === "onbackorder") return "متاح للطلب";
  return "متوفر";
}

function linkify(safeText) {
  return safeText.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const clean = url.replace(/[.,)]+$/, "");
    const tail = url.slice(clean.length);
    const label = /youtu\.?be/i.test(clean) ? "مشاهدة الفيديو" : "فتح الرابط";
    return `<a href="${clean}" target="_blank" rel="noopener">${label}</a>${tail}`;
  });
}

function renderBlocks(blocks) {
  let html = "";
  let list = [];
  const flush = () => {
    if (!list.length) return;
    html += `<ul>${list.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
    list = [];
  };
  for (const block of blocks) {
    if (block.type === "li") {
      list.push(block.text);
      continue;
    }
    flush();
    if (block.type === "h2") html += `<h2>${esc(block.text)}</h2>`;
    else if (block.type === "h3") html += `<h3>${esc(block.text)}</h3>`;
    else if (block.type === "img") html += `<figure><img src="${esc(block.src)}" alt="" loading="lazy"></figure>`;
    else if (block.type === "a") {
      html += `<p class="file-link"><a href="${esc(block.href)}" target="_blank" rel="noopener">${esc(block.text)}</a></p>`;
    } else html += `<p>${linkify(esc(block.text))}</p>`;
  }
  flush();
  return html;
}

function picture(src, className) {
  if (!src) return `<div class="${className} ph"></div>`;
  return `<img class="${className}" src="${esc(src)}" alt="" loading="lazy" />`;
}

function parseRoute() {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  return {
    parts: path.split("/").filter(Boolean),
    params: new URLSearchParams(query),
    path,
  };
}

function matchesQuery(entry, query) {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const haystack = norm(`${entry.title} ${entry.excerpt} ${entry.search || ""}`);
  return tokens.every((token) => haystack.includes(token));
}

function published(list, params) {
  const showDrafts = params.get("drafts") === "1";
  return list.filter((entry) => showDrafts || entry.status === "publish");
}

function projectHref(changes) {
  const params = new URLSearchParams(parseRoute().params);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return "#/projects" + (query ? `?${query}` : "");
}

function findById(list, id) {
  return list.find((entry) => entry.id === id);
}

function selectionFor(product) {
  if (!ui.picked[product.id] && product.variations.length) {
    const first = product.variations[0];
    ui.picked[product.id] = Object.fromEntries(first.attributes.map((attribute) => [attribute.key, attribute.slug]));
  }
  return ui.picked[product.id] || {};
}

function currentVariation(product) {
  const selected = selectionFor(product);
  return (
    product.variations.find((variation) =>
      variation.attributes.every((attribute) => selected[attribute.key] === attribute.slug)
    ) || null
  );
}

function attributeKeys(product) {
  const keys = [];
  for (const variation of product.variations) {
    for (const attribute of variation.attributes) {
      if (!keys.some((item) => item.key === attribute.key)) {
        keys.push({ key: attribute.key, label: attribute.label });
      }
    }
  }
  return keys;
}

function choices(product, key) {
  const selected = selectionFor(product);
  const map = new Map();
  for (const variation of product.variations) {
    const fits = variation.attributes.every(
      (attribute) => attribute.key === key || selected[attribute.key] === attribute.slug
    );
    if (!fits) continue;
    const attribute = variation.attributes.find((item) => item.key === key);
    if (!attribute || map.has(attribute.slug)) continue;
    map.set(attribute.slug, attribute);
  }
  return [...map.values()];
}

function activeImage(product) {
  if (ui.photo[product.id]) return ui.photo[product.id];
  const variation = currentVariation(product);
  return (variation && variation.image) || product.image;
}

function activePrice(product) {
  const variation = currentVariation(product);
  if (variation && variation.price != null) return variation.price;
  return product.priceMin;
}

function badges(product) {
  const items = [];
  if (product.status === "draft") items.push(`<span class="badge draft">مسودة</span>`);
  if (product.stockStatus === "outofstock") items.push(`<span class="badge warn">غير متوفر</span>`);
  if (product.variations.length) items.push(`<span class="badge">عدة خيارات</span>`);
  return items.length ? `<div class="badges">${items.join("")}</div>` : "";
}

function productCard(product) {
  const categories = product.categories.map((category) => category.name).join(" · ");
  const sales = product.totalSales > 0 ? `<span class="muted">${product.totalSales} طلب</span>` : "";
  return `<a class="card" href="#/projects/${product.id}">
    <div class="card-media">${picture(product.image, "cover")}${badges(product)}</div>
    <div class="card-body">
      <p class="kicker">${esc(categories || "مشروع")}</p>
      <h3>${esc(product.title)}</h3>
      <p class="excerpt clamp">${esc(product.excerpt)}</p>
      <div class="card-meta"><span class="price">${esc(priceText(product))}</span>${sales}</div>
    </div>
  </a>`;
}

function articleCard(post) {
  const media = post.image
    ? `<div class="card-media">${picture(post.image, "cover")}${post.status === "draft" ? `<div class="badges"><span class="badge draft">مسودة</span></div>` : ""}</div>`
    : "";
  return `<a class="card" href="#/articles/${post.id}">
    ${media}
    <div class="card-body">
      <p class="kicker">${esc(formatDate(post.date))}${post.status === "draft" && !post.image ? " · مسودة" : ""}</p>
      <h3>${esc(post.title)}</h3>
      <p class="excerpt clamp">${esc(post.excerpt || "مقال من أرشيف الموقع")}</p>
    </div>
  </a>`;
}

function renderHome() {
  const products = catalog.products.filter((product) => product.status === "publish");
  const posts = catalog.posts.filter((post) => post.status === "publish" && post.title);
  const featured = products
    .slice()
    .sort((a, b) => b.totalSales - a.totalSales || (a.date < b.date ? 1 : -1))
    .slice(0, 6);
  const mosaic = featured.filter((product) => product.image).slice(0, 3);
  const categories = categoryCounts(products).slice(0, 8);
  const categoryHtml = categories
    .map(
      (category) =>
        `<a class="chip" href="#/projects?cat=${encodeURIComponent(category.slug)}">${esc(category.name)} <span>${category.count}</span></a>`
    )
    .join("");

  app.innerHTML = `<div class="wrap">
    <section class="hero">
      <div>
        <p class="eyebrow">صدقة جارية · مكة المكرمة</p>
        <h1>مشاريع وقف إحسان في صورة أوضح</h1>
        <p>دليل للبيانات المستخرجة من الموقع السابق: وجبات الإفطار، السقيا، المصاحف، العربات، والبرامج العلاجية، مع السعر وخيارات كل مشروع.</p>
        <div class="hero-actions">
          <a class="btn" href="#/projects">تصفح المشاريع</a>
          <a class="btn alt" href="#/about">عن الوقف</a>
        </div>
      </div>
      <div class="mosaic">
        ${mosaic
          .map(
            (product) =>
              `<a href="#/projects/${product.id}">${picture(product.image, "cover")}<span>${esc(product.title)}</span></a>`
          )
          .join("")}
      </div>
    </section>
    <section class="stats">
      <div class="stat"><b>${products.length}</b><span>مشروع منشور</span></div>
      <div class="stat"><b>${categoryCounts(products).length}</b><span>تصنيف</span></div>
      <div class="stat"><b>${posts.length}</b><span>مقال</span></div>
      <div class="stat"><b>${catalog.pages.length}</b><span>صفحات تعريفية</span></div>
    </section>
    <div class="section-head"><h2>التصنيفات</h2><a href="#/projects">كل المشاريع</a></div>
    <div class="chips">${categoryHtml}</div>
    <div class="section-head"><h2>الأكثر طلباً</h2><a href="#/projects?sort=sales">عرض حسب الطلب</a></div>
    <div class="grid">${featured.map(productCard).join("")}</div>
    <div class="section-head"><h2>من المقالات</h2><a href="#/articles">كل المقالات</a></div>
    <div class="grid">${posts.slice(0, 3).map(articleCard).join("")}</div>
  </div>`;
}

function categoryCounts(products) {
  const counts = new Map();
  for (const product of products) {
    for (const category of product.categories) {
      if (!counts.has(category.slug)) counts.set(category.slug, { ...category, count: 0 });
      counts.get(category.slug).count += 1;
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar"));
}

function renderProjects() {
  const { params } = parseRoute();
  const query = params.get("q") || "";
  const category = params.get("cat") || "";
  const sort = params.get("sort") || "newest";
  const stock = params.get("stock") || "";
  let items = published(catalog.products, params).filter((product) => matchesQuery(product, query));
  if (category) items = items.filter((product) => product.categories.some((item) => item.slug === category));
  if (stock) items = items.filter((product) => product.stockStatus === stock);
  items = items.slice().sort((a, b) => compareProducts(a, b, sort));
  const counts = categoryCounts(published(catalog.products, params));
  const articleHits = published(catalog.posts, params).filter((post) => matchesQuery(post, query)).length;
  const chips = [`<a class="chip ${category ? "" : "is-on"}" href="${projectHref({ cat: "" })}">الكل</a>`]
    .concat(
      counts.map(
        (item) =>
          `<a class="chip ${item.slug === category ? "is-on" : ""}" href="${projectHref({ cat: item.slug })}">${esc(item.name)} <span>${item.count}</span></a>`
      )
    )
    .join("");

  app.innerHTML = `<div class="wrap">
    <h1 class="page-title">المشاريع</h1>
    <p class="page-intro">الأسعار والخيارات منقولة كما كانت في المتجر. العرض يشمل المشاريع المنشورة، ومنها ما كان مخفياً عن واجهة المتجر القديم.</p>
    <div class="chips" style="margin-top:16px">${chips}</div>
    <div class="toolbar">
      <select class="field" data-filter="sort" aria-label="ترتيب المشاريع">
        ${optionsHtml(
          [
            ["newest", "الأحدث"],
            ["sales", "الأكثر طلباً"],
            ["price-asc", "السعر: من الأقل"],
            ["price-desc", "السعر: من الأعلى"],
            ["name", "الاسم"],
          ],
          sort
        )}
      </select>
      <select class="field" data-filter="stock" aria-label="حالة التوفر">
        ${optionsHtml(
          [
            ["", "كل الحالات"],
            ["instock", "المتوفر"],
            ["outofstock", "غير المتوفر"],
          ],
          stock
        )}
      </select>
      <label class="check"><input type="checkbox" data-filter="drafts" ${params.get("drafts") === "1" ? "checked" : ""} /> عرض المسودات</label>
      <span class="muted">${items.length} مشروع</span>
    </div>
    ${
      query && articleHits
        ? `<p class="page-intro">توجد أيضاً ${articleHits} نتيجة في <a href="#/articles?q=${encodeURIComponent(query)}">المقالات</a>.</p>`
        : ""
    }
    ${items.length ? `<div class="grid">${items.map(productCard).join("")}</div>` : `<div class="empty"><h2>لا توجد مشاريع مطابقة</h2><p>جرّب كلمة أخرى أو أزل التصنيف.</p></div>`}
  </div>`;
}

function optionsHtml(pairs, current) {
  return pairs
    .map(([value, label]) => `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`)
    .join("");
}

function compareProducts(a, b, sort) {
  if (sort === "sales") return b.totalSales - a.totalSales;
  if (sort === "price-asc") return (a.priceMin ?? Infinity) - (b.priceMin ?? Infinity);
  if (sort === "price-desc") return (b.priceMax ?? -1) - (a.priceMax ?? -1);
  if (sort === "name") return a.title.localeCompare(b.title, "ar");
  return a.date < b.date ? 1 : -1;
}

function renderProduct(id) {
  const product = findById(catalog.products, id);
  if (!product) {
    app.innerHTML = `<div class="wrap"><div class="empty"><h1>المشروع غير موجود</h1><p><a href="#/projects">العودة إلى المشاريع</a></p></div></div>`;
    return;
  }
  const variation = currentVariation(product);
  const price = activePrice(product);
  const qty = ui.qty[product.id] || 1;
  const image = activeImage(product);
  const thumbs = product.gallery
    .map(
      (src) =>
        `<button type="button" data-photo="${esc(src)}" class="${src === image ? "is-on" : ""}" aria-label="عرض الصورة">${picture(src, "cover")}</button>`
    )
    .join("");
  const optionGroups = attributeKeys(product)
    .map((group) => {
      const selected = selectionFor(product)[group.key];
      const buttons = choices(product, group.key)
        .map((choice) => {
          const sample = product.variations.find((item) =>
            item.attributes.some((attribute) => attribute.key === group.key && attribute.slug === choice.slug)
          );
          const hint = sample && sample.price != null ? `<small>${esc(money(sample.price))}</small>` : "";
          return `<button type="button" class="option ${choice.slug === selected ? "is-on" : ""}" data-attr="${esc(group.key)}" data-value="${esc(choice.slug)}">${esc(choice.value)}${hint}</button>`;
        })
        .join("");
      return `<div class="options"><p>${esc(group.label)}</p><div class="option-list">${buttons}</div></div>`;
    })
    .join("");
  const descriptionBlocks = product.blocks.filter(
    (block) => block.type !== "img" || !product.gallery.includes(block.src)
  );
  const stock = variation ? variation.stockStatus : product.stockStatus;
  const note = variation && variation.description ? `<p>${esc(variation.description)}</p>` : "";
  const categories = product.categories
    .map((category) => `<a href="#/projects?cat=${encodeURIComponent(category.slug)}">${esc(category.name)}</a>`)
    .join(" · ");

  app.innerHTML = `<div class="wrap">
    <div class="detail">
      <div class="gallery">
        <div class="gallery-main">${picture(image, "cover")}</div>
        ${thumbs ? `<div class="thumbs">${thumbs}</div>` : ""}
      </div>
      <div class="panel">
        <p class="crumbs"><a href="#/">الرئيسية</a> / <a href="#/projects">المشاريع</a></p>
        <p class="kicker">${categories || "مشروع"}</p>
        <h1>${esc(product.title)}</h1>
        <div class="price-row">
          <span class="price">${esc(variation ? money(price) : priceText(product))}</span>
          <span class="badge ${stock === "outofstock" ? "warn" : ""}">${stockLabel(stock)}</span>
        </div>
        ${product.totalSales > 0 ? `<p class="muted">سُجّل هذا المشروع في ${product.totalSales} طلب ضمن البيانات القديمة.</p>` : ""}
        ${optionGroups}
        ${note}
        <div class="calc">
          <label>الكمية
            <input data-qty="${esc(product.id)}" data-price="${price ?? ""}" type="number" min="1" max="999" value="${qty}" />
          </label>
          <p>المجموع التقديري: <strong data-total>${price == null ? "غير محدد" : esc(money(price * qty))}</strong></p>
          <p class="fine">حاسبة للعرض فقط. لا يُنشأ طلب ولا يتم تحويل إلى الدفع.</p>
        </div>
        <div class="links">
          ${product.link ? `<a href="${esc(product.link)}" target="_blank" rel="noopener">الصفحة الأصلية</a>` : ""}
          <a href="#/projects">كل المشاريع</a>
        </div>
      </div>
    </div>
    <article class="prose">
      <h2>الوصف</h2>
      ${renderBlocks(descriptionBlocks) || `<p>${esc(product.excerpt || "لا يوجد وصف محفوظ لهذا المشروع.")}</p>`}
    </article>
  </div>`;
}

function renderArticles() {
  const { params } = parseRoute();
  const query = params.get("q") || "";
  const items = published(catalog.posts, params)
    .filter((post) => post.title && matchesQuery(post, query))
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const projectHits = published(catalog.products, params).filter((product) => matchesQuery(product, query)).length;
  app.innerHTML = `<div class="wrap">
    <h1 class="page-title">المقالات</h1>
    <p class="page-intro">مقالات الموقع السابق عن السقيا، إفطار الصائم، والمصاحف، وبرامج الوقف.</p>
    <div class="toolbar">
      <label class="check"><input type="checkbox" data-filter="drafts" data-base="articles" ${params.get("drafts") === "1" ? "checked" : ""} /> عرض المسودات</label>
      <span class="muted">${items.length} مقال</span>
    </div>
    ${
      query && projectHits
        ? `<p class="page-intro">توجد أيضاً ${projectHits} نتيجة في <a href="#/projects?q=${encodeURIComponent(query)}">المشاريع</a>.</p>`
        : ""
    }
    ${items.length ? `<div class="grid">${items.map(articleCard).join("")}</div>` : `<div class="empty"><h2>لا توجد مقالات مطابقة</h2></div>`}
  </div>`;
}

function renderArticle(id) {
  const post = findById(catalog.posts, id);
  if (!post) {
    app.innerHTML = `<div class="wrap"><div class="empty"><h1>المقال غير موجود</h1><p><a href="#/articles">العودة إلى المقالات</a></p></div></div>`;
    return;
  }
  app.innerHTML = `<div class="wrap">
    <p class="crumbs"><a href="#/">الرئيسية</a> / <a href="#/articles">المقالات</a></p>
    <h1 class="page-title">${esc(post.title)}</h1>
    <p class="page-intro">${esc(formatDate(post.date))}${post.status === "draft" ? " · مسودة" : ""}</p>
    <article class="prose">
      ${post.image ? `<figure>${picture(post.image, "cover")}</figure>` : ""}
      ${renderBlocks(post.blocks) || `<p>${esc(post.excerpt || "لا توجد تفاصيل محفوظة لهذا المقال.")}</p>`}
      ${post.link ? `<p class="file-link"><a href="${esc(post.link)}" target="_blank" rel="noopener">المقال الأصلي</a></p>` : ""}
    </article>
  </div>`;
}

function renderAbout() {
  const cards = catalog.pages
    .map((page) => {
      const summary = page.excerpt || (page.blocks.find((block) => block.type === "p") || {}).text || "صفحة من الموقع السابق";
      return `<a class="card about-card" href="#/about/${page.id}"><h2>${esc(page.title)}</h2><p class="excerpt clamp">${esc(summary)}</p></a>`;
    })
    .join("");
  app.innerHTML = `<div class="wrap">
    <h1 class="page-title">عن الوقف</h1>
    <p class="page-intro">صفحات التعريف والحوكمة والتراخيص كما وردت في التصدير، بعد تنظيف تنسيق القالب القديم.</p>
    <div class="about-grid" style="margin-top:16px">${cards}</div>
  </div>`;
}

function renderPage(id) {
  const page = findById(catalog.pages, id);
  if (!page) {
    app.innerHTML = `<div class="wrap"><div class="empty"><h1>الصفحة غير موجودة</h1><p><a href="#/about">العودة</a></p></div></div>`;
    return;
  }
  app.innerHTML = `<div class="wrap">
    <p class="crumbs"><a href="#/">الرئيسية</a> / <a href="#/about">عن الوقف</a></p>
    <h1 class="page-title">${esc(page.title)}</h1>
    <article class="prose">${renderBlocks(page.blocks)}</article>
  </div>`;
}

function render() {
  if (!catalog) {
    app.innerHTML = `<div class="wrap"><div class="empty"><h1>تعذر تحميل البيانات</h1></div></div>`;
    return;
  }
  const route = parseRoute();
  const [section, id] = route.parts;
  const pathKey = route.parts.join("/");
  if (section === "projects" && id) renderProduct(id);
  else if (section === "projects") renderProjects();
  else if (section === "articles" && id) renderArticle(id);
  else if (section === "articles") renderArticles();
  else if (section === "about" && id) renderPage(id);
  else if (section === "about") renderAbout();
  else if (!section) renderHome();
  else {
    app.innerHTML = `<div class="wrap"><div class="empty"><h1>الصفحة غير موجودة</h1><p><a href="#/">العودة للرئيسية</a></p></div></div>`;
  }
  if (pathKey !== lastPath) {
    window.scrollTo(0, 0);
    lastPath = pathKey;
  }
  const current = section || "home";
  for (const link of nav.querySelectorAll("a")) {
    if (link.dataset.nav === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const query = route.params.get("q") || "";
  if (document.activeElement !== searchInput) searchInput.value = query;
  nav.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
}

function chooseOption(productId, key, value) {
  const product = findById(catalog.products, productId);
  if (!product) return;
  const selected = { ...selectionFor(product), [key]: value };
  let match = product.variations.find((variation) =>
    variation.attributes.every((attribute) => selected[attribute.key] === attribute.slug)
  );
  if (!match) {
    match = product.variations.find((variation) =>
      variation.attributes.some((attribute) => attribute.key === key && attribute.slug === value)
    );
  }
  if (match) {
    ui.picked[product.id] = Object.fromEntries(match.attributes.map((attribute) => [attribute.key, attribute.slug]));
    if (match.image) ui.photo[product.id] = match.image;
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  const onArticles = location.hash.startsWith("#/articles");
  const base = onArticles ? "#/articles" : "#/projects";
  location.hash = query ? `${base}?q=${encodeURIComponent(query)}` : base;
});

navToggle.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", open ? "true" : "false");
});

document.addEventListener("click", (event) => {
  const option = event.target.closest("[data-attr]");
  if (option) {
    const route = parseRoute();
    chooseOption(route.parts[1], option.dataset.attr, option.dataset.value);
    render();
    return;
  }
  const photo = event.target.closest("[data-photo]");
  if (photo) {
    const route = parseRoute();
    ui.photo[route.parts[1]] = photo.dataset.photo;
    render();
  }
});

document.addEventListener("change", (event) => {
  const filter = event.target.closest("[data-filter]");
  if (!filter) return;
  const value = filter.type === "checkbox" ? (filter.checked ? "1" : "") : filter.value;
  const base = filter.dataset.base || "projects";
  const params = new URLSearchParams(parseRoute().params);
  if (value) params.set(filter.dataset.filter, value);
  else params.delete(filter.dataset.filter);
  const query = params.toString();
  location.hash = `#/${base}` + (query ? `?${query}` : "");
});

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-qty]");
  if (!input) return;
  const qty = Math.max(1, Math.min(999, Number(input.value) || 1));
  ui.qty[input.dataset.qty] = qty;
  const rawPrice = input.dataset.price;
  const price = rawPrice === "" ? Number.NaN : Number(rawPrice);
  const total = document.querySelector("[data-total]");
  if (total) total.textContent = Number.isFinite(price) ? money(price * qty) : "غير محدد";
});

document.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const fallback = document.createElement("div");
    fallback.className = `${image.className} ph`.trim();
    image.replaceWith(fallback);
  },
  true
);

window.addEventListener("hashchange", render);
if (!location.hash) location.hash = "#/";
render();
