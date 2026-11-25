(() => {
"use strict";
const API = "/.netlify/functions/store-api?action=";
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 2 }).format(Number(n) || 0) + " MAD";
const mediaUrl = (value) => { const m = /^\/media\/([a-f0-9]{16})$/.exec(String(value || "")); return m ? API + "media&id=" + m[1] : value; };
const ORDER_STATUS = ["Nouvelle", "Confirmée", "Expédiée", "Livrée", "Annulée"];
const FONTS = [["Arial,Helvetica,sans-serif", "Arial — simple"], ["Georgia,'Times New Roman',serif", "Georgia — classique"], ["'Cormorant Garamond',Georgia,serif", "Cormorant — luxe"], ["'Playfair Display',Georgia,serif", "Playfair Display — élégant"], ["'Montserrat',Arial,sans-serif", "Montserrat — moderne"], ["'Poppins',Arial,sans-serif", "Poppins — arrondi"], ["'Inter',Arial,sans-serif", "Inter — lisible"], ["'Cairo',Arial,sans-serif", "Cairo — arabe/latin"], ["'Tajawal',Arial,sans-serif", "Tajawal — arabe/latin"]];
const CHUNK = 3 * 1024 * 1024, MAX_PARTS = { image: 2, video: 10 };
let token = sessionStorage.getItem("sizo_admin_token") || "", orders = [], products = [], inquiries = [], settings = {};
let knownOrderIds = null, orderPollStarted = false;
let form = { images: [], video: "", colors: [] };
const waLink = (num) => { let d = String(num).replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); else if (d.startsWith("0")) d = "212" + d.slice(1); return "https://wa.me/" + d; };

async function api(action, method = "GET", data = null, extra = "") {
  const headers = {}; if (data) headers["Content-Type"] = "application/json"; if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(API + action + extra, { method, cache: "no-store", headers, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json().catch(() => ({ error: "Réponse invalide" }));
  if (r.status === 401 && token && action !== "login") { logout(); throw new Error("Session expirée. Reconnectez-vous."); }
  if (!r.ok) throw new Error(j.error || "Erreur serveur");
  return j;
}

/* ---------- connexion ---------- */
async function login(e) {
  e.preventDefault(); $("loginError").textContent = "";
  try { const r = await api("login", "POST", { password: $("password").value }); token = r.token; sessionStorage.setItem("sizo_admin_token", token); $("password").value = ""; await openDashboard(); }
  catch (err) { $("loginError").textContent = err.message; }
}
async function openDashboard() {
  $("loginBox").classList.add("hidden"); $("dashboard").classList.remove("hidden");
  try { await Promise.all([loadOrders(), loadProducts(), loadInquiries(), loadSettings()]); knownOrderIds = new Set(orders.map(o => String(o.id))); renderAdminOverview(); renderCustomers(); renderStatistics(); startOrderPolling(); } catch (err) { if (token) alert(err.message); }
}
function logout() { token = ""; sessionStorage.removeItem("sizo_admin_token"); $("dashboard").classList.add("hidden"); $("loginBox").classList.remove("hidden"); }
async function enableNotifications(){
  const btn=$("notifyBtn");
  if(!("Notification" in window)){ alert("Ce navigateur ne prend pas en charge les notifications."); return; }
  if(!window.isSecureContext){ alert("Les notifications nécessitent une connexion HTTPS."); return; }
  try{
    const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
    if(permission==="granted"){ if(btn)btn.textContent="Notifications activées ✓"; alert("Notifications activées. Vous recevrez une alerte lorsqu'une nouvelle commande arrive, tant que cette page Admin reste ouverte."); }
    else if(permission==="denied"){ alert("Les notifications sont bloquées dans les paramètres du navigateur. Autorisez-les pour ce site puis réessayez."); }
    else { alert("Autorisation des notifications non accordée."); }
  }catch(err){ alert("Impossible d'activer les notifications : "+err.message); }
}
function notifyNewOrder(order){
  if(!("Notification" in window)||Notification.permission!=="granted")return;
  const customer=order.customer?.name||"Nouveau client";
  const items=(order.items||[]).map(i=>i.name+" × "+Number(i.quantity||1)).join(", ");
  try{
    const n=new Notification("Nouvelle commande SIZO",{body:customer+" · "+(items||"Commande reçue")+" · "+fmt(order.total),tag:"sizo-order-"+order.id});
    n.onclick=()=>{window.focus();tab("orders");n.close();};
  }catch(err){}
}
function startOrderPolling(){ if(orderPollStarted)return; orderPollStarted=true; setInterval(async()=>{ if(!token)return; try{ const fresh=(await api("orders")).orders||[]; const added=fresh.filter(o=>knownOrderIds && !knownOrderIds.has(String(o.id))); if(knownOrderIds){ for(const o of fresh)knownOrderIds.add(String(o.id)); } orders=fresh; await loadProducts(); renderOrders(); renderAdminOverview(); renderCustomers(); renderStatistics(); if(added.length){ $("orderAlertText").textContent=added.length===1?"وصل طلب جديد للمتجر":"وصلو "+added.length+" طلبات جداد للمتجر"; $("orderAlert").classList.remove("hidden"); added.forEach(notifyNewOrder); } }catch(e){} },45000); }
function tab(v) {
  for (const t of ["home", "orders", "products", "customers", "inquiries", "stats", "settings"]) $("tab-" + t).classList.toggle("hidden", t !== v);
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.v === v));
}

/* ---------- commandes ---------- */
async function loadOrders() { orders = (await api("orders")).orders || []; renderOrders(); }
function renderOrders() {
  const f = $("oFilter").value, q = $("oSearch").value.trim().toLowerCase();
  const list = orders.filter((o) => (!f || o.status === f) && (!q || [o.id, o.customer.name, o.customer.phone, o.customer.city].join(" ").toLowerCase().includes(q)));
  $("oCount").textContent = orders.length;
  $("oPending").textContent = orders.filter((o) => ["Nouvelle", "Confirmée"].includes(o.status)).length;
  $("oRevenue").textContent = fmt(orders.filter((o) => o.status !== "Annulée").reduce((s, o) => s + (Number(o.total) || 0), 0));
  $("ordersList").innerHTML = list.length ? list.map((o) => `<article class="item ${o.status === "Nouvelle" ? "new" : ""}"><div>
    <strong>${esc(o.id)} · ${fmt(o.total)}</strong>
    <p>Client : ${esc(o.customer.name)} · <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a> · <a href="${esc(waLink(o.customer.phone))}" target="_blank" rel="noopener">WhatsApp</a></p>
    <p>Livraison : ${esc(o.customer.city)} — ${esc(o.customer.address)}</p><p><strong>Mode de paiement : Paiement à la livraison (COD)</strong></p>${o.customer.notes ? `<p>Remarque : ${esc(o.customer.notes)}</p>` : ""}
    <p>${(o.items || []).map((i) => `${esc(i.name)} (${esc(i.color)}${i.size ? ", " + esc(i.size) : ""}) × ${Number(i.quantity)} = ${fmt(i.lineTotal)}`).join("<br>")}</p>
    <p class="note">Sous-total ${fmt(o.subtotal ?? o.total)} · Livraison ${o.deliveryFee ? fmt(o.deliveryFee) : "gratuite"} · ${new Date(o.createdAt).toLocaleString("fr-MA")}</p></div>
    <div class="side"><select data-act="ostatus" data-id="${esc(o.id)}">${ORDER_STATUS.map((s) => `<option ${o.status === s ? "selected" : ""}>${s}</option>`).join("")}</select><button class="danger small" data-act="delOrder" data-id="${esc(o.id)}">Supprimer</button></div></article>`).join("")
    : '<p class="note">Aucune commande.</p>';
}

function uniqueCustomers() {
 const map=new Map();
 for(const o of orders){const key=String(o.customer?.phone||o.customer?.name||o.id).replace(/\s/g,"").toLowerCase();const c=map.get(key)||{...o.customer,count:0,total:0,lastOrder:o.createdAt};c.count++;c.total+=Number(o.total)||0;if(new Date(o.createdAt)>new Date(c.lastOrder))c.lastOrder=o.createdAt;map.set(key,c);}
 return [...map.values()].sort((a,b)=>new Date(b.lastOrder)-new Date(a.lastOrder));
}
function renderAdminOverview(){
 const valid=orders.filter(o=>o.status!=="Annulée"),cs=uniqueCustomers(),lowStock=products.filter(p=>p.stock!==null&&p.stock!==undefined&&Number(p.stock)<=5);
 $("hRevenue").textContent=fmt(valid.reduce((s,o)=>s+(Number(o.total)||0),0));$("hOrders").textContent=orders.length;$("hPending").textContent=orders.filter(o=>["Nouvelle","Confirmée"].includes(o.status)).length;$("hProducts").textContent=products.filter(p=>p.active).length;$("hCustomers").textContent=cs.length;$("hInquiries").textContent=inquiries.filter(q=>q.status==="Nouvelle").length;$("hLowStock").textContent=lowStock.length;
 const latest=[...orders].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5);
 $("homeLatest").innerHTML=latest.length?latest.map(o=>'<article class="item"><div><strong>'+esc(o.id)+' · '+fmt(o.total)+'</strong><p>'+esc(o.customer?.name)+' · '+esc(o.customer?.phone)+' · '+esc(o.customer?.city)+'</p><p class="note">'+new Date(o.createdAt).toLocaleString("fr-MA")+' · '+esc(o.status)+'</p></div></article>').join(""):'<p class="note">Aucune commande pour le moment.</p>';
}
function renderCustomers(){
 const q=($("cSearch")?.value||"").trim().toLowerCase(),list=uniqueCustomers().filter(c=>[c.name,c.phone,c.city,c.address].join(" ").toLowerCase().includes(q));
 $("customersList").innerHTML=list.length?list.map(c=>'<article class="item"><div><strong>'+esc(c.name||"Client")+'</strong><p><a href="tel:'+esc(c.phone)+'">'+esc(c.phone||"")+'</a> · '+esc(c.city||"")+'</p><p class="note">'+c.count+' commande(s) · Total commandé : '+fmt(c.total)+' · Dernière commande : '+new Date(c.lastOrder).toLocaleDateString("fr-MA")+'</p><p>'+esc(c.address||"")+'</p></div><div class="side">'+(c.phone?'<a href="'+esc(waLink(c.phone))+'" target="_blank" rel="noopener">WhatsApp ↗</a>':"")+'</div></article>').join(""):'<p class="note">Aucun client trouvé.</p>';
}
function renderStatistics(){
 const valid=orders.filter(o=>o.status!=="Annulée"),delivered=orders.filter(o=>o.status==="Livrée"),revenue=valid.reduce((s,o)=>s+(Number(o.total)||0),0);
 $("stRevenue").textContent=fmt(revenue);$("stAverage").textContent=fmt(valid.length?revenue/valid.length:0);$("stDelivered").textContent=delivered.length;$("stRate").textContent=(orders.length?Math.round(delivered.length/orders.length*100):0)+" %";
 const colors={"Nouvelle":"#d6a84b","Confirmée":"#8b9bb4","Expédiée":"#4b9ac6","Livrée":"#31966b","Annulée":"#c85b5b"};
 const statusCounts=ORDER_STATUS.map(status=>({status,count:orders.filter(o=>o.status===status).length,color:colors[status]}));
 const total=orders.length;let offset=0;const stops=[];
 for(const item of statusCounts){const start=total?offset/total*100:0;offset+=item.count;const end=total?offset/total*100:0;if(item.count)stops.push(`${item.color} ${start}% ${end}%`);}
 $("stDonut").style.background=total?`conic-gradient(${stops.join(",")})`:"#e9e9e9";$("stDonutTotal").textContent=total;
 $("stLegend").innerHTML=statusCounts.map(x=>`<div class="donut-legend-item"><span class="legend-dot" style="background:${x.color}"></span><span>${esc(x.status)}</span><strong>${x.count}</strong></div>`).join("");
 $("stStatuses").innerHTML=ORDER_STATUS.map(s=>'<p class="row between"><span>'+esc(s)+'</span><strong>'+orders.filter(o=>o.status===s).length+'</strong></p>').join("");
 const counts=new Map();for(const o of valid)for(const i of o.items||[])counts.set(i.name,(counts.get(i.name)||0)+(Number(i.quantity)||0));const top=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
 $("stProducts").innerHTML=top.length?top.map(([name,n])=>'<p class="row between"><span>'+esc(name)+'</span><strong>'+n+' vendu(s)</strong></p>').join(""):'<p class="note">Pas encore de ventes.</p>';
}
function exportCustomersCsv(){
 const rows=[["Nom","Téléphone","Ville","Adresse","Nombre de commandes","Total commandé MAD","Dernière commande"],...uniqueCustomers().map(c=>[c.name,c.phone,c.city,c.address,c.count,c.total,c.lastOrder])];
 const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"}));a.download="SIZO-clients.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function csvCell(v) { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
function exportCsv() {
  if (!orders.length) return alert("Aucune commande.");
  const rows = [["Commande", "Date", "Nom", "Téléphone", "Ville", "Adresse", "Mode de paiement", "Remarque", "Articles", "Sous-total MAD", "Livraison MAD", "Total MAD", "Statut"],
    ...orders.map((o) => [o.id, o.createdAt, o.customer.name, o.customer.phone, o.customer.city, o.customer.address, "Paiement à la livraison (COD)", o.customer.notes || "", (o.items || []).map((i) => `${i.name} ${i.color} ${i.size} x${i.quantity}`).join(" | "), o.subtotal ?? o.total, o.deliveryFee ?? 0, o.total, o.status])];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = "SIZO-commandes.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- demandes clients ---------- */
async function loadInquiries() {
  inquiries = (await api("inquiries")).inquiries || [];
  const n = inquiries.filter((q) => q.status === "Nouvelle").length;
  $("qBadge").textContent = n; $("qBadge").classList.toggle("hidden", !n);
  $("inqList").innerHTML = inquiries.length ? inquiries.map((q) => `<article class="item ${q.status === "Nouvelle" ? "new" : ""}"><div><strong>${esc(q.name)}</strong> <span class="note">${esc(q.id)} · ${new Date(q.createdAt).toLocaleString("fr-MA")}</span>
    <p>${esc(q.message)}</p>${q.productName ? `<p class="note">Produit concerné : ${esc(q.productName)}</p>` : ""}
    <p>${q.whatsapp ? `<a href="${esc(waLink(q.whatsapp))}" target="_blank" rel="noopener">WhatsApp : ${esc(q.whatsapp)}</a>` : `<span class="note">WhatsApp : non renseigné</span>`} · ${q.phone ? `<a href="tel:${esc(q.phone)}">Appeler : ${esc(q.phone)}</a>` : `<span class="note">Appel : non renseigné</span>`}</p>
    ${q.whatsapp ? `<div class="reply-box"><label for="reply-${esc(q.id)}">Répondre au client sur WhatsApp</label><textarea class="reply-message" id="reply-${esc(q.id)}" maxlength="1500" placeholder="Écrivez votre réponse ici…"></textarea><button type="button" class="small" data-act="replyInquiry" data-id="${esc(q.id)}">Répondre sur WhatsApp ↗</button><p class="note">Votre réponse s’ouvrira dans WhatsApp. Vérifiez-la puis appuyez sur Envoyer.</p></div>` : `<p class="note">Le client n’a pas renseigné de numéro WhatsApp.</p>`}</div>
    <div class="side"><select data-act="qstatus" data-id="${esc(q.id)}">${["Nouvelle", "Traitée"].map((s) => `<option ${q.status === s ? "selected" : ""}>${s}</option>`).join("")}</select><button class="danger small" data-act="delInq" data-id="${esc(q.id)}">Supprimer</button></div></article>`).join("")
    : '<p class="note">Aucune demande pour le moment.</p>';
}

/* ---------- produits ---------- */
async function loadProducts() { products = (await api("products", "GET", null, "&all=1")).products || []; renderProductList(); }
function renderProductList() {
  $("productList").innerHTML = products.length ? products.map((p) => `<div class="prod ${p.active ? "" : "off"}"><img src="${esc(mediaUrl(p.img))}" alt=""><div><strong>${esc(p.name)}</strong><p class="note" style="margin:3px 0 0">${p.salePrice && Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.price) ? `<del>${fmt(p.price)}</del> <strong>${fmt(p.salePrice)}</strong>` : fmt(p.price)} · ${p.category === "homme" ? "Homme" : "Femme"}${p.active ? "" : " · masqué"}${p.video ? " · vidéo" : ""} · ${p.stock===null||p.stock===undefined?"Stock non suivi":Number(p.stock)===0?"Rupture de stock":Number(p.stock)<=5?`<strong class=\"error\">Stock faible : ${Number(p.stock)}</strong>`:`Stock : ${Number(p.stock)}`}</p></div><button class="secondary small" data-act="editProduct" data-id="${esc(p.id)}">Modifier</button></div>`).join("")
    : '<p class="note">Ajoutez votre premier produit.</p>';
}
function mediaThumb(u, kind, i, n) {
  const el = kind === "v" ? `<video src="${esc(mediaUrl(u))}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${esc(mediaUrl(u))}" alt="">`;
  return `<div class="thumb">${el}<div class="bt">${kind === "i" ? `<button type="button" class="secondary" data-act="imgMove" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Avancer">←</button><button type="button" class="secondary" data-act="imgMove" data-i="${i}" data-d="1" ${i === n - 1 ? "disabled" : ""} aria-label="Reculer">→</button>` : ""}<button type="button" class="danger" data-act="${kind === "i" ? "imgDel" : "vidDel"}" data-i="${i}" aria-label="Supprimer">×</button></div></div>`;
}
function renderForm() {
  $("pImages").innerHTML = form.images.map((u, i) => mediaThumb(u, "i", i, form.images.length)).join("") || '<span class="note">Aucune photo.</span>';
  $("pVideo").innerHTML = form.video ? mediaThumb(form.video, "v", 0, 1) : '<span class="note">Aucune vidéo.</span>';
  $("pColors").innerHTML = form.colors.map((c, i) => `<div class="colorrow"><input type="color" value="${esc(c.hex)}" data-col="hex" data-i="${i}" aria-label="Couleur"><input value="${esc(c.name)}" data-col="name" data-i="${i}" maxlength="40" placeholder="Nom (ex. Noir)" aria-label="Nom de la couleur"><button type="button" class="secondary" data-act="delColor" data-i="${i}" aria-label="Retirer">×</button></div>`).join("");
}
function newProduct() {
  $("productForm").reset(); $("pId").value = ""; $("pActive").checked = true; $("pSizes").value = "S, M, L, XL, XXL"; $("pStock").value = "10";
  form = { images: [], video: "", colors: [{ name: "Noir", hex: "#111111" }, { name: "Blanc", hex: "#ffffff" }] };
  $("formTitle").textContent = "Nouveau produit"; $("delBtn").classList.add("hidden"); $("pError").textContent = ""; $("upMsg").textContent = ""; renderForm();
}
function editProduct(id) {
  const p = products.find((x) => String(x.id) === String(id)); if (!p) return;
  $("pId").value = p.id; $("pName").value = p.name; $("pPrice").value = p.price; $("pSalePrice").value = p.salePrice || ""; $("pCategory").value = p.category; $("pTag").value = p.tag || ""; $("pActive").checked = p.active;
  $("pDesc").value = p.description || ""; $("pSizes").value = p.sizes.join(", "); $("pStock").value = p.stock==null ? "" : p.stock;
  form = { images: [...p.images], video: p.video || "", colors: p.colors.map((c) => ({ ...c })) };
  $("formTitle").textContent = "Modifier le produit"; $("delBtn").classList.remove("hidden"); $("pError").textContent = ""; renderForm();
  $("productForm").scrollIntoView({ behavior: "smooth" });
}
async function saveProduct(e) {
  e.preventDefault(); $("pError").textContent = ""; const btn = $("saveBtn"); btn.disabled = true;
  try {
    await api("products", "POST", { id: $("pId").value || undefined, name: $("pName").value, price: Number($("pPrice").value), salePrice: $("pSalePrice").value === "" ? null : Number($("pSalePrice").value), category: $("pCategory").value, tag: $("pTag").value, active: $("pActive").checked, description: $("pDesc").value, stock: $("pStock").value === "" ? null : Number($("pStock").value),
      colors: form.colors.filter((c) => c.name.trim()), sizes: $("pSizes").value.split(",").map((x) => x.trim()).filter(Boolean), images: form.images, video: form.video });
    newProduct(); await loadProducts(); $("upMsg").textContent = "Produit enregistré ✓";
  } catch (err) { $("pError").textContent = err.message; }
  btn.disabled = false;
}

/* ---------- envoi de fichiers ---------- */
async function compress(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(`« ${file.name} » : formats acceptés JPG, PNG ou WebP.`);
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  for (const t of ["image/webp", "image/jpeg"]) { const b = await new Promise((r) => c.toBlob(r, t, 0.85)); if (b && b.type === t) return b; }
  throw new Error("Impossible de traiter cette photo.");
}
function progress(p, text) { $("upBar").classList.toggle("hidden", p == null); if (p != null) $("upBar").firstElementChild.style.width = p + "%"; $("upMsg").textContent = text || ""; }
async function uploadBlob(blob, label) {
  const kind = blob.type.startsWith("video/") ? "video" : "image", total = Math.max(1, Math.ceil(blob.size / CHUNK));
  if (total > MAX_PARTS[kind]) throw new Error(kind === "video" ? "Vidéo trop lourde (30 Mo maximum). Raccourcissez-la ou compressez-la." : "Photo trop lourde.");
  let id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  for (let i = 0; i < total; i++) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(API + "media-chunk" + `&part=${i}&total=${total}&type=${encodeURIComponent(blob.type)}&id=${id}`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/octet-stream" }, body: blob.slice(i * CHUNK, (i + 1) * CHUNK) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) { logout(); throw new Error("Session expirée."); }
        if (!r.ok) throw new Error(j.error || "Échec de l’envoi");
        if (j.id !== id) throw new Error("Identifiant de fichier inattendu. Réessayez.");
        break;
      } catch (err) { if (attempt >= 2 || /Session|non accepté|invalide/.test(err.message)) throw err; }
    }
    progress(Math.round(((i + 1) / total) * 100), `${label} : ${Math.round(((i + 1) / total) * 100)} %`);
  }
  return "/media/" + id;
}
async function handleFiles(input) {
  const files = [...input.files]; input.value = ""; if (!files.length) return;
  const kind = input.dataset.up; if (kind === "image" && form.images.length + files.length > 10) return progress(null, "10 photos maximum par produit.");
  const msgEl = kind === "hero" ? $("sHeroMsg") : $("upMsg");
  try {
    for (const f of files) {
      if (kind === "video") {
        if (!/^video\/(mp4|webm)$/.test(f.type)) throw new Error("Vidéo : formats acceptés MP4 ou WebM.");
        form.video = await uploadBlob(f, "Vidéo"); 
      } else {
        const url = await uploadBlob(await compress(f), "Photo");
        if (kind === "hero") { settings.heroImage = url; renderHero(); } else form.images.push(url);
      }
      if (kind !== "hero") renderForm();
    }
    progress(null, "Envoi terminé ✓ — pensez à enregistrer."); msgEl.textContent = "Envoi terminé ✓ — pensez à enregistrer.";
  } catch (err) { progress(null, err.message); msgEl.textContent = err.message; }
}

/* ---------- réglages ---------- */
const MAP = { sHeroVisible: "heroVisible", sHeroPosition: "heroPosition", sName: "name", sTopbar: "topbar", sHeroTitle: "heroTitle", sHeroText: "heroText", sAbout: "aboutText", sBg: "bgColor", sText: "textColor", sButton: "buttonColor", sButtonText: "buttonTextColor", sAccent: "accentColor", sHeroBg: "heroBgColor", sFont: "fontFamily", sHeadingFont: "headingFont", sBodySize: "bodySize", sPhone: "phone", sWhatsapp: "whatsapp", sEmail: "email", sAddress: "address", sFee: "deliveryFee", sFree: "freeDeliveryFrom" };
function renderHero() { $("sHeroPreview").innerHTML = `<div class="thumb" style="width:200px"><img style="width:200px;height:100px" src="${esc(mediaUrl(settings.heroImage || "/assets/hero.jpg"))}" alt=""></div>`; }
async function loadSettings() {
  for (const id of ["sFont", "sHeadingFont"]) $(id).innerHTML = FONTS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  settings = (await api("settings")).settings;
  for (const [id, k] of Object.entries(MAP)) $(id).value = settings[k] ?? (k === "heroVisible" ? "true" : k === "heroPosition" ? "normal" : "");
  renderHero();
}
async function saveSettings(e) {
  e.preventDefault(); const next = { heroImage: settings.heroImage };
  for (const [id, k] of Object.entries(MAP)) next[k] = $(id).value;
  try { settings = (await api("settings", "POST", next)).settings; $("sMsg").className = "note ok"; $("sMsg").textContent = "Réglages enregistrés ✓ — visibles sur la boutique."; }
  catch (err) { $("sMsg").className = "note error"; $("sMsg").textContent = err.message; }
}

/* ---------- événements ---------- */
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]"); if (!el || el.tagName === "SELECT") return;
  const d = el.dataset, i = Number(d.i);
  try {
    switch (d.act) {
      case "logout": logout(); break;
      case "tab": tab(d.v); if(d.v==="home")renderAdminOverview(); if(d.v==="customers")renderCustomers(); if(d.v==="stats")renderStatistics(); if(d.v==="orders")$("orderAlert").classList.add("hidden"); break;
      case "dismissOrderAlert": $("orderAlert").classList.add("hidden"); break;
      case "enableNotifications": await enableNotifications(); break;
      case "reload": await Promise.all([loadOrders(), loadProducts(), loadInquiries()]); renderAdminOverview(); renderCustomers(); renderStatistics(); break;
      case "csv": exportCsv(); break;
      case "customersCsv": exportCustomersCsv(); break;
      case "delOrder": if (confirm("Supprimer cette commande définitivement ?")) { await api("orders", "DELETE", null, "&id=" + encodeURIComponent(d.id)); await loadOrders(); await loadProducts(); renderAdminOverview(); renderCustomers(); renderStatistics(); } break;
      case "delInq": if (confirm("Supprimer cette demande ?")) { await api("inquiries", "DELETE", null, "&id=" + encodeURIComponent(d.id)); await loadInquiries(); renderAdminOverview(); } break;
      case "replyInquiry": {
        const inquiry = inquiries.find((q) => String(q.id) === String(d.id));
        const message = el.closest(".item")?.querySelector(".reply-message")?.value.trim();
        if (!inquiry || !inquiry.whatsapp) { alert("Aucun numéro WhatsApp pour ce client."); break; }
        if (!message) { alert("Écrivez votre réponse avant de continuer."); break; }
        window.open(waLink(inquiry.whatsapp) + "?text=" + encodeURIComponent(message), "_blank", "noopener,noreferrer");
        break;
      }
      case "newProduct": newProduct(); $("productForm").scrollIntoView({ behavior: "smooth" }); break;
      case "editProduct": editProduct(d.id); break;
      case "delProduct": if ($("pId").value && confirm("Supprimer ce produit et ses fichiers de la boutique ?")) { await api("products", "DELETE", null, "&id=" + encodeURIComponent($("pId").value)); newProduct(); await loadProducts(); } break;
      case "addColor": form.colors.push({ name: "", hex: "#999999" }); renderForm(); break;
      case "delColor": form.colors.splice(i, 1); renderForm(); break;
      case "imgDel": form.images.splice(i, 1); renderForm(); break;
      case "imgMove": { const j = i + Number(d.d); [form.images[i], form.images[j]] = [form.images[j], form.images[i]]; renderForm(); break; }
      case "vidDel": form.video = ""; renderForm(); break;
      case "cleanup": { const r = await api("media-cleanup", "POST", {}); $("sMsg").className = "note ok"; $("sMsg").textContent = r.removed ? `${r.removed} fichier(s) inutilisé(s) supprimé(s).` : "Aucun fichier inutilisé."; break; }
    }
  } catch (err) { alert(err.message); }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  try {
    if (t.matches("input[type=file][data-up]")) return handleFiles(t);
    if (t.id === "oFilter") return renderOrders();
    if (t.id === "cSearch") return renderCustomers();
    if (t.dataset.act === "ostatus") { await api("orders", "PATCH", { id: t.dataset.id, status: t.value }); await loadOrders(); await loadProducts(); renderAdminOverview(); renderCustomers(); renderStatistics(); }
    if (t.dataset.act === "qstatus") { await api("inquiries", "PATCH", { id: t.dataset.id, status: t.value }); await loadInquiries(); renderAdminOverview(); }
  } catch (err) { alert(err.message); }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.col) form.colors[Number(t.dataset.i)][t.dataset.col] = t.value;
  if (t.id === "oSearch") renderOrders();
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "loginForm") login(e); else if (e.target.id === "productForm") saveProduct(e); else if (e.target.id === "settingsForm") saveSettings(e);
});
$("oFilter").insertAdjacentHTML("beforeend", ORDER_STATUS.map((s) => `<option>${s}</option>`).join(""));
newProduct();
if (token) openDashboard();
})();
