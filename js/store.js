/* FlowyMarket · tienda pública.
   Lee el catálogo con la clave pública (anon) y crea pedidos solo mediante place_order(),
   que recalcula todo en el servidor. El mensaje de WhatsApp se arma con la respuesta del servidor. */
'use strict';
const PREVIEW = new URLSearchParams(location.search).has('preview') && window.parent !== window;
const sb = PREVIEW ? null : supabase.createClient(FM_CONFIG.url, FM_CONFIG.anonKey);
let DATA = null, cart = [];

function fmt(n) { return fmtMoney(n, DATA.config.store.currency); }
function product(id) { return DATA.products.find(p => p.id === id); }

function applyTheme(r) {
  let st = document.getElementById('theme');
  if (!st) { st = document.createElement('style'); st.id = 'theme'; document.head.appendChild(st); }
  st.textContent = r.css;
  let lf = document.getElementById('font');
  const href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(r.font) + ':wght@400;600;700&display=swap';
  if (!lf) { lf = document.createElement('link'); lf.id = 'font'; lf.rel = 'stylesheet'; document.head.appendChild(lf); }
  if (lf.href !== href) lf.href = href;
}

function render() {
  const cfg = DATA.config;
  document.title = cfg.store.seoTitle || cfg.store.name;
  const md = document.querySelector('meta[name=description]'); if (md) md.content = cfg.store.seoDesc;
  const r = renderStore(DATA);
  applyTheme(r);
  const paused = cfg.checkout.paused ? '<div class="paused">En este momento no estamos tomando pedidos.</div>' : '';
  document.getElementById('app').innerHTML = paused + r.html + '<div class="sh" id="sh"><div id="shb" role="dialog" aria-modal="true"></div></div>';
  document.querySelectorAll('.cat').forEach(bindCatalog);
  updateCount();
  const pop = document.getElementById('pop');
  if (pop && !PREVIEW && !sessionStorageGet('pop-seen')) setTimeout(() => { pop.classList.add('show'); sessionStorageSet('pop-seen', '1'); }, (+pop.dataset.delay || 0) * 1000);
}
function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } }

function bindCatalog(sec) {
  const filter = () => {
    const q = (sec.querySelector('.srch') || {}).value || '';
    const c = sec.querySelector('.cb.on').dataset.c;
    sec.querySelectorAll('.pc').forEach(p => { p.style.display = (!c || p.dataset.cat === c) && p.dataset.t.includes(q.toLowerCase()) ? '' : 'none'; });
  };
  sec._filter = filter;
  const s = sec.querySelector('.srch'); if (s) s.oninput = filter;
  const o = sec.querySelector('.ord');
  if (o) o.onchange = () => {
    const l = sec.querySelector('.list'), k = o.value;
    [...l.children].sort((a, b) => k === 'asc' ? a.dataset.p - b.dataset.p : k === 'desc' ? b.dataset.p - a.dataset.p : k === 'az' ? a.dataset.t.localeCompare(b.dataset.t) : 0).forEach(x => l.appendChild(x));
  };
}

const sheet = () => document.getElementById('sh');
const sheetBody = () => document.getElementById('shb');
function openSheet(html) { sheetBody().innerHTML = html; sheet().classList.add('open'); }
function closeSheet() { sheet().classList.remove('open'); }
function updateCount() { const e = document.getElementById('cc'); if (e) e.textContent = cart.reduce((a, b) => a + b.q, 0); }

function openProduct(id) {
  const p = product(id); if (!p) return;
  const canBuy = p.cart && p.stock > 0 && !DATA.config.checkout.paused;
  openSheet(`<div class="shh"><b>${esc(p.title)}</b><button data-act="close" aria-label="Cerrar">✕</button></div>`
    + (p.img ? `<img src="${esc(safeImg(p.img))}" alt="" class="shimg">` : '')
    + `<p>${esc(p.desc)}</p><div class="pr">${fmt(unitPrice(p))}</div>`
    + p.options.map((o, oi) => `<fieldset><legend>${esc(o.title || 'Opciones')}${o.required ? ' <small>(obligatorio)</small>' : ''}</legend>`
      + o.items.map((it, ii) => it.available ? `<label class="opt"><input type="${o.multi ? 'checkbox' : 'radio'}" name="o${oi}" data-oi="${oi}" data-ii="${ii}"> ${esc(it.title)}${it.price ? ' (+' + fmt(it.price) + ')' : ''}</label>` : '').join('')
      + '</fieldset>').join('')
    + (canBuy ? `<textarea id="note" maxlength="300" placeholder="Nota (opcional)"></textarea><button class="go" data-act="add" data-id="${esc(p.id)}">Agregar</button>`
      : `<p class="muted">${p.stock <= 0 ? 'Agotado' : DATA.config.checkout.paused ? 'Pedidos pausados' : 'Producto informativo'}</p>`));
}

function addToCart(id) {
  const p = product(id); if (!p) return;
  const sel = [...sheetBody().querySelectorAll('input[data-oi]:checked')].map(i => [+i.dataset.oi, +i.dataset.ii]);
  const miss = p.options.find((o, oi) => o.required && o.items.some(i => i.available) && !sel.some(s => s[0] === oi));
  if (miss) { alert('Elige: ' + (miss.title || 'una opción')); return; }
  const extra = sel.reduce((a, [oi, ii]) => a + (p.options[oi].items[ii].price || 0), 0);
  cart.push({ id: p.id, sel, title: p.title, opts: sel.map(([oi, ii]) => p.options[oi].items[ii].title), note: (document.getElementById('note') || {}).value || '', unit: round2(unitPrice(p) + extra), q: 1 });
  updateCount(); closeSheet();
}

function field(id, label, opts = {}) {
  return `<label class="fl">${esc(label)}${opts.req ? ' *' : ''}<input id="${id}" ${opts.type ? `type="${opts.type}"` : ''} maxlength="${opts.max || 150}" ${opts.req ? 'required' : ''} autocomplete="${opts.ac || 'on'}"></label>`;
}

function openCart() {
  const c = DATA.config.checkout, pm = DATA.config.payments;
  if (!cart.length) { openSheet('<div class="shh"><b>Tu pedido</b><button data-act="close" aria-label="Cerrar">✕</button></div><p>El carrito está vacío.</p>'); return; }
  const sub = cart.reduce((a, b) => a + b.unit * b.q, 0);
  const types = [c.delivery && ['Entrega a domicilio', 'Entrega a domicilio (+' + fmt(c.deliveryPrice) + ')'], c.pickup && ['Recoger en sucursal', 'Recoger en sucursal'], c.table && ['Pedido en mesa', 'Pedido en mesa']].filter(Boolean);
  const pays = [pm.cash && 'Efectivo', pm.transfer && 'Transferencia', pm.custom && (pm.customName || 'Otro')].filter(Boolean);
  const ADDR = { line1: 'Dirección', line2: 'Depto. / N° interior', city: 'Ciudad', state: 'Estado', zip: 'Código postal' };
  openSheet(`<div class="shh"><b>Tu pedido</b><button data-act="close" aria-label="Cerrar">✕</button></div>`
    + cart.map((it, i) => `<div class="ci"><div style="flex:1"><b>${esc(it.title)}</b><div class="muted">${esc(it.opts.join(', '))}${it.note ? ' · ' + esc(it.note) : ''}</div></div>
      <div class="q"><button data-act="minus" data-i="${i}" aria-label="Quitar uno">−</button>${it.q}<button data-act="plus" data-i="${i}" aria-label="Agregar uno">+</button></div><b>${fmt(it.unit * it.q)}</b></div>`).join('')
    + `<p class="muted">Subtotal estimado: <b>${fmt(sub)}</b>. El total final lo confirma la tienda.</p>`
    + (c.askName ? field('cn', 'Nombre', { req: true, ac: 'name', max: 120 }) : '')
    + (c.askPhone ? field('cp', 'Teléfono', { req: true, type: 'tel', ac: 'tel', max: 25 }) : '')
    + (c.askEmail ? field('ce', 'Correo', { req: true, type: 'email', ac: 'email', max: 160 }) : '')
    + (types.length ? `<label class="fl">Tipo de pedido<select id="ct">${types.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>` : '<p class="muted">La tienda no tiene tipos de pedido activos.</p>')
    + `<div id="addrBox"></div>`
    + (c.questionsOn ? c.questions.map((q, i) => `<label class="fl">${esc(q.text)}${q.required ? ' *' : ''}<input data-q="${i}" maxlength="300"></label>`).join('') : '')
    + (pays.length ? `<label class="fl">Pago<select id="cpay">${pays.map(p => `<option>${esc(p)}</option>`).join('')}</select></label>` : '')
    + `<div id="payInfo" class="muted"></div>`
    + `<label class="fl">Código de descuento<input id="cpromo" maxlength="40" autocomplete="off"></label>`
    + `<p id="err" class="err" role="alert"></p><button class="go" data-act="confirm" ${types.length ? '' : 'disabled'}>Confirmar pedido</button>`);
  const typeSel = document.getElementById('ct');
  const drawAddr = () => {
    const t = typeSel ? typeSel.value : '';
    document.getElementById('addrBox').innerHTML = t === 'Entrega a domicilio'
      ? Object.keys(ADDR).filter(k => c.addr[k][0]).map(k => field('a_' + k, ADDR[k], { req: c.addr[k][1], ac: 'off' })).join('')
      : t === 'Pedido en mesa' ? field('a_text', 'Número de mesa', { req: true, max: 20 }) : '';
  };
  const drawPay = () => {
    const v = (document.getElementById('cpay') || {}).value;
    document.getElementById('payInfo').textContent = v === 'Transferencia' ? pm.transferInfo : v && v === (pm.customName || 'Otro') ? pm.customInfo : '';
  };
  if (typeSel) typeSel.onchange = drawAddr;
  const ps = document.getElementById('cpay'); if (ps) ps.onchange = drawPay;
  drawAddr(); drawPay();
}

async function confirmOrder(btn) {
  const v = id => ((document.getElementById(id) || {}).value || '').trim();
  const err = document.getElementById('err'); err.textContent = '';
  const address = { text: v('a_text') };
  ['line1', 'line2', 'city', 'state', 'zip'].forEach(k => { address[k] = v('a_' + k); });
  const payload = {
    items: cart.map(i => ({ id: i.id, q: i.q, sel: i.sel, note: i.note })),
    type: v('ct'), pay: v('cpay'), promo: v('cpromo'), address,
    customer: { name: v('cn'), phone: v('cp'), email: v('ce') },
    answers: [...document.querySelectorAll('[data-q]')].map(i => i.value.trim())
  };
  btn.disabled = true; btn.textContent = 'Enviando…';
  const { data, error } = await sb.rpc('place_order', { payload });
  btn.disabled = false; btn.textContent = 'Confirmar pedido';
  if (error) { err.textContent = orderError(error); return; }
  cart = []; updateCount();
  showReceipt(data, payload);
}

function showReceipt(o, payload) {
  const c = DATA.config.checkout, st = DATA.config.store, pm = DATA.config.payments;
  const lines = arr(o.items, 100).map(i => `${i.q}x ${str(i.title, 200)}${i.opts && i.opts.length ? ' (' + i.opts.join(', ') + ')' : ''} — ${fmt(i.price * i.q)}${i.note ? '\n   Nota: ' + i.note : ''}`);
  const addr = Object.entries(payload.address).filter(([, x]) => x).map(([, x]) => x).join(', ');
  const msg = `${c.msgHeader}\n\nPedido #${o.num}\n${lines.join('\n')}\n\n`
    + (o.discount > 0 ? `Descuento: −${fmt(o.discount)}\n` : '') + (o.tax > 0 ? `${c.taxName}: ${fmt(o.tax)}\n` : '') + (o.shipping > 0 ? `Envío: ${fmt(o.shipping)}\n` : '')
    + `Total: ${fmt(o.total)}\nTipo: ${o.type}` + (addr ? `\nDirección/mesa: ${addr}` : '') + (o.pay ? `\nPago: ${o.pay}` : '')
    + (payload.customer.name ? `\nNombre: ${payload.customer.name}` : '') + `\n\n${c.msgFooter}`;
  openSheet(`<div class="shh"><b>¡Pedido #${+o.num} registrado!</b><button data-act="close" aria-label="Cerrar">✕</button></div>`
    + `<p>Total: <b>${fmt(o.total)}</b></p>`
    + (o.pay === 'Transferencia' && pm.transferInfo ? `<p class="muted" style="white-space:pre-line">${esc(pm.transferInfo)}</p>` : '')
    + (st.whatsapp ? `<a class="go" target="_blank" rel="noopener noreferrer" href="https://wa.me/${digits(st.whatsapp)}?text=${encodeURIComponent(msg)}">Enviar detalle por WhatsApp</a>` : '<p class="muted">La tienda ya recibió tu pedido.</p>'));
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-add],.pc,#fcart,.cb');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'close') return closeSheet();
  if (act === 'close-pop') return t.closest('.pop').remove();
  if (act === 'legal') { e.preventDefault(); const txt = DATA.config.checkout.legal[t.dataset.k] || ''; return openSheet(`<div class="shh"><b>${t.dataset.k === 'terms' ? 'Términos y condiciones' : 'Política de privacidad'}</b><button data-act="close" aria-label="Cerrar">✕</button></div><p style="white-space:pre-line">${esc(txt)}</p>`); }
  if (act === 'add') return addToCart(t.dataset.id);
  if (act === 'minus' || act === 'plus') { const it = cart[+t.dataset.i]; if (!it) return; it.q += act === 'plus' ? 1 : -1; if (it.q <= 0) cart.splice(+t.dataset.i, 1); if (it.q > 999) it.q = 999; updateCount(); return openCart(); }
  if (act === 'confirm') { if (PREVIEW) { document.getElementById('err').textContent = 'Vista previa: los pedidos están desactivados.'; return; } return confirmOrder(t); }
  if (t.dataset.add) { e.stopPropagation(); return openProduct(t.dataset.add); }
  if (t.classList.contains('pc')) return openProduct(t.dataset.id);
  if (t.id === 'fcart') return openCart();
  if (t.classList.contains('cb')) { const sec = t.closest('.cat'); sec.querySelectorAll('.cb').forEach(x => x.classList.toggle('on', x === t)); sec._filter && sec._filter(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet()) closeSheet(); });

/* ---------- datos ---------- */
async function load() {
  const [cfg, cats, prods] = await Promise.all([
    sb.from('shop_config').select('store,design,checkout,payments').eq('id', 1).maybeSingle(),
    sb.from('categories').select('id,name,parent').order('position'),
    sb.from('products').select('id,title,description,price,offer,category_id,tags,hidden,stock,cart,img,imgs,options').order('position')
  ]);
  const err = cfg.error || cats.error || prods.error;
  if (err) throw err;
  DATA = { config: cleanConfig(cfg.data), categories: (cats.data || []).map(cleanCategory), products: (prods.data || []).map(cleanProduct) };
}

async function start() {
  if (PREVIEW) {
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || e.source !== window.parent || !e.data || e.data.kind !== 'preview') return;
      const d = e.data.data;
      DATA = { config: cleanConfig(d.config), categories: arr(d.categories, 300).map(cleanCategory), products: arr(d.products, 5000).map(cleanProduct) };
      render();
    });
    window.parent.postMessage({ kind: 'preview-ready' }, location.origin);
    return;
  }
  try { await load(); render(); }
  catch (e) { document.getElementById('app').innerHTML = '<p class="loading">No se pudo cargar la tienda. Revisa tu conexión e intenta de nuevo.</p>'; return; }
  if (!sessionStorageGet('visit')) { sessionStorageSet('visit', '1'); sb.rpc('register_visit').then(() => { }, () => { }); }
  // cambios publicados desde el panel → todos los visitantes los ven al instante
  let t;
  const refresh = () => { clearTimeout(t); t = setTimeout(async () => { try { await load(); const open = sheet().classList.contains('open'); if (!open) render(); else pending = true; } catch (e) { } }, 400); };
  let pending = false;
  document.addEventListener('click', () => { if (pending && !sheet().classList.contains('open')) { pending = false; render(); } });
  sb.channel('tienda').on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_config' }, refresh).subscribe();
}
start();
