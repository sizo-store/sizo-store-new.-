(() => {
"use strict";
const API = "/.netlify/functions/store-api?action=";
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 2 }).format(Number(n) || 0) + " MAD";
const saleOf = (p) => { const s = Number(p.salePrice); return Number.isFinite(s) && s > 0 && s < Number(p.price) ? s : null; };
const activePrice = (p) => saleOf(p) ?? (Number(p.price) || 0);
const priceMarkup = (p, cls = "price") => { const sale = saleOf(p); if (sale === null) return `<span class="${cls}">${fmt(p.price)}</span>`; const pct = Math.round((1 - sale / Number(p.price)) * 100); return `<span class="sale-prices"><del>${fmt(p.price)}</del><strong class="${cls}">${fmt(sale)}</strong><span class="discount-badge">-${pct}%</span></span>`; };
const FONT_FAMILIES = { "Cormorant Garamond": "Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,700", "Playfair Display": "Playfair+Display:wght@400;500;700", Montserrat: "Montserrat:wght@400;500;600;700", Poppins: "Poppins:wght@400;500;600;700", Inter: "Inter:wght@400;500;600;700", Cairo: "Cairo:wght@400;600;700", Tajawal: "Tajawal:wght@400;500;700" };
const PHONE_RE = /^(\+212|00212|0)[5-7]\d{8}$/;

async function api(action, method = "GET", data) {
  // Les lectures sont retentées (3 essais) et jamais mises en cache par le navigateur.
  const tries = method === "GET" ? 3 : 1;
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(API + action + (method === "GET" ? "&_=" + Date.now() : ""), { method, cache: "no-store", headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined });
      const j = await r.json().catch(() => ({ error: "Réponse serveur invalide" }));
      if (!r.ok) throw new Error(j.error || "Erreur serveur");
      return j;
    } catch (e) { lastError = e; if (i < tries - 1) await new Promise((res) => setTimeout(res, 400 * (i + 1))); }
  }
  throw lastError;
}

let settings = {}, products = [], filter = "all", sel = null, view = "cart", lastOrder = null, inquiryProduct = null, lastFocus = null, directOrder = null;
let cart = (() => { try { const c = JSON.parse(localStorage.getItem("sizo_cart_v2") || "[]"); return Array.isArray(c) ? c : []; } catch { return []; } })();
const saveCart = () => { try { localStorage.setItem("sizo_cart_v2", JSON.stringify(cart)); } catch {} };
const findProduct = (id) => products.find((p) => String(p.id) === String(id));
const waLink = (num, text = "") => { let d = String(num).replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); else if (d.startsWith("0")) d = "212" + d.slice(1); return "https://wa.me/" + d + (text ? "?text=" + encodeURIComponent(text) : ""); };
const mediaUrl = (value) => { const m = /^\/media\/([a-f0-9]{16})$/.exec(String(value || "")); return m ? API + "media&id=" + m[1] : value; };

/* ---------- réglages ---------- */
function applySettings(s) {
  settings = s;
  const root = document.documentElement.style;
  root.setProperty("--bg", s.bgColor); root.setProperty("--text", s.textColor); root.setProperty("--button", s.buttonColor);
  root.setProperty("--button-text", s.buttonTextColor); root.setProperty("--accent", s.accentColor); root.setProperty("--hero-bg", s.heroBgColor);
  root.setProperty("--font", s.fontFamily); root.setProperty("--heading", s.headingFont);
  root.setProperty("--hero-img", 'url("' + String(mediaUrl(s.heroImage) || "/assets/hero.jpg").replace(/"/g, "%22") + '")');
  const hero = document.querySelector(".hero"); if (hero) { hero.classList.toggle("hero-hidden", s.heroVisible === false); hero.classList.toggle("hero-image-first", s.heroPosition === "image-first"); }
  document.body.style.fontSize = s.bodySize;
  const fams = [...new Set([s.fontFamily, s.headingFont].map((f) => (/'([^']+)'/.exec(f) || [])[1]).filter((n) => FONT_FAMILIES[n]))];
  if (fams.length) $("gfonts").href = "https://fonts.googleapis.com/css2?" + fams.map((n) => "family=" + FONT_FAMILIES[n]).join("&") + "&display=swap";
  $("topbar").textContent = s.topbar; $("logo").textContent = s.name; $("footLogo").textContent = s.name;
  $("heroTitle").textContent = s.heroTitle; $("heroText").textContent = s.heroText; $("aboutText").textContent = s.aboutText;
  document.title = s.name + " | Mode Homme & Femme";
  const del = "Livraison gratuite";
  const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  $("benefits").innerHTML = [
    ["https://assets.youcan.shop/stores/19e145172cda1dea1c8a58162346fca313ff96a8/cash-on-delivery_1-2vT0sGwjgBVaZGmY6ZoIdpvLZvh.webp", "Paiement", "Paiement à la livraison"],
    ["https://assets.youcan.shop/stores/19e145172cda1dea1c8a58162346fca313ff96a8/download-2vT0nK8ivsU9rFztvCIDIMMaU8X.png", "Livraison", "Livraison gratuite"],
    ["https://assets.youcan.shop/stores/19e145172cda1dea1c8a58162346fca313ff96a8/delivery-status_1__2-2vT0oTJWxz64oy2HPB2pJ4fRoJ3.webp", "Produit vérifié", "Contrôle qualité avant livraison"],
    ["https://assets.youcan.shop/stores/19e145172cda1dea1c8a58162346fca313ff96a8/contact-mail_1-2vT0q2kMFTzZ3wUIx9gCuAD49MM.webp", "Assistance", "Contactez-nous 7j/7"],
  ].map(([image, title, description]) => `<article class="benefit"><img src="${image}" alt="${esc(title)}" loading="lazy"><h3>${esc(title)}</h3><p>${esc(description)}</p></article>`).join("");
  const c = [];
  if (s.phone) c.push(`<li>Téléphone : <a href="tel:${esc(s.phone.replace(/\s/g, ""))}">${esc(s.phone)}</a></li>`);
  if (s.whatsapp) c.push(`<li>WhatsApp : <a class="wa-link" href="${esc(waLink(s.whatsapp))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.4L3 20l.9-4.7a8.5 8.5 0 1 1 16.6-3.6Z"/><path d="M8.7 8.2c.2-.5.5-.5.8-.5h.4c.2 0 .3.1.4.4l.7 1.7c.1.2.1.4-.1.6l-.5.6c-.2.2-.2.3 0 .6.4.7 1 1.3 1.7 1.7.2.1.4.1.6-.1l.7-.8c.2-.2.4-.2.6-.1l1.6.8c.2.1.3.2.3.4 0 .3-.2 1-.6 1.3-.4.4-1 .6-1.6.5-1-.1-2.2-.7-3.4-1.7-1-.9-1.8-2-2.1-2.9-.3-.9 0-1.8.5-2.5Z"/></svg>Écrire sur WhatsApp</a></li>`);
  if (s.email) c.push(`<li>Email : <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>`);
  if (s.address) c.push(`<li>Adresse : ${esc(s.address)}</li>`);
  $("contactInfo").innerHTML = c.join("");
  renderDrawer();
}

/* ---------- catalogue ---------- */
function renderProducts() {
  const list = products.filter((p) => filter === "all" || p.category === filter);
  document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("active", b.dataset.v === filter));
  $("productGrid").innerHTML = list.length ? list.map((p) => `<article class="card" tabindex="0" role="button" data-act="open" data-id="${esc(p.id)}" aria-label="Voir ${esc(p.name)}">
    <div class="card-img"><img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy">${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ""}</div>
    <div class="card-info"><div class="type">${p.category === "homme" ? "Homme" : "Femme"}</div><h3>${esc(p.name)}</h3><p class="card-desc">${esc(p.description || "")}</p>${priceMarkup(p)}
    <div class="dots">${p.colors.slice(0, 6).map((c) => `<span class="dot" style="background:${esc(c.hex)}" title="${esc(c.name)}"></span>`).join("")}</div></div></article>`).join("")
    : `<div class="empty">La collection arrive bientôt. Revenez nous voir.</div>`;
}

/* ---------- fiche produit ---------- */
function galleryItems(p) { const images = Array.isArray(p.images) && p.images.length ? p.images : (p.img ? [p.img] : []); return images.map((u) => ({ t: "i", u })); }
function stageHtml(it, name) { return it.t === "v" ? `<video src="${esc(it.u)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(it.u)}" alt="${esc(name)}" data-lightbox-src="${esc(it.u)}">`; }
function showLightbox(src, alt) { let box = $("imageLightbox"); if (!box) { box = document.createElement("div"); box.id = "imageLightbox"; box.className = "image-lightbox"; box.innerHTML = '<button type="button" class="lightbox-x" aria-label="Fermer">×</button><img alt="">'; document.body.appendChild(box); box.addEventListener("click", (e) => { if (e.target === box || e.target.closest(".lightbox-x")) box.classList.remove("open"); }); } box.querySelector("img").src = src; box.querySelector("img").alt = alt || ""; box.classList.add("open"); }
function showProductVideo(src) { let box = $("productVideoLightbox"); if (!box) { box = document.createElement("div"); box.id = "productVideoLightbox"; box.className = "product-video-lightbox"; box.innerHTML = '<div class="product-video-window"><div class="product-video-bar"><span>Vidéo du produit · déplacer</span><button type="button" class="product-video-close" data-act="closeVideo" aria-label="Fermer">×</button></div><video controls playsinline autoplay></video></div>'; document.body.appendChild(box); const win = box.querySelector(".product-video-window"), bar = box.querySelector(".product-video-bar"); let drag = null; bar.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; const r = win.getBoundingClientRect(); drag = { x: e.clientX-r.left, y: e.clientY-r.top }; bar.setPointerCapture(e.pointerId); }); bar.addEventListener("pointermove", (e) => { if (!drag) return; const x = Math.max(0, Math.min(innerWidth-win.offsetWidth, e.clientX-drag.x)); const y = Math.max(0, Math.min(innerHeight-win.offsetHeight, e.clientY-drag.y)); win.style.left = x+"px"; win.style.top = y+"px"; }); const stop = () => { drag = null; }; bar.addEventListener("pointerup", stop); bar.addEventListener("pointercancel", stop); } const video = box.querySelector("video"); video.src = src; box.classList.add("open"); video.play().catch(() => {}); }
function enableVideoPreviewDrag(button) {
  const area = button.closest(".detail");
  if (!area) return;
  let drag = null;
  button.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".video-preview-remove")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const r = button.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      left: r.left - a.left + area.scrollLeft,
      top: r.top - a.top + area.scrollTop,
      areaWidth: area.clientWidth, areaHeight: area.scrollHeight,
      width: r.width, height: r.height,
      moved: false
    };
    button.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  button.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const x = Math.max(0, Math.min(drag.areaWidth - drag.width, drag.left + dx));
    const y = Math.max(0, Math.min(drag.areaHeight - drag.height, drag.top + dy));
    button.style.setProperty("left", x + "px", "important");
    button.style.setProperty("top", y + "px", "important");
    button.style.setProperty("right", "auto", "important");
    button.style.setProperty("bottom", "auto", "important");
    e.preventDefault();
  });
  const finish = (e) => {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    if (drag.moved) button.dataset.dragged = "1";
    drag = null;
    button.classList.remove("is-dragging");
  };
  button.addEventListener("pointerup", finish);
  button.addEventListener("pointercancel", finish);
}
function closeProductVideo() { const box = $("productVideoLightbox"); if (box) { box.querySelector("video")?.pause(); box.classList.remove("open"); } }
function openProduct(id) {
  const p = findProduct(id); if (!p) return;
  sel = { p, color: p.colors[0]?.name || "", size: p.sizes.length === 1 ? p.sizes[0] : "", qty: 1, media: 0 };
  const items = galleryItems(p);
  $("detail").innerHTML = `<button class="x" data-act="closeProduct" aria-label="Fermer">×</button>
  <div class="gallery"><div class="stage" id="stage">${stageHtml(items[0], p.name)}${p.video ? `<div class="video-preview" data-act="openVideo" role="button" tabindex="0" aria-label="Ouvrir la vidéo"><video src="${esc(p.video)}" muted autoplay loop playsinline preload="metadata"></video><button type="button" class="video-preview-remove" data-act="removeVideo" aria-label="Masquer la vidéo" title="Masquer la vidéo">×</button></div>` : ""}<button type="button" class="product-copy-icon" data-act="share" aria-label="Copier le lien du produit" title="Copier le lien"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></svg></button></div>
    ${items.length > 1 ? `<div class="thumbs">${items.map((it, i) => `<button type="button" class="${i === 0 ? "on" : ""}" data-act="media" data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(it.u)}" alt=""></button>`).join("")}</div>` : ""}</div>
  <div class="info"><div class="kicker">${p.category === "homme" ? "Collection homme" : "Collection femme"}</div><div class="product-heading-row"><h2 id="dTitle">${esc(p.name)}</h2>${p.description ? `<p class="desc product-inline-description">${esc(p.description)}</p>` : ""}</div>
    <div class="dprice">${priceMarkup(p, "sale-current-price")}</div>
    <span class="label">Couleur : <b id="dColor">${esc(sel.color)}</b></span><div class="choices">${p.colors.map((c) => `<button type="button" class="choice sw ${c.name === sel.color ? "on" : ""}" style="background:${esc(c.hex)}" data-act="color" data-v="${esc(c.name)}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join("")}</div>
    <span class="label">Taille</span><div class="choices" id="dSizes">${p.sizes.map((z) => `<button type="button" class="choice ${z === sel.size ? "on" : ""}" data-act="size" data-v="${esc(z)}">${esc(z)}</button>`).join("")}</div>
    <span class="label">Quantité</span><div class="qty"><button type="button" data-act="dqty" data-d="-1" aria-label="Diminuer">−</button><span id="dQty">1</span><button type="button" data-act="dqty" data-d="1" aria-label="Augmenter">+</button></div>
    <p class="msg err" id="dMsg" role="alert"></p>
    <div class="actions"><div class="commander-wrap"><button class="btn" data-act="commander">Commander</button><small class="cod-under-commander">Paiement à la livraison</small></div><button class="btn ghost" data-act="addSel">Ajouter au panier</button>
      <button class="btn ghost" data-act="ask">Poser une question</button></div>
    </div>`;
  const videoPreview = $("detail").querySelector(".video-preview");
  if (videoPreview) {
    const detail = $("detail");
    const stage = videoPreview.closest(".stage");
    detail.appendChild(videoPreview);
    videoPreview.style.setProperty("position", "absolute", "important");
    videoPreview.style.setProperty("right", "auto", "important");
    videoPreview.style.setProperty("bottom", "auto", "important");
    videoPreview.style.setProperty("transform", "none", "important");
    enableVideoPreviewDrag(videoPreview);
    videoPreview.addEventListener("click", (e) => {
    if (e.target.closest(".video-preview-remove")) return;
    if (videoPreview.dataset.dragged === "1") { delete videoPreview.dataset.dragged; e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (sel?.p?.video) showProductVideo(sel.p.video);
    });
  }
  lastFocus = document.activeElement;
  $("modal").classList.add("open"); $("modal").setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden";
  if (videoPreview) {
    const stageRect = stage.getBoundingClientRect();
    const detailRect = $("detail").getBoundingClientRect();
    videoPreview.style.setProperty("left", (stageRect.left - detailRect.left + 12) + "px", "important");
    videoPreview.style.setProperty("top", (stageRect.top - detailRect.top + stageRect.height - videoPreview.offsetHeight - 12) + "px", "important");
  }
  $("detail").querySelector(".x").focus();
  try { history.replaceState(null, "", "/?product=" + encodeURIComponent(p.id)); } catch {}
}
function closeProduct() {
  $("modal").classList.remove("open"); $("modal").setAttribute("aria-hidden", "true");
  $("stage")?.querySelector("video")?.pause(); $("detail")?.querySelector(".video-preview video")?.pause(); closeProductVideo();
  if (!$("drawer").classList.contains("open")) document.body.style.overflow = "";
  try { history.replaceState(null, "", location.pathname); } catch {}
  lastFocus?.focus?.();
}

/* ---------- panier ---------- */
function lines() {
  const source = directOrder ? [directOrder] : cart;
  return source.map((l) => ({ ...l, p: findProduct(l.pid) })).filter((l) => l.p);
}
function totals() {
  const sub = lines().reduce((s, l) => s + activePrice(l.p) * l.qty, 0);
  const free = settings.freeDeliveryFrom > 0 && sub >= settings.freeDeliveryFrom;
  const fee = 0;
  return { sub, fee, total: sub + fee };
}
function updateCount() { $("cartCount").textContent = cart.reduce((s, l) => s + l.qty, 0); }
function addToCart(pid, color, size, qty) {
  const hit = cart.find((l) => String(l.pid) === String(pid) && l.color === color && l.size === size);
  if (hit) hit.qty = Math.min(10, hit.qty + qty); else cart.push({ pid, color, size, qty });
  saveCart(); updateCount();
}
function sumHtml(t) {
  return `<div class="sum"><span>Sous-total</span><span>${fmt(t.sub)}</span></div><div class="sum"><span>Livraison</span><span>${t.fee ? fmt(t.fee) : "Gratuite"}</span></div><div class="sum total"><span>Total à payer</span><span>${fmt(t.total)}</span></div>`;
}
function renderDrawer() {
  updateCount();
  const body = $("drawerBody"), foot = $("drawerFoot"), L = lines(), t = totals();
  $("drawerTitle").textContent = view === "checkout" ? "Finaliser la commande" : view === "done" ? "Merci !" : "Votre panier";
  if (view === "done" && lastOrder) {
    body.innerHTML = `<div class="done"><div class="check">✓</div><h3>Commande enregistrée</h3><p>Numéro de commande : <strong>${esc(lastOrder.id)}</strong></p><p>Total à payer à la livraison : <strong>${fmt(lastOrder.total)}</strong></p><p class="note">Nous vous contacterons très bientôt par téléphone pour confirmer la livraison.</p></div>`;
    foot.innerHTML = '<button class="btn" data-act="closeCart">Continuer mes achats</button>'; return;
  }
  if (!L.length) { view = "cart"; body.innerHTML = '<p class="note" style="font-size:13px;padding:24px 0">Votre panier est vide pour le moment.</p>'; foot.innerHTML = ""; return; }
  if (view === "checkout") {
    body.innerHTML = `<form class="f" id="orderForm" novalidate>
      <section class="payment-method" aria-label="Mode de paiement"><span class="payment-kicker">MODE DE PAIEMENT</span><strong>💵 Paiement à la livraison</strong><p>Vous payez en espèces au livreur au moment de recevoir votre commande. Aucun paiement en ligne.</p><span class="payment-only">Méthode de paiement unique</span></section><p class="note">Remplissez vos coordonnées de livraison.</p>
      <label for="cName">Nom complet *</label><input id="cName" autocomplete="name" required maxlength="100">
      <label for="cPhone">Téléphone *</label><input id="cPhone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="06 12 34 56 78">
      <label for="cCity">Ville *</label><input id="cCity" autocomplete="address-level2" required maxlength="100">
      <label for="cAddress">Adresse de livraison *</label><textarea id="cAddress" autocomplete="street-address" required maxlength="250" placeholder="Quartier, rue, numéro, repère…"></textarea>
      <input class="hp" id="cWebsite" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="msg err" id="orderMsg" role="alert"></p></form>`;
    foot.innerHTML = sumHtml(t) + '<button class="btn" type="submit" form="orderForm" id="orderBtn">Confirmer la commande</button><button class="btn ghost" style="margin-top:8px" data-act="backCart">← Retour au panier</button>'; return;
  }
  body.innerHTML = L.map((l, i) => `<div class="line"><img src="${esc(l.p.img)}" alt=""><div><strong>${esc(l.p.name)}</strong><small>${fmt(activePrice(l.p))} · ${esc(l.color)}${l.size ? " · " + esc(l.size) : ""}</small></div><div class="line-actions"><div class="qty"><button data-act="cqty" data-i="${i}" data-d="-1" aria-label="Diminuer">−</button><span>${l.qty}</span><button data-act="cqty" data-i="${i}" data-d="1" aria-label="Augmenter">+</button></div><button class="line-delete" data-act="removeCart" data-i="${i}" aria-label="Supprimer cet article" title="Supprimer">×</button></div></div>`).join("");
  foot.innerHTML = sumHtml(t) + '<button class="btn" data-act="checkout">Passer la commande</button><p class="note">Paiement à la livraison. Votre commande est envoyée directement à la boutique.</p>';
}
function openCart() { lastFocus = document.activeElement; renderDrawer(); $("drawer").classList.add("open"); $("overlay").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; $("drawer").querySelector(".x").focus(); }
function closeCart() {
  $("drawer").classList.remove("open"); $("overlay").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true");
  if (!$("modal").classList.contains("open")) document.body.style.overflow = "";
  if (view === "done") { view = "cart"; renderDrawer(); }
}

async function submitOrder(e) {
  e.preventDefault();
  const msg = $("orderMsg"), btn = $("orderBtn"); msg.textContent = "";
  const customer = { name: $("cName").value.trim(), phone: $("cPhone").value.trim(), city: $("cCity").value.trim(), address: $("cAddress").value.trim() };
  if (!customer.name || !customer.city || !customer.address) { msg.textContent = "Remplissez votre nom, ville et adresse."; return; }
  if (!PHONE_RE.test(customer.phone.replace(/[\s.\-()]/g, ""))) { msg.textContent = "Entrez un numéro marocain valide, par exemple 06 12 34 56 78."; return; }
  btn.disabled = true;
  try {
    const r = await api("orders", "POST", { customer, website: $("cWebsite").value, paymentMethod: "cod", items: lines().map((l) => ({ productId: l.p.id, color: l.color, size: l.size, quantity: l.qty })) });
    lastOrder = r.order; if (directOrder) directOrder = null; else { cart = []; saveCart(); } view = "done"; renderDrawer();
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
}
async function submitInquiry(e) {
  e.preventDefault();
  const msg = $("qMsg"), btn = e.target.querySelector("button[type=submit]"); msg.className = "msg"; msg.textContent = "";
  btn.disabled = true;
  try {
    await api("inquiries", "POST", { name: $("qName").value, phone: $("qPhone").value, whatsapp: $("qWhatsapp").value, message: $("qMessage").value, website: $("qWebsite").value, productId: inquiryProduct });
    e.target.reset(); inquiryProduct = null; msg.className = "msg ok"; msg.textContent = "Merci ! Votre message a bien été envoyé. Nous vous répondrons bientôt.";
  } catch (err) { msg.className = "msg err"; msg.textContent = err.message; }
  btn.disabled = false;
}

/* ---------- événements ---------- */
document.addEventListener("click", (e) => {
  if (e.target.id === "modal") return closeProduct();
  if (e.target.id === "productVideoLightbox") return closeProductVideo();
  if (e.target.matches("#stage img[data-lightbox-src]")) { showLightbox(e.target.dataset.lightboxSrc, e.target.alt); return; }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const d = el.dataset;
  switch (d.act) {
    case "openCart": openCart(); break;
    case "closeCart": closeCart(); break;
    case "filter": filter = d.v; renderProducts(); break;
    case "open": openProduct(d.id); break;
    case "closeProduct": closeProduct(); break;
    case "media": { const it = galleryItems(sel.p)[Number(d.i)]; $("stage").innerHTML = stageHtml(it, sel.p.name); document.querySelectorAll(".thumbs button").forEach((b, i) => b.classList.toggle("on", i === Number(d.i))); break; }
    case "openVideo": showProductVideo(sel.p.video); break;
    case "removeVideo": { const preview = el.closest(".video-preview"); if (preview) preview.remove(); break; }
    case "closeVideo": closeProductVideo(); break;
    case "color": sel.color = d.v; $("dColor").textContent = d.v; document.querySelectorAll(".sw").forEach((b) => b.classList.toggle("on", b.dataset.v === d.v)); break;
    case "size": sel.size = d.v; $("dMsg").textContent = ""; document.querySelectorAll("#dSizes .choice").forEach((b) => b.classList.toggle("on", b.dataset.v === d.v)); break;
    case "dqty": sel.qty = Math.max(1, Math.min(10, sel.qty + Number(d.d))); $("dQty").textContent = sel.qty; break;
    case "commander":
      if (sel.p.sizes.length && !sel.size) { $("dMsg").textContent = "Choisissez une taille."; break; }
      directOrder = { pid: sel.p.id, color: sel.color, size: sel.size, qty: sel.qty }; closeProduct(); view = "checkout"; renderDrawer(); $("drawer").classList.add("open"); $("overlay").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; $("cName")?.focus(); break;
    case "addSel":
      if (sel.p.sizes.length && !sel.size) { $("dMsg").textContent = "Choisissez une taille."; break; }
      directOrder = null; addToCart(sel.p.id, sel.color, sel.size, sel.qty); closeProduct(); view = "cart"; openCart(); break;
    case "share": { const link = location.origin + "/?product=" + sel.p.id; (navigator.clipboard && isSecureContext ? navigator.clipboard.writeText(link).then(() => { el.textContent = "Lien copié ✓"; }) : Promise.reject()).catch(() => prompt("Copiez ce lien :", link)); break; }
    case "ask": inquiryProduct = sel.p.id; $("qMessage").value = `Bonjour, j’ai une question sur « ${sel.p.name} » : `; closeProduct(); $("contact").scrollIntoView(); $("qName").focus(); break;
    case "cqty": { const l = cart[Number(d.i)]; if (!l) break; l.qty += Number(d.d); if (l.qty < 1) cart.splice(Number(d.i), 1); l.qty = Math.min(10, l.qty); saveCart(); renderDrawer(); break; }
    case "removeCart": { const i = Number(d.i); if (Number.isInteger(i) && i >= 0 && i < cart.length) { cart.splice(i, 1); saveCart(); renderDrawer(); } break; }
    case "checkout": directOrder = null; view = "checkout"; renderDrawer(); $("cName").focus(); break;
    case "backCart": directOrder = null; view = "cart"; renderDrawer(); break;
  }
});
document.addEventListener("touchstart", (e) => { const stage=$("stage"); if (!stage || !stage.contains(e.target) || !sel) return; window.__sizoTouchX=e.changedTouches[0].clientX; }, {passive:true});
document.addEventListener("touchend", (e) => { const stage=$("stage"); if (!stage || !stage.contains(e.target) || window.__sizoTouchX == null || !sel) return; const dx=e.changedTouches[0].clientX-window.__sizoTouchX; window.__sizoTouchX=null; if(Math.abs(dx)<45) return; const items=galleryItems(sel.p); if(items.length<2) return; const active=document.querySelector(".thumbs button.on"); const current=active ? Number(active.dataset.i) : 0; const next=Math.max(0,Math.min(items.length-1,current+(dx<0?1:-1))); document.querySelector(`.thumbs button[data-i="${next}"]`)?.click(); }, {passive:true});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if ($("modal").classList.contains("open")) closeProduct(); else if ($("drawer").classList.contains("open")) closeCart(); }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".card")) { e.preventDefault(); openProduct(e.target.dataset.id); }
});
document.addEventListener("submit", (e) => { if (e.target.id === "orderForm") submitOrder(e); else if (e.target.id === "inquiryForm") submitInquiry(e);  });

 
/* ---------- démarrage ---------- */

// Apply the saved store settings before showing the page, preventing a flash
// of the default hero image and default typography on first paint.
(async () => {
  try {
    const fontLink = $("gfonts");
    const previousFontHref = fontLink ? fontLink.href : "";
    const s = await api("settings");
    if (s && s.settings) applySettings(s.settings);

    // Wait only when the settings actually changed the Google Fonts URL.
    if (fontLink && fontLink.href !== previousFontHref) {
      await new Promise((resolve) => {
        fontLink.addEventListener("load", resolve, { once: true });
        fontLink.addEventListener("error", resolve, { once: true });
      });
    }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch (error) {
    console.error("Settings loading error:", error);
  } finally {
    document.body.classList.remove("settings-loading");
  }
})();

// Load and display products as soon as they are available.
(async () => {
  try {
    const p = await api("products");

    const items = Array.isArray(p.products) ? p.products : [];

    products = items.map((item) => ({
      ...item,
      img: mediaUrl(item.img),
      images: Array.isArray(item.images)
        ? item.images.map(mediaUrl)
        : item.images,
      video: mediaUrl(item.video)
    }));

    renderProducts();

  } catch (error) {
    console.error("Products loading error:", error);
    $("productGrid").innerHTML =
      '<div class="empty">Impossible de charger la collection. Rechargez la page.</div>';
  }

  // Restore only cart items that still match available products.
  cart = cart.filter((l) => {
    const pr = findProduct(l.pid);
    if (!pr || !Array.isArray(pr.colors) || !pr.colors.some((c) => c.name === l.color) ||
      (pr.sizes.length && !pr.sizes.includes(l.size)) || l.qty < 1) return false;
    l.p = pr; // Actualise le prix du panier avec le prix promotionnel actuel.
    return true;
  });

  saveCart();
  renderDrawer();

  // Open a product directly when its URL is requested.
  const id = new URLSearchParams(location.search).get("product");
  if (id) openProduct(id);
})();
})();
