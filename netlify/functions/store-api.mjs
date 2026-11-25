import { getStore } from "@netlify/blobs";
import { createHash, createHmac, randomUUID, randomBytes, timingSafeEqual } from "node:crypto";

const store = getStore({ name: "sizo-store", consistency: "strong" });
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const CHUNK = 3 * 1024 * 1024;          // taille fixe des morceaux de fichier
const MAX_RESPONSE = 4 * 1024 * 1024;   // une fonction Netlify ne peut pas répondre plus de ~6 Mo
const MAX_PARTS = { image: 2, video: 10 }; // image <= 6 Mo, vidéo <= 30 Mo
const MEDIA_TYPES = { "image/jpeg": "image", "image/png": "image", "image/webp": "image", "video/mp4": "video", "video/webm": "video" };
const ORDER_STATUS = ["Nouvelle", "Confirmée", "Expédiée", "Livrée", "Annulée"];
const INQUIRY_STATUS = ["Nouvelle", "Traitée"];
const FONTS = ["Arial,Helvetica,sans-serif", "Georgia,'Times New Roman',serif", "'Cormorant Garamond',Georgia,serif", "'Playfair Display',Georgia,serif", "'Montserrat',Arial,sans-serif", "'Poppins',Arial,sans-serif", "'Inter',Arial,sans-serif", "'Cairo',Arial,sans-serif", "'Tajawal',Arial,sans-serif"];
const BODY_SIZES = ["14px", "15px", "16px", "18px"];
const HEX = /^#[0-9a-f]{6}$/i;
const MEDIA_REF = /^\/media\/[a-f0-9]{16}$/;

const DEFAULT_SETTINGS = {
  name: "SIZO",
  topbar: "SIZO · COLLECTION CONTEMPORAINE · HOMME & FEMME · MAROC",
  heroTitle: "Le style\nsans effort.",
  heroText: "Des essentiels contemporains, des coupes soignées et une élégance facile à porter. Découvrez notre sélection pour elle et lui.",
  heroImage: "/assets/hero.jpg", heroVisible: true, heroPosition: "normal",
  aboutText: "SIZO imagine un vestiaire contemporain pour hommes et femmes : des silhouettes faciles à associer, des lignes épurées et des essentiels qui traversent les saisons.",
  bgColor: "#ffffff", textColor: "#202124", buttonColor: "#191919", buttonTextColor: "#ffffff", accentColor: "#b9975b", heroBgColor: "#f4f3f1",
  fontFamily: "Arial,Helvetica,sans-serif", headingFont: "'Cormorant Garamond',Georgia,serif", bodySize: "15px",
  phone: "", whatsapp: "", email: "", address: "",
  deliveryFee: 0, freeDeliveryFrom: 0,
};

/* ---------- utilitaires ---------- */
const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const readJson = async (request) => { try { return await request.json(); } catch { return {}; } };
const clean = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const money = (n) => Math.round(Number(n) * 100) / 100;
const sha = (s) => createHash("sha256").update(String(s)).digest();
const b64url = (buf) => Buffer.from(buf).toString("base64url");

async function sendOrderNotification(order) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ORDER_NOTIFICATION_EMAIL || "paesizo1312@gmail.com";
  if (!apiKey) {
    console.log("Order email skipped: RESEND_API_KEY is not configured.");
    return;
  }
  const lines = [
    `Nouvelle commande SIZO : ${order.id}`,
    "",
    `Client : ${order.customer.name}`,
    `Téléphone : ${order.customer.phone}`,
    `Ville : ${order.customer.city}`,
    `Adresse : ${order.customer.address}`,
    "",
    "Produits :",
    ...order.items.map((item) => `- ${item.name} | Couleur : ${item.color || "-"} | Taille : ${item.size || "-"} | Qté : ${item.quantity} | ${item.lineTotal} MAD`),
    "",
    `Total : ${order.total} MAD`,
    `Date : ${order.createdAt}`,
    `Statut : ${order.status}`,
  ];
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.ORDER_EMAIL_FROM || "SIZO <onboarding@resend.dev>",
      to: [to],
      subject: `Nouvelle commande SIZO ${order.id}`,
      text: lines.join("\n"),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend email failed (${response.status}): ${detail.slice(0, 500)}`);
  }
}

async function listJson(prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return rows.filter(Boolean);
}

/* Reprise des anciennes données (un seul fichier "products" / "orders") vers un fichier par élément. */
let migrated = false;
async function migrate() {
  if (migrated) return;
  for (const [legacy, prefix] of [["products", "products/"], ["orders", "orders/"]]) {
    const old = await store.get(legacy, { type: "json" }).catch(() => null);
    if (Array.isArray(old)) {
      for (const row of old) if (row?.id != null) await store.setJSON(prefix + row.id, row);
      await store.delete(legacy);
    }
  }
  migrated = true;
}

/* ---------- limitation de fréquence (par instance, en complément du champ piège) ---------- */
const hits = new Map();
function limited(ip, key, max, windowMs) {
  const k = key + ":" + ip, now = Date.now();
  const e = hits.get(k);
  if (!e || e.reset < now) { hits.set(k, { count: 1, reset: now + windowMs }); return false; }
  e.count += 1;
  if (hits.size > 5000) for (const [kk, v] of hits) if (v.reset < now) hits.delete(kk);
  return e.count > max;
}

/* ---------- authentification admin ---------- */
const secret = () => process.env.ADMIN_TOKEN_SECRET;
const sign = (payload) => {
  const data = b64url(JSON.stringify(payload));
  return data + "." + createHmac("sha256", secret()).update(data).digest("base64url");
};
function isAdmin(request) {
  try {
    if (!secret()) return false;
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const [data, sig] = token.split(".");
    if (!data || !sig) return false;
    const expected = createHmac("sha256", secret()).update(data).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    return JSON.parse(Buffer.from(data, "base64url").toString()).exp > Date.now();
  } catch { return false; }
}

/* ---------- produits ---------- */
const NAMED_COLORS = { noir: "#111111", blanc: "#ffffff", beige: "#d8c3a5", gris: "#9a9a9a", bleu: "#2c4a7c", rouge: "#b3261e", vert: "#2f6b4f", marron: "#6b4a2f", rose: "#e8a0b4", kaki: "#7a7a4a" };
const validMedia = (v) => typeof v === "string" && (MEDIA_REF.test(v) || /^https:\/\/[^\s]{4,900}$/.test(v));
function normColors(list) {
  return (Array.isArray(list) ? list : []).map((c) => typeof c === "string"
    ? { name: clean(c, 40), hex: NAMED_COLORS[c.toLowerCase()] || "#cccccc" }
    : { name: clean(c?.name, 40), hex: HEX.test(c?.hex || "") ? c.hex : "#cccccc" }).filter((c) => c.name).slice(0, 20);
}
function outProduct(p) {
  const images = Array.isArray(p.images) && p.images.length ? p.images : (p.img ? [p.img] : []);
  return { ...p, stock: Number.isInteger(p.stock) && p.stock >= 0 ? p.stock : null, colors: normColors(p.colors), sizes: Array.isArray(p.sizes) ? p.sizes : [], images, img: images[0] || "", video: p.video || "", active: p.active !== false };
}
const mediaIds = (p) => [...(p.images || []), p.video || ""].filter((u) => MEDIA_REF.test(u)).map((u) => u.slice(7));
async function readProducts() {
  await migrate();
  return (await listJson("products/")).map(outProduct).sort((a, b) => Number(b.id) - Number(a.id));
}

/* ---------- médias (fichiers envoyés en morceaux) ---------- */
async function deleteMedia(id) {
  const { blobs } = await store.list({ prefix: `media/${id}/` });
  await Promise.all(blobs.map((b) => store.delete(b.key)));
}
async function serveMedia(request, id) {
  if (!/^[a-f0-9]{16}$/.test(id || "")) return new Response("Introuvable", { status: 404 });
  const meta = await store.get(`media/${id}/meta`, { type: "json" });
  if (!meta) return new Response("Introuvable", { status: 404 });
  const size = meta.size;
  let start = 0, end = size - 1, partial = false;
  const range = request.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    partial = true;
    if (m[1] === "") start = Math.max(0, size - Number(m[2]));
    else { start = Number(m[1]); if (m[2] !== "") end = Math.min(end, Number(m[2])); }
    if (!(start <= end) || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  if (end - start + 1 > MAX_RESPONSE) { end = start + MAX_RESPONSE - 1; partial = true; }
  const first = Math.floor(start / CHUNK), last = Math.floor(end / CHUNK), parts = [];
  for (let i = first; i <= last; i++) parts.push(Buffer.from(await store.get(`media/${id}/${i}`, { type: "arrayBuffer" })));
  const body = Buffer.concat(parts).subarray(start - first * CHUNK, end - first * CHUNK + 1);
  const headers = { "content-type": meta.type, "content-length": String(body.length), "accept-ranges": "bytes", "cache-control": "public, max-age=31536000, immutable" };
  if (partial) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: partial ? 206 : 200, headers });
}

/* ---------- réglages ---------- */
async function readSettings() {
  // Deux essais : une erreur passagère de Netlify Blobs ne doit JAMAIS faire
  // afficher les réglages par défaut (l'ancien aspect de la boutique).
  let saved = null, lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { saved = await store.get("settings", { type: "json" }); lastError = null; break; }
    catch (e) { lastError = e; await new Promise((r) => setTimeout(r, 250)); }
  }
  if (lastError) throw lastError;
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}
function cleanSettings(b) {
  const s = {};
  for (const k of ["name", "topbar"]) s[k] = clean(b[k], 140) || DEFAULT_SETTINGS[k];
  s.heroTitle = clean(b.heroTitle, 100) || DEFAULT_SETTINGS.heroTitle;
  s.heroText = clean(b.heroText, 400);
  s.aboutText = clean(b.aboutText, 600);
  for (const k of ["bgColor", "textColor", "buttonColor", "buttonTextColor", "accentColor", "heroBgColor"]) s[k] = HEX.test(b[k] || "") ? b[k] : DEFAULT_SETTINGS[k];
  s.fontFamily = FONTS.includes(b.fontFamily) ? b.fontFamily : DEFAULT_SETTINGS.fontFamily;
  s.headingFont = FONTS.includes(b.headingFont) ? b.headingFont : DEFAULT_SETTINGS.headingFont;
  s.bodySize = BODY_SIZES.includes(b.bodySize) ? b.bodySize : DEFAULT_SETTINGS.bodySize;
  s.heroImage = b.heroImage === "/assets/hero.jpg" || validMedia(b.heroImage) ? b.heroImage : DEFAULT_SETTINGS.heroImage;
  s.heroVisible = b.heroVisible !== false && b.heroVisible !== "false";
  s.heroPosition = b.heroPosition === "image-first" ? "image-first" : "normal";
  s.phone = clean(b.phone, 30); s.whatsapp = clean(b.whatsapp, 30).replace(/[^\d+]/g, ""); s.email = clean(b.email, 100); s.address = clean(b.address, 200);
  s.deliveryFee = Math.max(0, money(num(b.deliveryFee))); s.freeDeliveryFrom = Math.max(0, money(num(b.freeDeliveryFrom)));
  return s;
}

/* ---------- gestionnaire principal ---------- */
export default async (request) => {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "products";
  const method = request.method;
  const ip = request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for") || "unknown";

  try {
    /* --- public --- */
    if (method === "GET" && action === "media") return await serveMedia(request, url.searchParams.get("id"));
    if (method === "GET" && action === "settings") return reply({ settings: await readSettings() }, 200, { "cache-control": "no-store, no-cache, must-revalidate" });
    if (method === "GET" && action === "products") {
      const all = url.searchParams.get("all") === "1" && isAdmin(request);
      const products = await readProducts();
      return reply({ products: all ? products : products.filter((p) => p.active) });
    }

    if (method === "POST" && action === "login") {
      if (!process.env.ADMIN_PASSWORD || !secret()) return reply({ error: "L'accès admin n'est pas encore configuré dans Netlify." }, 503);
      if (limited(ip, "login", 8, 15 * 60 * 1000)) return reply({ error: "Trop de tentatives. Réessayez dans quelques minutes." }, 429);
      const body = await readJson(request);
      const ok = typeof body.password === "string" && timingSafeEqual(sha(body.password), sha(process.env.ADMIN_PASSWORD));
      if (!ok) return reply({ error: "Mot de passe incorrect." }, 401);
      return reply({ token: sign({ exp: Date.now() + 8 * 3600 * 1000 }) });
    }

    if (method === "POST" && action === "orders") {
      const body = await readJson(request);
      if (body.website) return reply({ order: { id: "SZ-00000000", total: 0 } }, 201); // champ piège anti-robots
      if (limited(ip, "order", 10, 3600 * 1000)) return reply({ error: "Trop de commandes en peu de temps. Réessayez plus tard." }, 429);
      const c = body.customer || {};
      const name = clean(c.name, 100), city = clean(c.city, 100), address = clean(c.address, 250), notes = clean(c.notes, 300);
      const phone = clean(c.phone, 30).replace(/[\s.\-()]/g, "");
      if (!name || !city || !address || !/^(\+212|00212|0)[5-7]\d{8}$/.test(phone)) return reply({ error: "Vérifiez votre nom, téléphone marocain (ex. 06 12 34 56 78), ville et adresse." }, 400);
      if (!Array.isArray(body.items) || !body.items.length) return reply({ error: "Votre panier est vide." }, 400);
      const products = await readProducts(), items = [];
      for (const r of body.items.slice(0, 20)) {
        const p = products.find((x) => String(x.id) === String(r.productId) && x.active);
        const quantity = Math.floor(Number(r.quantity));
        const color = clean(r.color, 40), size = clean(r.size, 40);
        if (!p || !(quantity >= 1 && quantity <= 10)) return reply({ error: "Un produit n'est plus disponible. Actualisez la page et réessayez." }, 400);
        if ((p.colors.length && !p.colors.some((x) => x.name === color)) || (p.sizes.length && !p.sizes.includes(size))) return reply({ error: "Une option choisie n'est plus disponible. Actualisez la page." }, 400);
        const unitPrice = Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.price) ? Number(p.salePrice) : Number(p.price);
        items.push({ productId: p.id, name: p.name, price: unitPrice, color, size, quantity, lineTotal: money(unitPrice * quantity) });
      }
      const requested = new Map();
      for (const item of items) requested.set(String(item.productId), (requested.get(String(item.productId)) || 0) + item.quantity);
      for (const [productId, qty] of requested) { const p = products.find(x => String(x.id) === productId); if (p.stock !== null && p.stock < qty) return reply({ error: `Stock insuffisant pour ${p.name}. Quantité disponible : ${p.stock}.` }, 409); }
      const settings = await readSettings();
      const subtotal = money(items.reduce((s, i) => s + i.lineTotal, 0));
      const deliveryFee = 0; // Livraison gratuite sur toutes les commandes.
      const stockDeductions = [...requested].filter(([productId]) => products.find(p => String(p.id) === productId)?.stock !== null).map(([productId, quantity]) => ({ productId: Number(productId), quantity }));
      const order = { id: `SZ-${randomUUID().slice(0, 8).toUpperCase()}`, paymentMethod: "cod", createdAt: new Date().toISOString(), customer: { name, phone, city, address, notes }, items, stockDeductions, stockRestored: false, subtotal, deliveryFee, total: money(subtotal + deliveryFee), currency: "MAD", status: "Nouvelle" };
      for (const deduction of stockDeductions) { const p = products.find(x => Number(x.id) === deduction.productId); p.stock -= deduction.quantity; await store.setJSON(`products/${p.id}`, p); }
      await store.setJSON(`orders/${order.id}`, order);
      try { await sendOrderNotification(order); } catch (emailError) { console.error("Order email notification failed:", emailError); }
      return reply({ order: { id: order.id, subtotal, deliveryFee, total: order.total } }, 201);
    }

    if (method === "POST" && action === "inquiries") {
      const body = await readJson(request);
      if (body.website) return reply({ ok: true }, 201);
      if (limited(ip, "inquiry", 5, 3600 * 1000)) return reply({ error: "Trop de messages en peu de temps. Réessayez plus tard." }, 429);
      const name = clean(body.name, 100), phone = clean(body.phone, 30), whatsapp = clean(body.whatsapp, 30), message = clean(body.message, 1500);
      if (!name || message.length < 5 || !phone || !whatsapp) return reply({ error: "Indiquez votre nom, vos deux numéros (WhatsApp et téléphone) ainsi que votre message." }, 400);
      let productName = "";
      if (body.productId != null) productName = (await readProducts()).find((p) => String(p.id) === String(body.productId))?.name || "";
      const q = { id: `Q-${randomUUID().slice(0, 8).toUpperCase()}`, createdAt: new Date().toISOString(), name, phone, whatsapp, message, productId: productName ? body.productId : null, productName, status: "Nouvelle" };
      await store.setJSON(`inquiries/${q.id}`, q);
      return reply({ ok: true }, 201);
    }

    /* --- réservé à l'administration --- */
    if (!isAdmin(request)) return reply({ error: "Accès réservé à l'administration." }, 401);
    await migrate();

    if (method === "GET" && action === "orders") return reply({ orders: (await listJson("orders/")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    if (method === "GET" && action === "inquiries") return reply({ inquiries: (await listJson("inquiries/")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    if (method === "PATCH" && (action === "orders" || action === "inquiries")) {
      const body = await readJson(request), prefix = action + "/";
      const row = await store.get(prefix + clean(body.id, 20), { type: "json" });
      if (!row) return reply({ error: "Introuvable." }, 404);
      if (!(action === "orders" ? ORDER_STATUS : INQUIRY_STATUS).includes(body.status)) return reply({ error: "Statut invalide." }, 400);
      if (action === "orders" && body.status === "Annulée" && row.status !== "Annulée" && !row.stockRestored && Array.isArray(row.stockDeductions)) { for (const d of row.stockDeductions) { const p = await store.get(`products/${d.productId}`, { type: "json" }); if (p && Number.isInteger(p.stock)) { p.stock += Number(d.quantity) || 0; await store.setJSON(`products/${p.id}`, p); } } row.stockRestored = true; }
      if (action === "orders" && row.status === "Annulée" && body.status !== "Annulée" && row.stockRestored && Array.isArray(row.stockDeductions)) { const current = []; for (const d of row.stockDeductions) { const p = await store.get(`products/${d.productId}`, { type: "json" }); if (p && Number.isInteger(p.stock)) { if (p.stock < Number(d.quantity)) return reply({ error: `Stock insuffisant pour réactiver cette commande (${p.name}).` }, 409); current.push({ p, quantity: Number(d.quantity) || 0 }); } } for (const x of current) { x.p.stock -= x.quantity; await store.setJSON(`products/${x.p.id}`, x.p); } row.stockRestored = false; }
      row.status = body.status;
      await store.setJSON(prefix + row.id, row);
      return reply({ [action === "orders" ? "order" : "inquiry"]: row });
    }
    if (method === "DELETE" && (action === "orders" || action === "inquiries")) {
      const id = clean(url.searchParams.get("id"), 20);
      if (action === "orders") { const oldOrder = await store.get(`orders/${id}`, { type: "json" }); if (oldOrder && oldOrder.status !== "Annulée" && !oldOrder.stockRestored && Array.isArray(oldOrder.stockDeductions)) { for (const d of oldOrder.stockDeductions) { const p = await store.get(`products/${d.productId}`, { type: "json" }); if (p && Number.isInteger(p.stock)) { p.stock += Number(d.quantity) || 0; await store.setJSON(`products/${p.id}`, p); } } } }
      await store.delete(`${action}/${id}`);
      return reply({ ok: true });
    }

    if (method === "POST" && action === "products") {
      const b = await readJson(request);
      const name = clean(b.name, 100), price = money(num(b.price, NaN));
      const salePrice = b.salePrice == null || b.salePrice === "" ? null : money(num(b.salePrice, NaN));
      const stock = b.stock == null || b.stock === "" ? null : Number(b.stock);
      if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 1000000)) return reply({ error: "Le stock doit être un nombre entier positif ou nul." }, 400);
      if (!name || !Number.isFinite(price) || price < 0 || !["homme", "femme"].includes(b.category)) return reply({ error: "Vérifiez le nom, le prix et la collection." }, 400);
      if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice <= 0 || salePrice >= price)) return reply({ error: "Le prix réduit doit être positif et inférieur au prix normal." }, 400);
      const colors = normColors(b.colors);
      const sizes = (Array.isArray(b.sizes) ? b.sizes : []).map((x) => clean(x, 40)).filter(Boolean).slice(0, 20);
      const images = (Array.isArray(b.images) ? b.images : []).filter(validMedia).slice(0, 10);
      if (!colors.length || !sizes.length) return reply({ error: "Ajoutez au moins une couleur et une taille." }, 400);
      if (!images.length) return reply({ error: "Ajoutez au moins une photo." }, 400);
      const video = MEDIA_REF.test(b.video || "") ? b.video : "";
      const existing = await readProducts();
      const id = b.id ? Number(b.id) : Math.max(0, ...existing.map((p) => Number(p.id) || 0)) + 1;
      const old = existing.find((p) => Number(p.id) === id);
      const product = { id, name, price, salePrice, stock, category: b.category, tag: clean(b.tag, 40), description: clean(b.description, 2000), colors, sizes, images, img: images[0], video, active: b.active !== false };
      await store.setJSON(`products/${id}`, product);
      if (old) { const keep = new Set(mediaIds(product)); for (const m of mediaIds(old)) if (!keep.has(m)) await deleteMedia(m); }
      return reply({ product });
    }
    if (method === "DELETE" && action === "products") {
      const id = clean(url.searchParams.get("id"), 20);
      const old = (await readProducts()).find((p) => String(p.id) === id);
      await store.delete(`products/${id}`);
      if (old) for (const m of mediaIds(old)) await deleteMedia(m);
      return reply({ ok: true });
    }

    if (method === "POST" && action === "settings") {
      const old = await readSettings(), next = cleanSettings(await readJson(request));
      await store.setJSON("settings", next);
      if (MEDIA_REF.test(old.heroImage) && old.heroImage !== next.heroImage) await deleteMedia(old.heroImage.slice(7));
      return reply({ settings: next });
    }

    if (method === "POST" && action === "media-chunk") {
      const q = url.searchParams, type = q.get("type"), kind = MEDIA_TYPES[type];
      const part = Number(q.get("part")), total = Number(q.get("total"));
      if (!kind || !Number.isInteger(part) || !Number.isInteger(total) || total < 1 || total > MAX_PARTS[kind] || part < 0 || part >= total) return reply({ error: "Fichier non accepté (JPG, PNG, WebP, MP4 ou WebM ; photo ≤ 6 Mo, vidéo ≤ 30 Mo)." }, 400);
      const id = q.get("id") ? q.get("id") : randomBytes(8).toString("hex");
      if (!/^[a-f0-9]{16}$/.test(id)) return reply({ error: "Identifiant invalide." }, 400);
      const data = await request.arrayBuffer();
      if (!data.byteLength || data.byteLength > CHUNK || (part < total - 1 && data.byteLength !== CHUNK)) return reply({ error: "Morceau de fichier invalide." }, 400);
      await store.set(`media/${id}/${part}`, data, { metadata: { len: data.byteLength, at: Date.now() } });
      if (part === total - 1) {
        let size = 0;
        for (let i = 0; i < total; i++) {
          const md = await store.getMetadata(`media/${id}/${i}`);
          if (!md) return reply({ error: "Envoi incomplet. Réessayez." }, 400);
          size += Number(md.metadata?.len) || 0;
        }
        await store.setJSON(`media/${id}/meta`, { type, kind, size, parts: total, createdAt: Date.now() });
      }
      return reply({ id, url: `/media/${id}` });
    }

    if (method === "POST" && action === "media-cleanup") {
      const used = new Set();
      for (const p of await readProducts()) mediaIds(p).forEach((m) => used.add(m));
      const s = await readSettings();
      if (MEDIA_REF.test(s.heroImage)) used.add(s.heroImage.slice(7));
      const { blobs } = await store.list({ prefix: "media/" });
      const ids = new Set(blobs.map((b) => b.key.split("/")[1]));
      let removed = 0;
      for (const id of ids) {
        if (used.has(id)) continue;
        const first = blobs.find((b) => b.key.startsWith(`media/${id}/`));
        const md = await store.getMetadata(first.key);
        if (Date.now() - (Number(md?.metadata?.at) || 0) < 3600 * 1000) continue; // laisse les envois récents
        await deleteMedia(id); removed++;
      }
      return reply({ removed });
    }

    return reply({ error: "Action inconnue." }, 404);
  } catch (error) {
    console.error(error);
    return reply({ error: "Erreur serveur. Réessayez dans un instant." }, 500);
  }
};
