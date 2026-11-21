/* FlowyMarket · panel de administración.
   Los datos viven en Supabase. Cada cambio se sincroniza con la base de datos (save → sync);
   la seguridad real la imponen las políticas RLS del servidor, no este código. */
'use strict';
const sb=supabase.createClient(FM_CONFIG.url,FM_CONFIG.anonKey);
const money=n=>fmtMoney(n,S.store.currency);
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2600)}

/* preferencias de este navegador (no son datos de la tienda) */
const PREF_KEY='fm-admin-prefs';
let prefs={sound:true,theme:'',view:'productos',studio:[]};
try{prefs={...prefs,...JSON.parse(localStorage.getItem(PREF_KEY)||'{}')}}catch(e){}
prefs.studio=arr(prefs.studio,12).map(safeImg).filter(Boolean);
function savePrefs(){try{localStorage.setItem(PREF_KEY,JSON.stringify(prefs))}catch(e){}}

/* ---------- datos ---------- */
const ICON={
  detalles:'<path d="M4 4h10l6 6v10H4z M14 4v6h6" fill="none" stroke="currentColor" stroke-width="2"/>',
  productos:'<path d="M3 12l9-9h8v8l-9 9z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="8" r="1.6" fill="currentColor"/>',
  diseno:'<rect x="3" y="3" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="3" width="8" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="10" width="8" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>',
  pedidos:'<path d="M3 9h18l-2 11H5z M8 9l4-6 4 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  clientes:'<circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 20c1-4 4-6 7-6s6 2 7 6 M16 4a3.5 3.5 0 010 7 M18 14c2 1 3.5 3 4 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  pagos:'<rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 10h20" stroke="currentColor" stroke-width="2"/>',
  estadisticas:'<path d="M4 20V4 M4 20h16 M8 16v-5 M12 16V7 M16 16v-8" fill="none" stroke="currentColor" stroke-width="2"/>',
  checkout:'<circle cx="9" cy="20" r="1.5" fill="currentColor"/><circle cx="18" cy="20" r="1.5" fill="currentColor"/><path d="M2 3h3l3 12h11l2-8H6" fill="none" stroke="currentColor" stroke-width="2"/>',
  estudio:'<rect x="3" y="6" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 6l2-3h4l2 3" fill="none" stroke="currentColor" stroke-width="2"/>',
  avanzado:'<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2" stroke="currentColor" stroke-width="2"/>'
};
const SECTIONS=[['detalles','Detalles'],['productos','Productos'],['diseno','Diseño'],['pedidos','Pedidos'],['clientes','Clientes'],['pagos','Pagos'],['estadisticas','Estadísticas'],['checkout','Checkout'],['estudio','Estudio'],['avanzado','Avanzado']];
let S=null;            // estado en memoria
let synced=null;       // última versión confirmada por la base de datos
let USER=null;
const catName=id=>(S.categories.find(c=>c.id===id)||{}).name||'Sin categoría';

const configRow=()=>{const {promos,...checkout}=S.checkout;return {id:1,store:S.store,design:S.design,checkout,payments:S.payments}};
const catRow=(c,i)=>({id:c.id,name:c.name||'Sin nombre',parent:c.parent||null,position:i});
const prodRow=(p,i)=>({id:p.id,title:p.title||'Sin título',description:p.desc,price:+p.price||0,offer:p.offer===''||p.offer==null?null:+p.offer,category_id:p.cat||null,
  tags:p.tags,hidden:p.hidden,stock:p.stock,cart:p.cart,img:p.img,imgs:p.imgs,options:p.options,position:i});
const promoRow=p=>({code:p.code,type:p.type,value:+p.value||0,active:!!p.active});
function snapshot(){return {
  config:JSON.stringify(configRow()),
  cats:new Map(S.categories.map((c,i)=>[c.id,JSON.stringify(catRow(c,i))])),
  prods:new Map(S.products.map((p,i)=>[p.id,JSON.stringify(prodRow(p,i))])),
  promos:new Map(S.checkout.promos.map(p=>[p.code,JSON.stringify(promoRow(p))])),
  orders:new Map(S.orders.map(o=>[o.id,JSON.stringify({status:o.status,paid:o.paid})]))}}

/* save(): agenda la sincronización. sync(): envía solo lo que cambió. */
let syncTimer=null,syncing=false,again=false;
function save(){refreshPreview();clearTimeout(syncTimer);setStatus('Guardando…');syncTimer=setTimeout(sync,700)}
function setStatus(t){const e=$('#syncStatus');if(e)e.textContent=t}
async function sync(){
  if(syncing){again=true;return}
  syncing=true;
  const now=snapshot(),errs=[];
  const run=async(label,q)=>{const {error}=await q;if(error)errs.push(label+': '+error.message)};
  try{
    if(now.config!==synced.config)await run('configuración',sb.from('shop_config').upsert(JSON.parse(now.config)));
    // categorías: padres antes que hijas
    const changedCats=[...now.cats].filter(([id,v])=>synced.cats.get(id)!==v).map(([,v])=>JSON.parse(v)).sort((a,b)=>(a.parent?1:0)-(b.parent?1:0));
    if(changedCats.length)await run('categorías',sb.from('categories').upsert(changedCats));
    const changedProds=[...now.prods].filter(([id,v])=>synced.prods.get(id)!==v).map(([,v])=>JSON.parse(v));
    if(changedProds.length)await run('productos',sb.from('products').upsert(changedProds));
    const delProds=[...synced.prods.keys()].filter(id=>!now.prods.has(id));
    if(delProds.length)await run('productos',sb.from('products').delete().in('id',delProds));
    const delCats=[...synced.cats.keys()].filter(id=>!now.cats.has(id));
    if(delCats.length)await run('categorías',sb.from('categories').delete().in('id',delCats));
    const delPromos=[...synced.promos.keys()].filter(c=>!now.promos.has(c));
    if(delPromos.length)await run('promociones',sb.from('promos').delete().in('code',delPromos));
    const changedPromos=[...now.promos].filter(([c,v])=>synced.promos.get(c)!==v).map(([,v])=>JSON.parse(v));
    const badPromo=changedPromos.find(p=>!/^[A-Za-z0-9_-]{2,40}$/.test(p.code)||(p.type==='pct'&&p.value>100));
    if(badPromo)errs.push('promociones: el código debe tener 2–40 letras, números, - o _, y el porcentaje no puede superar 100');
    else if(changedPromos.length)await run('promociones',sb.from('promos').upsert(changedPromos));
    for(const [id,v] of now.orders){if(synced.orders.has(id)&&synced.orders.get(id)!==v)await run('pedido',sb.from('orders').update(JSON.parse(v)).eq('id',id))}
    const delOrders=[...synced.orders.keys()].filter(id=>!now.orders.has(id));
    if(delOrders.length)await run('pedidos',sb.from('orders').delete().in('id',delOrders));
  }catch(e){errs.push(e.message||String(e))}
  syncing=false;
  if(errs.length){setStatus('Error al guardar');toast('No se guardó: '+errs[0]);await reloadAll();if(VIEWS[cur])VIEWS[cur]()}
  else{synced=now;setStatus('Guardado ✓')}
  if(again){again=false;sync()}
}

async function fetchAll(){
  const q=await Promise.all([
    sb.from('shop_config').select('*').eq('id',1).maybeSingle(),
    sb.from('categories').select('*').order('position'),
    sb.from('products').select('*').order('position'),
    sb.from('promos').select('*').order('code'),
    sb.from('orders').select('*').order('created_at',{ascending:false}).limit(2000),
    sb.from('stats').select('visits').eq('id',1).maybeSingle()]);
  const e=q.find(r=>r.error);if(e)throw e.error;
  return q.map(r=>r.data)}
function fromRows([cfg,cats,prods,promos,orders,stats]){
  const c=cleanConfig(cfg);
  return {...c,checkout:{...c.checkout,promos:(promos||[]).map(p=>({code:str(p.code,40),type:oneOf(p.type,['pct','fix'],'pct'),value:+p.value||0,active:!!p.active}))},
    categories:(cats||[]).map(cleanCategory),products:(prods||[]).map(cleanProduct),orders:(orders||[]).map(cleanOrder),
    visits:+(stats&&stats.visits)||0,updatedAt:cfg&&cfg.updated_at,exists:!!cfg}}
async function reloadAll(){S=fromRows(await fetchAll());synced=snapshot()}
function cleanOrder(o){o=o||{};const c=o.customer||{};
  return {id:str(o.id,40),num:+o.num||0,date:o.created_at,status:oneOf(o.status,STATUSES,'Recibido'),paid:!!o.paid,
    customer:{name:str(c.name,120),phone:str(c.phone,40),email:str(c.email,160)},type:str(o.type,60),
    address:Object.entries(o.address||{}).filter(([,v])=>v).map(([,v])=>str(v,300)).join(', '),pay:str(o.pay,60),
    answers:arr(o.answers,30).map(a=>({q:str(a&&a.q,200),a:str(a&&a.a,300)})),
    items:arr(o.items,200).map(i=>({id:str(i&&i.id,24),title:str(i&&i.title,200),q:+(i&&i.q)||1,price:+(i&&i.price)||0,opts:arr(i&&i.opts,20).map(x=>str(x,120)),note:str(i&&i.note,300)})),
    subtotal:+o.subtotal||0,discount:+o.discount||0,tax:+o.tax||0,shipping:+o.shipping||0,total:+o.total||0,promo:str(o.promo,40)}}

/* primera vez: carga el catálogo inicial de la tienda */
function firstRunState(){
  const cat=n=>({id:uid(),name:n,parent:''});
  const cats=['Decants','Zapatillas','Ropa','Perfumería'].map(cat);
  const cid=n=>cats.find(c=>c.name===n).id;
  const p=(title,c,price,desc)=>cleanProduct({id:uid(),title,desc,price,cat:cid(c),stock:100});
  const c=cleanConfig({store:{...DEFAULTS.store,name:'FlowyMarket',slug:'flowymarket',seoTitle:'FlowyMarket',seoDesc:'Perfumería, zapatillas, ropa y decants.'},design:{...DEFAULTS.design,
    blocks:[{type:'hero',props:{...BLOCKS.hero.def,title:'FlowyMarket',subtitle:'En FlowyMarket reunimos perfumería, zapatillas, ropa y decants en una propuesta pensada para quienes cuidan cada detalle de su estilo.'}},
      {type:'catalog',props:BLOCKS.catalog.def},{type:'cartbtn',props:BLOCKS.cartbtn.def}]},checkout:DEFAULTS.checkout,payments:DEFAULTS.payments});
  return {...c,checkout:{...c.checkout,promos:[]},categories:cats,products:[
    p('Decant Dior Sauvage 10ml','Decants',18,'Fragancia intensa y versátil en formato decant, ideal para probar o llevar a diario.'),
    p('Nike Air Force 1 White','Zapatillas',125,'Clásico blanco, cómodo y combinable con todo.'),
    p('Oversize Essential Tee','Ropa',32,'Remera oversize de algodón pesado.'),
    p('Versace Eros Eau de Toilette 100ml','Perfumería',89,'Fresca, dulce y amaderada.'),
    p('Decant Baccarat Rouge Style 10ml','Decants',22,'Decant inspirado en una fragancia sofisticada y moderna, práctico para llevar.'),
    p('Hoodie Urban Flow','Ropa',58,'Buzo con capucha de corte urbano.')],orders:[],visits:0,exists:false}}
const emptySynced=()=>({config:'',cats:new Map(),prods:new Map(),promos:new Map(),orders:new Map()});

/* ---------- vista previa: index.html?preview=1 dentro de un iframe ---------- */
const previewData=()=>({config:configRow(),categories:S.categories,products:S.products});
function refreshPreview(){const f=$('#pv');if(f&&f.contentWindow)f.contentWindow.postMessage({kind:'preview',data:previewData()},location.origin)}
window.addEventListener('message',e=>{if(e.origin!==location.origin||!e.data||e.data.kind!=='preview-ready')return;const f=$('#pv');if(f&&e.source===f.contentWindow)refreshPreview()});

/* ---------- imágenes: se re-codifican en el navegador y se suben al bucket ---------- */
async function uploadImage(dataUrl){
  const blob=await (await fetch(dataUrl)).blob();
  const path=`${uid()}${uid()}.jpg`;
  const {error}=await sb.storage.from('product-images').upload(path,blob,{contentType:'image/jpeg',upsert:false});
  if(error){toast('No se pudo subir la imagen: '+error.message);throw error}
  return sb.storage.from('product-images').getPublicUrl(path).data.publicUrl}

/* ---------- navegación ---------- */
let cur='productos', sub={};
function renderNav(){
  $('#nav').innerHTML=SECTIONS.map(([k,n])=>`<button data-k="${k}" class="${k===cur?'on':''}"><svg viewBox="0 0 24 24">${ICON[k]}</svg>${n}</button>`).join('');
  $$('#nav button').forEach(b=>b.onclick=()=>go(b.dataset.k));
  $('#sideName').textContent=S.store.name;
  $('#sideLogo').innerHTML=S.store.logo?`<img src="${esc(safeImg(S.store.logo))}" alt="">`:esc(S.store.name[0]||'?');
}
function go(k,opts){cur=k;sub=opts||{};$('.side').classList.remove('open');renderNav();VIEWS[k]();window.scrollTo(0,0);prefs.view=k;savePrefs()}
const V=h=>$('#view').innerHTML=h;
const sw=(id,on)=>`<label class="switch"><input type="checkbox" id="${id}" ${on?'checked':''}><span></span></label>`;
const setting=(id,title,desc,on)=>`<div class="setting"><div class="t"><b>${title}</b>${desc?`<div class="hint">${desc}</div>`:''}</div>${sw(id,on)}</div>`;
function bindSwitch(id,obj,key,after){const el=$('#'+id);if(el)el.onchange=()=>{obj[key]=el.checked;save();after&&after()}}
function bindInput(sel,obj,key,num){const el=$(sel);if(el)el.oninput=()=>{obj[key]=num?(el.value===''?'':+el.value):el.value;save()}}
const IMG_TYPES=['image/png','image/jpeg','image/webp','image/gif'];
function readImage(file,max=700){return new Promise((res,rej)=>{
  if(!file||!IMG_TYPES.includes(file.type)){toast('Formato no permitido: usa PNG, JPG, WEBP o GIF');return rej(new Error('tipo'))}
  if(file.size>10*1024*1024){toast('La imagen supera 10 MB');return rej(new Error('tamaño'))}
  const r=new FileReader();r.onerror=()=>{toast('No se pudo leer la imagen');rej(r.error)};r.onload=()=>{const im=new Image();im.onerror=()=>{toast('El archivo no es una imagen válida');rej(new Error('imagen'))};im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height));const c=document.createElement('canvas');c.width=im.width*k;c.height=im.height*k;c.getContext('2d').drawImage(im,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',.82))};im.src=r.result};r.readAsDataURL(file)})}
function pickImage(max){return new Promise(res=>{const i=document.createElement('input');i.type='file';i.accept=IMG_TYPES.join(',');i.onchange=()=>{if(!i.files[0])return;toast('Subiendo imagen…');readImage(i.files[0],max).then(uploadImage).then(res,()=>{})};i.click()})}
function modal(html){$('#modalBox').innerHTML=html;$('#modal').classList.add('open')}
function closeModal(){$('#modal').classList.remove('open')}
$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
function download(name,text,type='text/csv'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click()}
const storeUrl=()=>new URL('./',location.href).href;

/* ---------- vistas ---------- */
const VIEWS={};

VIEWS.detalles=()=>{
  const st=S.store;
  V(`<h1>Detalles</h1>
  <div class="grid2">
    <div class="card" style="text-align:center"><h2 style="text-align:left">Comparte</h2>
      <div id="qr"></div>
      <div class="row" style="justify-content:center;margin:14px 0"><button class="btn sm" id="qrPng">PNG</button><button class="btn sm" id="qrPrint">Imprimir QR</button>
        <label class="row" style="gap:6px">Color <input type="color" id="qrColor" value="${st.qrColor||'#0e8aa8'}"></label></div>
      <div class="row" style="justify-content:center"><code id="url">${esc(storeUrl())}</code><button class="btn sm" id="copy">Copiar</button></div>
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn primary" data-act="open-store">Ver tienda</button><button class="btn" data-act="go" data-k="diseno">Editar diseño</button></div>
    </div>
    <div class="card"><h2>Información</h2>
      <label class="f">Nombre</label><input type="text" id="sName" value="${esc(st.name)}">
      <label class="f">WhatsApp para pedidos</label><input type="tel" id="sWa" value="${esc(st.whatsapp)}" placeholder="5215512345678">
      <div class="hint">Con código de país y sin signos. Los clientes envían el detalle del pedido a este número.</div>
      <div class="grid2" style="margin-top:14px">
        <div class="stat"><small>Última actualización</small><div style="font-size:15px">${S.updatedAt?new Date(S.updatedAt).toLocaleString('es',{dateStyle:'short',timeStyle:'short'}):'—'}</div></div>
        <div class="stat"><small>Visitas</small><div>${S.visits}</div></div>
      </div>
    </div>
  </div>
  <div class="card"><h2>Logo y SEO</h2>
    <div class="row" style="align-items:flex-start;gap:20px">
      <div><div class="logo" style="width:96px;height:96px;cursor:pointer" id="logoPick">${st.logo?`<img src="${esc(safeImg(st.logo))}" alt="Logo">`:esc(st.name[0])}</div>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="logoUp">Subir</button>${st.logo?'<button class="btn sm danger" id="logoDel">Quitar</button>':''}</div></div>
      <div style="flex:1;min-width:240px">
        <label class="f">Título SEO</label><input type="text" id="seoT" value="${esc(st.seoTitle)}">
        <label class="f">Descripción SEO</label><textarea id="seoD">${esc(st.seoDesc)}</textarea>
        <div class="card" style="margin-top:12px;box-shadow:none"><div class="hint">Vista previa en buscadores</div>
          <div style="color:#1a0dab;font-size:17px" id="seoPT">${esc(st.seoTitle)}</div><div style="color:#006621;font-size:13px">${esc(storeUrl())}</div><div class="hint" id="seoPD">${esc(st.seoDesc)}</div></div>
      </div>
    </div>
  </div>`);
  const drawQR=()=>{$('#qr').innerHTML='';if(window.QRCode)new QRCode($('#qr'),{text:storeUrl(),width:200,height:200,colorDark:st.qrColor||'#0e8aa8'});else $('#qr').textContent='QR no disponible sin conexión'};
  drawQR();
  $('#qrColor').oninput=e=>{st.qrColor=e.target.value;save();drawQR()};
  $('#qrPng').onclick=()=>{const c=$('#qr canvas');if(c){const a=document.createElement('a');a.href=c.toDataURL();a.download='qr-'+st.slug+'.png';a.click()}};
  $('#qrPrint').onclick=()=>{const c=$('#qr canvas');if(!c)return;const w=open('');if(!w){toast('Permite ventanas emergentes para imprimir');return}w.document.write(`<div style="text-align:center;font-family:sans-serif"><h1>${esc(st.name)}</h1><img src="${c.toDataURL()}" width="320"><p>${esc(storeUrl())}</p></div>`);w.print()};
  $('#copy').onclick=()=>{navigator.clipboard?.writeText(storeUrl());toast('Enlace copiado')};
  $('#sName').oninput=e=>{st.name=e.target.value;save();renderNav()};
  $('#sWa').oninput=e=>{st.whatsapp=e.target.value.replace(/\D/g,'');save()};
  $('#seoT').oninput=e=>{st.seoTitle=e.target.value;$('#seoPT').textContent=e.target.value;save()};
  $('#seoD').oninput=e=>{st.seoDesc=e.target.value;$('#seoPD').textContent=e.target.value;save()};
  const up=async()=>{st.logo=await pickImage(300);save();go('detalles')};
  $('#logoPick').onclick=up;$('#logoUp').onclick=up;
  $('#logoDel')&&($('#logoDel').onclick=()=>{st.logo='';save();go('detalles')});
};

/* --- productos --- */
let pq='',pcat='',psel=new Set(),pPage=1,pPer=15;
VIEWS.productos=()=>{
  if(sub.edit!==undefined)return productForm(sub.edit);
  const list=S.products.filter(p=>(!pcat||p.cat===pcat)&&(!pq||(p.title+' '+p.desc+' '+p.tags.join(' ')).toLowerCase().includes(pq.toLowerCase())));
  const pages=Math.max(1,Math.ceil(list.length/pPer));pPage=Math.min(pPage,pages);
  const shown=list.slice((pPage-1)*pPer,pPage*pPer);
  V(`<div class="row" style="margin-bottom:16px"><h1 style="margin:0;flex:1">Productos</h1>
    <button class="btn" id="imp">Importar Excel/CSV</button><button class="btn" id="expP">Exportar CSV</button><button class="btn primary" id="new">+ Crear nuevo</button></div>
  <div class="card"><div class="row"><h2 style="margin:0;flex:1">Categorías <span class="pill off">${S.categories.length}</span></h2><button class="btn sm" id="newCat">+ Nueva categoría</button></div>
    <div class="chips" style="margin-top:12px"><button class="chip" data-c="" style="${!pcat?'border-color:var(--accent);color:var(--accent)':''}">Todas · ${S.products.length}</button>
    ${S.categories.map(c=>`<button class="chip" data-c="${c.id}" style="${pcat===c.id?'border-color:var(--accent);color:var(--accent)':''}">${c.parent?'↳ ':''}${esc(c.name)} · ${S.products.filter(p=>p.cat===c.id).length}</button>`).join('')}
    <button class="chip" id="manageCats">Administrar</button></div></div>
  <div class="card">
    <div class="row" style="margin-bottom:10px"><select id="bulk" style="width:auto"><option value="">Acciones (${psel.size})</option><option value="show">Mostrar</option><option value="hide">Ocultar</option><option value="dup">Duplicar</option><option value="cat">Mover a categoría…</option><option value="del">Eliminar</option></select>
      <input type="search" id="q" placeholder="Buscar por título, descripción o etiqueta" value="${esc(pq)}" style="flex:1;min-width:200px"></div>
    <div class="tablewrap"><table><thead><tr><th></th><th><input type="checkbox" id="all"></th><th></th><th>Título</th><th>Categoría</th><th>Precio</th><th>Tipo</th><th>Inventario</th><th>Disponibilidad</th></tr></thead>
    <tbody id="rows">${shown.map(p=>`<tr draggable="true" data-id="${p.id}"><td class="drag">⋮⋮</td><td><input type="checkbox" class="sel" ${psel.has(p.id)?'checked':''}></td>
      <td>${p.img?`<img class="thumb" src="${esc(safeImg(p.img))}" alt="">`:'<div class="thumb">🏷</div>'}</td>
      <td><a href="#" class="ed">${esc(p.title)}</a></td><td>${esc(catName(p.cat))}</td>
      <td>${p.offer!==''&&p.offer!=null?`<s class="hint">${money(p.price)}</s> ${money(p.offer)}`:money(p.price)}</td><td>${p.cart?'Carrito':'Informativo'}</td><td>${p.stock>=99999?'∞':p.stock}</td>
      <td><button class="pill ${p.hidden?'off':p.stock<=0?'bad':'ok'} tog" style="background:none;cursor:pointer">${p.hidden?'Oculto':p.stock<=0?'Agotado':'Disponible'}</button></td></tr>`).join('')||'<tr><td colspan="9" class="empty">No hay productos</td></tr>'}</tbody></table></div>
    <div class="row" style="margin-top:12px"><span class="hint" style="flex:1">${list.length} productos</span>
      <select id="per" style="width:auto">${[15,30,50].map(n=>`<option ${n===pPer?'selected':''}>${n}</option>`).join('')}</select>
      <button class="btn sm" id="prev" ${pPage<=1?'disabled':''}>Anterior</button><span>Página ${pPage} de ${pages}</span><button class="btn sm" id="next" ${pPage>=pages?'disabled':''}>Siguiente</button></div>
  </div>`);
  $('#q').oninput=e=>{pq=e.target.value;pPage=1;VIEWS.productos();const q=$('#q');q.focus();q.setSelectionRange(q.value.length,q.value.length)};
  $$('.chip[data-c]').forEach(b=>b.onclick=()=>{pcat=b.dataset.c;pPage=1;VIEWS.productos()});
  $('#new').onclick=()=>go('productos',{edit:null});
  $('#newCat').onclick=()=>{const n=prompt('Nombre de la categoría');if(n){S.categories.push({id:uid(),name:n.trim(),parent:''});save();VIEWS.productos()}};
  $('#manageCats').onclick=manageCats;
  $('#imp').onclick=importCSV;
  $('#expP').onclick=()=>download('productos.csv',toCSV([['titulo','descripcion','precio','precio_oferta','categoria','etiquetas','inventario','oculto'],...S.products.map(p=>[p.title,p.desc,p.price,p.offer,catName(p.cat),p.tags.join(';'),p.stock,p.hidden?'si':'no'])]));
  $('#per').onchange=e=>{pPer=+e.target.value;pPage=1;VIEWS.productos()};
  $('#prev').onclick=()=>{pPage--;VIEWS.productos()};$('#next').onclick=()=>{pPage++;VIEWS.productos()};
  $('#all').onchange=e=>{shown.forEach(p=>e.target.checked?psel.add(p.id):psel.delete(p.id));VIEWS.productos()};
  $$('#rows tr[data-id]').forEach(tr=>{
    const id=tr.dataset.id,p=S.products.find(x=>x.id===id);
    $('.ed',tr).onclick=e=>{e.preventDefault();go('productos',{edit:id})};
    $('.sel',tr).onchange=e=>{e.target.checked?psel.add(id):psel.delete(id);$('#bulk option').textContent=`Acciones (${psel.size})`};
    $('.tog',tr).onclick=()=>{p.hidden=!p.hidden;save();VIEWS.productos()};
    tr.ondragstart=e=>e.dataTransfer.setData('id',id);
    tr.ondragover=e=>{e.preventDefault();tr.classList.add('drag-over')};
    tr.ondragleave=()=>tr.classList.remove('drag-over');
    tr.ondrop=e=>{e.preventDefault();const from=S.products.findIndex(x=>x.id===e.dataTransfer.getData('id'));const [m]=S.products.splice(from,1);S.products.splice(S.products.findIndex(x=>x.id===id),0,m);save();VIEWS.productos()};
  });
  $('#bulk').onchange=e=>{
    const a=e.target.value;if(!a)return;if(!psel.size){toast('Selecciona productos primero');e.target.value='';return}
    const sel=S.products.filter(p=>psel.has(p.id));
    if(a==='show'||a==='hide')sel.forEach(p=>p.hidden=a==='hide');
    if(a==='dup')sel.forEach(p=>S.products.push({...structuredClone(p),id:uid(),title:p.title+' (copia)'}));
    if(a==='cat'){const n=prompt('Categoría destino:\n'+S.categories.map(c=>c.name).join(', '));const c=S.categories.find(c=>c.name.toLowerCase()===(n||'').trim().toLowerCase());if(c)sel.forEach(p=>p.cat=c.id);else{toast('Categoría no encontrada');e.target.value='';return}}
    if(a==='del'){if(!confirm(`¿Eliminar ${sel.length} producto(s)?`)){e.target.value='';return}S.products=S.products.filter(p=>!psel.has(p.id))}
    psel.clear();save();VIEWS.productos();toast('Listo');
  };
};
function manageCats(){
  const draw=()=>modal(`<header><h2>Administrar categorías</h2><button class="btn icon" aria-label="Cerrar" data-act="close-modal">✕</button></header>
    <div class="catlist">${S.categories.filter(c=>!c.parent).map(c=>row(c)+S.categories.filter(s=>s.parent===c.id).map(s=>row(s,true)).join('')).join('')}</div>
    <div class="row" style="margin-top:12px"><input type="text" id="ncat" placeholder="Nueva categoría" style="flex:1"><button class="btn primary" id="addc">Agregar</button></div>
    <div class="hint">Arrastra no es necesario: usa ↑ ↓ para ordenar. Las subcategorías se muestran dentro de su categoría.</div>`);
  const row=(c,isSub)=>`<div class="c ${isSub?'sub':''}" data-id="${c.id}"><input type="text" class="cn" value="${esc(c.name)}" style="flex:1"><span class="hint">${S.products.filter(p=>p.cat===c.id).length}</span>
    <button class="btn sm up">↑</button><button class="btn sm dn">↓</button>${isSub?'':'<button class="btn sm addsub">+ Sub</button>'}<button class="btn sm danger del">✕</button></div>`;
  const bind=()=>{
    $$('#modalBox .c').forEach(el=>{const c=S.categories.find(x=>x.id===el.dataset.id);
      $('.cn',el).onchange=e=>{c.name=e.target.value;save()};
      const mv=d=>{const i=S.categories.indexOf(c),j=i+d;if(j<0||j>=S.categories.length)return;[S.categories[i],S.categories[j]]=[S.categories[j],S.categories[i]];save();draw();bind()};
      $('.up',el).onclick=()=>mv(-1);$('.dn',el).onclick=()=>mv(1);
      $('.addsub',el)&&($('.addsub',el).onclick=()=>{const n=prompt('Nombre de la subcategoría');if(n){S.categories.push({id:uid(),name:n,parent:c.id});save();draw();bind()}});
      $('.del',el).onclick=()=>{if(!confirm(`¿Eliminar "${c.name}"? Sus productos quedan sin categoría.`))return;S.categories=S.categories.filter(x=>x.id!==c.id&&x.parent!==c.id);S.products.forEach(p=>{if(!S.categories.find(x=>x.id===p.cat))p.cat=''});save();draw();bind()};
    });
    $('#addc').onclick=()=>{const v=$('#ncat').value.trim();if(v){S.categories.push({id:uid(),name:v,parent:''});save();draw();bind()}};
  };
  draw();bind();$('#modal').onclose=null;
  const old=closeModal;window.closeModal=()=>{old();window.closeModal=old;if(cur==='productos')VIEWS.productos()};
}
function toCSV(rows){return rows.map(r=>r.map(v=>{v=String(v??'');if(/^[=+\-@\t\r]/.test(v)&&isNaN(+v))v="'"+v;return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(',')).join('\n')}
function parseCSV(t){const rows=[];let r=[],v='',q=false;const sep=(t.split('\n')[0].match(/;/g)||[]).length>(t.split('\n')[0].match(/,/g)||[]).length?';':',';
  for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'&&t[i+1]==='"'){v+='"';i++}else if(c==='"')q=false;else v+=c}else if(c==='"')q=true;else if(c===sep){r.push(v);v=''}else if(c==='\n'){r.push(v);rows.push(r);r=[];v=''}else if(c!=='\r')v+=c}
  if(v||r.length){r.push(v);rows.push(r)}return rows.filter(r=>r.some(x=>x.trim()))}
function importCSV(){
  modal(`<header><h2>Importar Excel/CSV</h2><button class="btn icon" aria-label="Cerrar" data-act="close-modal">✕</button></header>
  <p>Guarda tu hoja de Excel como <b>CSV</b>. Columnas reconocidas (en la primera fila): <code>titulo, descripcion, precio, precio_oferta, categoria, etiquetas, inventario</code>.</p>
  <button class="btn" id="tpl">Descargar plantilla</button> <input type="file" id="csvf" accept=".csv,text/csv"><div id="csvprev" style="margin-top:12px"></div>`);
  $('#tpl').onclick=()=>download('plantilla-productos.csv',toCSV([['titulo','descripcion','precio','precio_oferta','categoria','etiquetas','inventario'],['Producto ejemplo','Descripción',10,'','General','marca;tipo',100]]));
  $('#csvf').onchange=async e=>{
    const f=e.target.files[0];if(!f)return;if(f.size>5*1024*1024){toast('El CSV supera 5 MB');return}
    const rows=parseCSV(await f.text());if(rows.length<2){toast('El archivo no tiene filas de productos');return}const h=rows.shift().map(x=>x.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''));
    const col=n=>h.findIndex(x=>x===n||x===n.replace('_',' '));
    const items=rows.map(r=>({title:r[col('titulo')]||r[0],desc:r[col('descripcion')]||'',price:+(r[col('precio')]||0),offer:r[col('precio_oferta')]||'',cat:r[col('categoria')]||'',tags:(r[col('etiquetas')]||'').split(/[;|]/).map(s=>s.trim()).filter(Boolean),stock:+(r[col('inventario')]||99999)})).filter(x=>x.title);
    $('#csvprev').innerHTML=`<p><b>${items.length}</b> productos listos para importar.</p><button class="btn primary" id="doimp">Importar</button>`;
    $('#doimp').onclick=()=>{items.forEach(it=>{let c=S.categories.find(c=>c.name.toLowerCase()===it.cat.toLowerCase());if(!c&&it.cat){c={id:uid(),name:str(it.cat,80),parent:''};S.categories.push(c)}
      S.products.push(cleanProduct({title:it.title,desc:it.desc,price:it.price,offer:it.offer===''?'':+it.offer,cat:c?c.id:'',tags:it.tags,stock:it.stock}))});
      save();closeModal();VIEWS.productos();toast(items.length+' productos importados')};
  };
}
function productForm(id){
  const orig=id?S.products.find(p=>p.id===id):null;
  const p=orig?structuredClone(orig):{id:uid(),title:'',desc:'',price:'',offer:'',cat:pcat||S.categories[0]?.id||'',tags:[],hidden:false,stock:99999,cart:true,img:'',imgs:[],options:[]};
  p.imgs=p.imgs||[];
  const draw=()=>{V(`<button class="btn sm" id="back">← Regresar</button>
  <h1 style="margin-top:14px">${orig?'Editar producto':'Nuevo producto'}</h1>
  <div class="card prodform">
    <div><div class="imgdrop" id="img">${p.img?`<img src="${esc(safeImg(p.img))}" alt="Imagen principal">`:'Haz clic para subir<br>la imagen principal'}</div>
      <div class="row" style="margin-top:8px">${p.imgs.map((s,i)=>`<div style="position:relative"><img src="${esc(safeImg(s))}" alt="" class="thumb" style="width:56px;height:56px"><button class="btn sm" aria-label="Quitar imagen" data-ri="${i}" style="position:absolute;top:-6px;right:-6px;padding:0 5px">✕</button></div>`).join('')}<button class="imgdrop" id="more" style="width:56px;height:56px;font-size:20px">+</button></div>
      ${p.img?'<button class="btn sm danger" id="rmimg" style="margin-top:8px">Quitar imagen</button>':''}
      <div class="card" style="margin-top:14px;box-shadow:none"><h3>Asistente de textos</h3><div class="hint">Genera una descripción a partir del título y la categoría.</div><button class="btn sm" id="ai" style="margin-top:8px">✨ Generar descripción</button> <button class="btn sm" id="ai2" style="margin-top:8px">Mejorar redacción</button></div>
    </div>
    <div>
      <label class="f">Producto de carrito</label><select id="cart"><option value="1" ${p.cart?'selected':''}>Sí — se puede agregar al carrito</option><option value="0" ${!p.cart?'selected':''}>No — solo informativo</option></select>
      <label class="f">Título</label><input type="text" id="t" value="${esc(p.title)}">
      <label class="f">Descripción</label><textarea id="d">${esc(p.desc)}</textarea>
      <div class="grid2"><div><label class="f">Precio (${S.store.currency})</label><input type="number" step="0.01" id="pr" value="${p.price}"></div><div><label class="f">Precio oferta (${S.store.currency})</label><input type="number" step="0.01" id="of" value="${p.offer}"></div></div>
      <label class="f">Categoría</label><select id="cat"><option value="">Sin categoría</option>${S.categories.map(c=>`<option value="${c.id}" ${c.id===p.cat?'selected':''}>${c.parent?'↳ ':''}${esc(c.name)}</option>`).join('')}</select>
      <label class="f">Etiquetas</label><div class="chips" id="tags">${p.tags.map((t,i)=>`<span class="chip">${esc(t)}<button data-i="${i}">✕</button></span>`).join('')}</div>
      <input type="text" id="tagIn" placeholder="Escribe y presiona Enter (ej: marca, tipo, beneficio)" style="margin-top:6px"><div class="hint">Ayudan a tus clientes a filtrar mejor.</div>
      <label class="chk"><input type="checkbox" id="hid" ${p.hidden?'checked':''}> Esconder <span class="hint">— oculta el producto de la tienda</span></label>
      <label class="f">Inventario</label><input type="number" id="stk" value="${p.stock}" style="max-width:200px"><div class="hint">Cada pedido resta las unidades vendidas. Si no llevas inventario, déjalo en 99999.</div>
      <h2 style="margin-top:24px">Opciones adicionales del producto</h2>
      <div id="opts">${p.options.map((o,oi)=>`<div class="optcat" data-oi="${oi}"><div class="row"><b style="flex:1">Categoría de opciones ${oi+1}</b><button class="btn sm danger delcat">Eliminar categoría</button></div>
        <div class="row" style="margin-top:8px"><input type="text" class="ot" placeholder="Ej. Elige un tamaño" value="${esc(o.title)}" style="flex:1;min-width:180px">
        <label class="chk"><input type="checkbox" class="oreq" ${o.required?'checked':''}> Obligatorio</label><label class="chk"><input type="checkbox" class="omul" ${o.multi?'checked':''}> Opción múltiple</label></div>
        ${o.items.map((it,ii)=>`<div class="optitem" data-ii="${ii}"><input type="text" class="it" placeholder="Título de la opción" value="${esc(it.title)}"><input type="number" class="ip" placeholder="Precio extra" value="${it.price}"><label class="chk"><input type="checkbox" class="ia" ${it.available?'checked':''}> Disponible</label><button class="btn sm danger idel">✕</button></div>`).join('')}
        <button class="btn sm addit" style="margin-top:10px">+ Agregar opción</button></div>`).join('')}</div>
      <button class="btn" id="addopt">+ Agregar categoría de opciones</button>
      <div class="savebar">${orig?'<button class="btn danger" id="del">Eliminar</button><button class="btn" id="dup">Duplicar</button>':''}<button class="btn" id="cancel">Cancelar</button><button class="btn primary" id="save">Guardar</button></div>
    </div></div>`);bind()};
  const sync=()=>{p.cart=$('#cart').value==='1';p.title=$('#t').value;p.desc=$('#d').value;p.price=$('#pr').value===''?'':+$('#pr').value;p.offer=$('#of').value===''?'':+$('#of').value;p.cat=$('#cat').value;p.hidden=$('#hid').checked;p.stock=+$('#stk').value||0;
    $$('.optcat').forEach(el=>{const o=p.options[+el.dataset.oi];o.title=$('.ot',el).value;o.required=$('.oreq',el).checked;o.multi=$('.omul',el).checked;$$('.optitem',el).forEach(r=>{const it=o.items[+r.dataset.ii];it.title=$('.it',r).value;it.price=+$('.ip',r).value||0;it.available=$('.ia',r).checked})})};
  const bind=()=>{
    $('#back').onclick=$('#cancel').onclick=()=>go('productos');
    $('#img').onclick=async()=>{sync();p.img=await pickImage();draw()};
    $('#more').onclick=async()=>{sync();p.imgs.push(await pickImage());draw()};
    $$('[data-ri]').forEach(b=>b.onclick=()=>{sync();p.imgs.splice(+b.dataset.ri,1);draw()});
    $('#rmimg')&&($('#rmimg').onclick=()=>{sync();p.img='';draw()});
    $('#tagIn').onkeydown=e=>{if(e.key==='Enter'&&e.target.value.trim()){e.preventDefault();sync();p.tags.push(e.target.value.trim());draw();$('#tagIn').focus()}};
    $$('#tags button').forEach(b=>b.onclick=()=>{sync();p.tags.splice(+b.dataset.i,1);draw()});
    $('#addopt').onclick=()=>{sync();p.options.push({title:'',required:false,multi:false,items:[{title:'',price:0,available:true}]});draw()};
    $$('.optcat').forEach(el=>{const oi=+el.dataset.oi;
      $('.delcat',el).onclick=()=>{sync();p.options.splice(oi,1);draw()};
      $('.addit',el).onclick=()=>{sync();p.options[oi].items.push({title:'',price:0,available:true});draw()};
      $$('.idel',el).forEach(b=>b.onclick=()=>{sync();p.options[oi].items.splice(+b.closest('.optitem').dataset.ii,1);draw()})});
    $('#ai').onclick=()=>{sync();const c=catName(p.cat);$('#d').value=`${p.title||'Este producto'}: ${c!=='Sin categoría'?'de nuestra línea de '+c.toLowerCase()+', ':''}seleccionado para quienes cuidan cada detalle. ${p.tags.length?'Ideal si buscas '+p.tags.join(', ')+'. ':''}Pídelo hoy y recíbelo rápido.`};
    $('#ai2').onclick=()=>{const d=$('#d').value.trim().replace(/\s+/g,' ');$('#d').value=d?d[0].toUpperCase()+d.slice(1).replace(/([^.!?])$/,'$1.'):d};
    $('#save').onclick=()=>{sync();if(!p.title.trim()){toast('El título es obligatorio');return}
      if(orig)Object.assign(orig,p);else S.products.unshift(p);save();toast('Producto guardado');go('productos')};
    $('#del')&&($('#del').onclick=()=>{if(confirm('¿Eliminar este producto?')){S.products=S.products.filter(x=>x.id!==id);save();go('productos')}});
    $('#dup')&&($('#dup').onclick=()=>{sync();const c={...structuredClone(p),id:uid(),title:p.title+' (copia)'};S.products.unshift(c);save();go('productos',{edit:c.id});toast('Duplicado')});
  };
  draw();
}

/* --- diseño --- */
let selBlock=null, dTab='bloques', device='mobile';
VIEWS.diseno=()=>{
  const D=S.design;
  V(`<div class="row" style="margin-bottom:12px"><h1 style="margin:0;flex:1">Diseño de página</h1><button class="btn primary" data-act="open-store">Ver tienda</button></div>
  <div class="designer"><div>
    <div class="tabs"><button data-t="bloques" class="${dTab==='bloques'?'on':''}">Bloques</button><button data-t="global" class="${dTab==='global'?'on':''}">Global</button></div>
    <div id="dpanel"></div></div>
    <div class="stage"><div class="seg" style="width:160px"><button data-dev="mobile" class="${device==='mobile'?'on':''}">Móvil</button><button data-dev="desk" class="${device==='desk'?'on':''}">Escritorio</button></div>
      <div class="phone ${device==='desk'?'desk':''}"><iframe id="pv" title="Vista previa" src="index.html?preview=1"></iframe></div></div></div>`);
  $$('.tabs button').forEach(b=>b.onclick=()=>{dTab=b.dataset.t;VIEWS.diseno()});
  $$('[data-dev]').forEach(b=>b.onclick=()=>{device=b.dataset.dev;VIEWS.diseno()});
  dTab==='bloques'?blocksPanel():globalPanel();
  refreshPreview();
};
function blocksPanel(){
  const D=S.design,b=D.blocks.find(x=>x.id===selBlock);
  if(b)return blockEditor(b);
  $('#dpanel').innerHTML=`<button class="btn primary" id="addb" style="width:100%;justify-content:center;margin-bottom:12px">+ Agregar bloque</button>
    <div class="blocks">${D.blocks.map(b=>`<div class="blk" draggable="true" data-id="${b.id}"><span class="drag">⋮⋮</span><span class="n">${BLOCKS[b.type].n}</span>
      <button class="btn icon sm up" title="Subir">↑</button><button class="btn icon sm dn" title="Bajar">↓</button><button class="btn icon sm dup" title="Duplicar">⧉</button><button class="btn icon sm danger del" title="Eliminar">✕</button></div>`).join('')}</div>`;
  $('#addb').onclick=blockLibrary;
  $$('.blk').forEach(el=>{const id=el.dataset.id,i=D.blocks.findIndex(x=>x.id===id);
    el.onclick=e=>{if(e.target.closest('button'))return;selBlock=id;blocksPanel()};
    const mv=d=>{const j=i+d;if(j<0||j>=D.blocks.length)return;[D.blocks[i],D.blocks[j]]=[D.blocks[j],D.blocks[i]];save();blocksPanel()};
    $('.up',el).onclick=()=>mv(-1);$('.dn',el).onclick=()=>mv(1);
    $('.dup',el).onclick=()=>{D.blocks.splice(i+1,0,{...structuredClone(D.blocks[i]),id:uid()});save();blocksPanel()};
    $('.del',el).onclick=()=>{if(confirm('¿Eliminar este bloque?')){D.blocks.splice(i,1);save();blocksPanel()}};
    el.ondragstart=e=>e.dataTransfer.setData('id',id);
    el.ondragover=e=>{e.preventDefault();el.classList.add('drag-over')};el.ondragleave=()=>el.classList.remove('drag-over');
    el.ondrop=e=>{e.preventDefault();const f=D.blocks.findIndex(x=>x.id===e.dataTransfer.getData('id'));const [m]=D.blocks.splice(f,1);D.blocks.splice(D.blocks.findIndex(x=>x.id===id),0,m);save();blocksPanel()};
  });
}
function blockLibrary(){
  modal(`<header><h2>Agregar bloque</h2><button class="btn icon" aria-label="Cerrar" data-act="close-modal">✕</button></header>
    <input type="search" id="bq" placeholder="Buscar bloques…" style="margin-bottom:12px"><div class="blocklib" id="bl"></div>`);
  const draw=q=>{$('#bl').innerHTML=Object.entries(BLOCKS).filter(([k,b])=>(b.n+b.d).toLowerCase().includes(q.toLowerCase())).map(([k,b])=>`<button data-k="${k}"><b>${b.n}</b><span>${b.d}</span></button>`).join('');
    $$('#bl button').forEach(x=>x.onclick=()=>{const nb={id:uid(),type:x.dataset.k,props:structuredClone(BLOCKS[x.dataset.k].def)};S.design.blocks.push(nb);selBlock=nb.id;save();closeModal();blocksPanel()})};
  draw('');$('#bq').oninput=e=>draw(e.target.value);$('#bq').focus();
}
function blockEditor(b){
  const def=BLOCKS[b.type];
  $('#dpanel').innerHTML=`<div class="card"><div class="row"><button class="btn sm" id="bk">←</button><h2 style="margin:0;flex:1">${def.n}</h2></div>
    ${def.f.map(([k,label,type,opts])=>{const v=b.props[k];
      if(type==='bool')return `<label class="chk"><input type="checkbox" data-k="${k}" ${v?'checked':''}> ${label}</label>`;
      let h=`<label class="f">${label}</label>`;
      if(type==='textarea')return h+`<textarea data-k="${k}">${esc(v)}</textarea>`;
      if(type==='select')return h+`<select data-k="${k}">${opts.map(o=>`<option ${o===v?'selected':''}>${o}</option>`).join('')}</select>`;
      if(type==='color')return h+`<div class="row"><input type="color" data-k="${k}" value="${v||'#ffffff'}"><button class="btn sm" data-clear="${k}">Sin color</button></div>`;
      if(type==='range')return h+`<input type="range" min="0" max="90" data-k="${k}" value="${v}" style="width:100%">`;
      if(type==='image')return h+`<div class="row">${v?`<img src="${esc(safeImg(v))}" alt="" class="thumb" style="width:80px;height:60px">`:''}<button class="btn sm" data-img="${k}">${v?'Cambiar':'Subir'} imagen</button>${v?`<button class="btn sm danger" data-clear="${k}">Quitar</button>`:''}</div>`;
      if(type==='images')return h+`<div class="row">${(v||[]).map((s,i)=>`<img src="${esc(safeImg(s))}" alt="Quitar" class="thumb" data-rm="${i}" title="Clic para quitar" style="width:56px;height:56px;cursor:pointer">`).join('')}<button class="btn sm" data-imgs="${k}">+ Imagen</button></div>`;
      return h+`<input type="${type}" data-k="${k}" value="${esc(v)}">`}).join('')}</div>`;
  $('#bk').onclick=()=>{selBlock=null;blocksPanel()};
  $$('#dpanel [data-k]').forEach(el=>el.oninput=el.onchange=()=>{b.props[el.dataset.k]=el.type==='checkbox'?el.checked:(el.type==='number'||el.type==='range')?+el.value:el.value;save()});
  $$('#dpanel [data-img]').forEach(el=>el.onclick=async()=>{b.props[el.dataset.img]=await pickImage(1200);save();blockEditor(b)});
  $$('#dpanel [data-imgs]').forEach(el=>el.onclick=async()=>{(b.props[el.dataset.imgs]=b.props[el.dataset.imgs]||[]).push(await pickImage(900));save();blockEditor(b)});
  $$('#dpanel [data-rm]').forEach(el=>el.onclick=()=>{b.props.imgs.splice(+el.dataset.rm,1);save();blockEditor(b)});
  $$('#dpanel [data-clear]').forEach(el=>el.onclick=()=>{b.props[el.dataset.clear]='';save();blockEditor(b)});
}
function globalPanel(){
  const D=S.design;
  $('#dpanel').innerHTML=`<div class="card"><h3>Paletas de colores</h3><div class="swatches">${Object.entries(PALETTES).map(([n,c])=>`<button data-p="${n}" class="${D.palette===n?'on':''}"><i style="background:linear-gradient(90deg,${c[0]} 0 40%,${c[1]} 40% 75%,${c[2]} 75%)"></i>${n}</button>`).join('')}</div>
    <h3 style="margin-top:16px">Colores</h3>
    <div class="row"><label class="row" style="gap:6px"><input type="color" id="c1" value="${D.primary}"> Primario (botones)</label></div>
    <div class="row" style="margin-top:6px"><label class="row" style="gap:6px"><input type="color" id="c2" value="${D.secondary}"> Secundario (fondos)</label></div>
    <div class="row" style="margin-top:6px"><label class="row" style="gap:6px"><input type="color" id="c3" value="${D.text}"> Terciario (textos)</label></div></div>
  <div class="card"><h3>Fuente</h3><div class="fonts">${FONTS.map(f=>`<button data-f="${f}" class="${D.font===f?'on':''}" style="font-family:'${f}'"><b>Aa</b> ${f}</button>`).join('')}</div></div>
  <div class="card"><h3>Esquinas</h3><div class="seg">${[['square','Rectas'],['semi','Semi'],['round','Redondeadas']].map(([k,n])=>`<button data-c="${k}" class="${D.corners===k?'on':''}">${n}</button>`).join('')}</div></div>`;
  $$('[data-p]').forEach(b=>b.onclick=()=>{const c=PALETTES[b.dataset.p];Object.assign(D,{palette:b.dataset.p,primary:c[0],secondary:c[1],text:c[2]});save();globalPanel()});
  [['c1','primary'],['c2','secondary'],['c3','text']].forEach(([id,k])=>$('#'+id).oninput=e=>{D[k]=e.target.value;D.palette='';save()});
  $$('[data-f]').forEach(b=>b.onclick=()=>{D.font=b.dataset.f;save();globalPanel()});
  $$('[data-c]').forEach(b=>b.onclick=()=>{D.corners=b.dataset.c;save();globalPanel()});
}
/* --- pedidos (llegan en tiempo real desde la tienda) --- */
let oStatus='',oQ='',oFrom='',oTo='';
const PILL={Recibido:'warn','En Preparación':'warn',Listo:'ok',Entregado:'ok',Cancelado:'bad'};
VIEWS.pedidos=()=>{
  const today=new Date().toDateString(),tod=S.orders.filter(o=>new Date(o.date).toDateString()===today&&o.status!=='Cancelado');
  const inc=tod.reduce((a,o)=>a+o.total,0);
  const list=S.orders.filter(o=>(!oStatus||o.status===oStatus)&&(!oQ||String(o.num).includes(oQ)||o.customer.name.toLowerCase().includes(oQ.toLowerCase()))&&(!oFrom||o.date.slice(0,10)>=oFrom)&&(!oTo||o.date.slice(0,10)<=oTo));
  V(`<h1>Pedidos</h1>
  <div class="card row"><div style="flex:1"><b>Sonido de pedidos</b><div class="hint">Suena en este navegador cuando entra un pedido nuevo (con el panel abierto).</div></div>${sw('snd',prefs.sound)}<button class="btn sm" data-act="beep">Probar</button></div>
  <h3>Hoy</h3><div class="grid4"><div class="stat"><small>Pedidos</small><div>${tod.length}</div></div><div class="stat"><small>Ingresos</small><div>${money(inc)}</div></div><div class="stat"><small>Ticket promedio</small><div>${money(tod.length?inc/tod.length:0)}</div></div><div class="stat"><small>Por atender</small><div>${S.orders.filter(o=>o.status==='Recibido'||o.status==='En Preparación').length}</div></div></div>
  <div class="card" style="margin-top:16px"><div class="row"><select id="ost" style="width:auto"><option value="">Todos</option>${STATUSES.map(s=>`<option ${s===oStatus?'selected':''}>${s}</option>`).join('')}</select>
    <input type="search" id="oq" placeholder="# Número o cliente" value="${esc(oQ)}" style="flex:1;min-width:140px"><input type="date" id="of" value="${esc(oFrom)}" style="width:auto"><input type="date" id="ot" value="${esc(oTo)}" style="width:auto">
    <button class="btn" id="oexp">Exportar</button><button class="btn primary" id="onew">+ Nuevo pedido</button></div>
    <div class="tablewrap" style="margin-top:12px">${list.length?`<table><thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Total</th><th>Pago</th><th>Estado</th></tr></thead><tbody>${list.map(o=>`<tr data-id="${esc(o.id)}" style="cursor:pointer"><td><b>${o.num}</b></td><td>${new Date(o.date).toLocaleString('es',{dateStyle:'short',timeStyle:'short'})}</td><td>${esc(o.customer.name||'—')}</td><td>${esc(o.type)}</td><td>${money(o.total)}</td><td><span class="pill ${o.paid?'ok':'off'}">${o.paid?'Pagado':'Sin confirmar'}</span></td><td><span class="pill ${PILL[o.status]}">${o.status}</span></td></tr>`).join('')}</tbody></table>`:'<div class="empty"><b>No hay pedidos para mostrar</b><br>Los pedidos que se hagan desde la tienda aparecen aquí al instante.</div>'}</div></div>`);
  bindSwitch('snd',prefs,'sound');$('#snd').onchange=e=>{prefs.sound=e.target.checked;savePrefs()};
  $('#ost').onchange=e=>{oStatus=e.target.value;VIEWS.pedidos()};
  $('#oq').onchange=e=>{oQ=e.target.value;VIEWS.pedidos()};
  $('#of').onchange=e=>{oFrom=e.target.value;VIEWS.pedidos()};$('#ot').onchange=e=>{oTo=e.target.value;VIEWS.pedidos()};
  $('#oexp').onclick=()=>download('pedidos.csv',toCSV([['numero','fecha','cliente','telefono','correo','tipo','direccion','pago','pagado','productos','descuento','envio','impuestos','total','estado'],...list.map(o=>[o.num,o.date,o.customer.name,o.customer.phone,o.customer.email,o.type,o.address,o.pay,o.paid?'si':'no',o.items.map(i=>i.q+'x '+i.title).join(' / '),o.discount,o.shipping,o.tax,o.total,o.status])]));
  $('#onew').onclick=newOrder;
  $$('tr[data-id]').forEach(tr=>tr.onclick=()=>orderDetail(tr.dataset.id));
};
function orderDetail(id){const o=S.orders.find(x=>x.id===id);if(!o)return;
  const phone=digits(o.customer.phone);
  modal(`<header><h2>Pedido #${o.num}</h2><button class="btn icon" aria-label="Cerrar" data-act="close-modal">✕</button></header>
  <div class="grid2"><div><div class="hint">${new Date(o.date).toLocaleString('es')}</div><p><b>${esc(o.customer.name||'Sin nombre')}</b><br>${esc(o.customer.phone)} ${esc(o.customer.email)}</p><p>${esc(o.type)}${o.address?'<br>'+esc(o.address):''}${o.pay?'<br>Pago: '+esc(o.pay):''}${o.promo?'<br>Código: '+esc(o.promo):''}</p>
    ${o.answers.length?`<div class="hint">${o.answers.map(a=>`<b>${esc(a.q)}</b>: ${esc(a.a)}`).join('<br>')}</div>`:''}</div>
  <div><label class="f">Estado</label><select id="ostat" ${o.status==='Cancelado'?'disabled':''}>${STATUSES.map(s=>`<option ${s===o.status?'selected':''}>${s}</option>`).join('')}</select>
    <div class="hint">Cancelar devuelve el stock y no se puede deshacer.</div>
    <label class="chk"><input type="checkbox" id="opaid" ${o.paid?'checked':''}> Pago recibido</label><div class="hint">Márcalo solo cuando hayas verificado el dinero.</div></div></div>
  <table style="margin-top:10px">${o.items.map(i=>`<tr><td>${i.q}x</td><td>${esc(i.title)}${i.opts.length?`<div class="hint">${esc(i.opts.join(', '))}</div>`:''}${i.note?`<div class="hint">Nota: ${esc(i.note)}</div>`:''}</td><td style="text-align:right">${money(i.price*i.q)}</td></tr>`).join('')}
  ${o.discount?`<tr><td></td><td>Descuento</td><td style="text-align:right">−${money(o.discount)}</td></tr>`:''}${o.tax?`<tr><td></td><td>Impuestos</td><td style="text-align:right">${money(o.tax)}</td></tr>`:''}${o.shipping?`<tr><td></td><td>Envío</td><td style="text-align:right">${money(o.shipping)}</td></tr>`:''}
  <tr><td></td><td><b>Total</b></td><td style="text-align:right"><b>${money(o.total)}</b></td></tr></table>
  <div class="row" style="margin-top:14px;justify-content:flex-end">${phone?`<a class="btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/${phone}?text=${encodeURIComponent('Hola '+o.customer.name+', tu pedido #'+o.num+' está: '+o.status)}">Avisar por WhatsApp</a>`:''}<button class="btn danger" id="odel">Eliminar</button></div>`);
  $('#ostat').onchange=e=>{if(e.target.value==='Cancelado'&&!confirm('¿Cancelar el pedido? Se devuelve el stock y no se puede deshacer.')){e.target.value=o.status;return}o.status=e.target.value;save();VIEWS.pedidos();orderDetail(id)};
  $('#opaid').onchange=e=>{o.paid=e.target.checked;save();VIEWS.pedidos()};
  $('#odel').onclick=()=>{if(confirm(`¿Eliminar el pedido #${o.num}? No se puede deshacer y no devuelve stock.`)){S.orders=S.orders.filter(x=>x!==o);save();closeModal();VIEWS.pedidos()}};
}
/* pedido manual: también pasa por place_order, así el servidor calcula precios y stock */
function newOrder(){
  const C=S.checkout,P=S.payments;const items=[];
  const types=[C.delivery&&'Entrega a domicilio',C.pickup&&'Recoger en sucursal',C.table&&'Pedido en mesa'].filter(Boolean);
  const pays=[P.cash&&'Efectivo',P.transfer&&'Transferencia',P.custom&&(P.customName||'Otro')].filter(Boolean);
  const draw=()=>{const keep={n:$('#nn')?.value||'',p:$('#np')?.value||''};
    modal(`<header><h2>Nuevo pedido</h2><button class="btn icon" aria-label="Cerrar" data-act="close-modal">✕</button></header>
    <div class="grid2"><div><label class="f">Cliente</label><input type="text" id="nn" maxlength="120" value="${esc(keep.n)}"></div><div><label class="f">Teléfono</label><input type="tel" id="np" maxlength="25" value="${esc(keep.p)}"></div></div>
    <div class="grid2"><div><label class="f">Tipo</label><select id="nt">${types.map(t=>`<option>${t}</option>`).join('')}</select></div><div><label class="f">Pago</label><select id="npay">${pays.map(t=>`<option>${esc(t)}</option>`).join('')||'<option value="">—</option>'}</select></div></div>
    <label class="f">Agregar producto (sin opciones)</label><div class="row"><select id="nprod" style="flex:1">${S.products.filter(p=>p.cart&&!p.hidden).map(p=>`<option value="${esc(p.id)}">${esc(p.title)} — ${money(unitPrice(p))}</option>`).join('')}</select><input type="number" id="nq" value="1" min="1" max="999" style="width:70px"><button class="btn" id="nadd">Agregar</button></div>
    <table style="margin-top:10px">${items.map(i=>`<tr><td>${i.q}x ${esc(i.title)}</td></tr>`).join('')}</table>
    <p class="hint">El total lo calcula el servidor al crear el pedido.</p>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" id="nsave">Crear pedido</button></div>`);
    $('#nadd').onclick=()=>{const p=S.products.find(x=>x.id===$('#nprod').value);if(!p)return;items.push({id:p.id,title:p.title,q:Math.min(999,Math.max(1,+$('#nq').value||1)),sel:[]});draw()};
    $('#nsave').onclick=async()=>{if(!items.length){toast('Agrega al menos un producto');return}
      const btn=$('#nsave');btn.disabled=true;
      const {data,error}=await sb.rpc('place_order',{payload:{items:items.map(({id,q,sel})=>({id,q,sel})),type:$('#nt').value,pay:$('#npay').value,customer:{name:$('#nn').value,phone:$('#np').value},address:{}}});
      btn.disabled=false;
      if(error){toast(orderError(error));return}
      closeModal();toast('Pedido #'+data.num+' creado');await reloadOrders()}};
  draw();
}

/* --- clientes --- */
VIEWS.clientes=()=>{
  const m={};S.orders.forEach(o=>{const k=(o.customer.phone||o.customer.email||'').trim();if(!k)return;const c=m[k]||(m[k]={name:o.customer.name,phone:o.customer.phone,email:o.customer.email,n:0,total:0,last:o.date});c.n++;if(o.status!=='Cancelado')c.total+=o.total;if(o.date>c.last)c.last=o.date});
  const cs=Object.values(m).sort((a,b)=>b.total-a.total);
  V(`<div class="row" style="margin-bottom:16px"><div style="flex:1"><h1 style="margin:0">Clientes</h1><div class="hint">Las personas que te compran en esta página</div></div>${cs.length?'<button class="btn" id="cexp">Exportar CSV</button>':''}</div>
  <div class="card">${cs.length?`<div class="tablewrap"><table><thead><tr><th>Cliente</th><th>Contacto</th><th>Pedidos</th><th>Total gastado</th><th>Último pedido</th><th></th></tr></thead><tbody>${cs.map(c=>`<tr><td><b>${esc(c.name||'—')}</b></td><td>${esc(c.phone)} ${esc(c.email)}</td><td>${c.n}</td><td>${money(c.total)}</td><td>${new Date(c.last).toLocaleDateString('es')}</td><td>${digits(c.phone)?`<a class="btn sm" target="_blank" rel="noopener noreferrer" href="https://wa.me/${digits(c.phone)}">WhatsApp</a>`:''}</td></tr>`).join('')}</tbody></table></div>`
  :'<div class="empty"><b>Todavía no tienes clientes</b><br>Cuando recibas pedidos con teléfono o correo, tus clientes aparecerán aquí automáticamente.</div>'}</div>`);
  $('#cexp')&&($('#cexp').onclick=()=>download('clientes.csv',toCSV([['nombre','telefono','correo','pedidos','total'],...cs.map(c=>[c.name,c.phone,c.email,c.n,c.total])])));
};

/* --- pagos: solo métodos que no requieren cobro en línea --- */
VIEWS.pagos=()=>{const P=S.payments;
  V(`<h1>Pagos</h1><div class="card"><h2>Métodos de pago</h2><div class="hint">Los métodos activos se ofrecen al cliente. Ningún método cobra en línea: confirma el dinero tú y marca el pedido como "Pago recibido".</div>
  ${setting('pcash','Efectivo','El cliente paga al recibir o retirar.',P.cash)}
  ${setting('ptransfer','Transferencia','Se muestran tus datos bancarios al confirmar el pedido.',P.transfer)}
  ${P.transfer?`<textarea id="ptinfo" maxlength="2000" placeholder="Banco, titular, CLABE/CBU…">${esc(P.transferInfo)}</textarea>`:''}
  ${setting('pcustom','Personalizado','Cualquier otro método (Mercado Pago, Zelle, etc.).',P.custom)}
  ${P.custom?`<div class="grid2"><input type="text" id="pcn" maxlength="60" placeholder="Nombre del método" value="${esc(P.customName)}"><input type="text" id="pci" maxlength="500" placeholder="Instrucciones" value="${esc(P.customInfo)}"></div>`:''}</div>
  <div class="card"><h2>Tarjeta y PayPal</h2><p class="hint">No disponibles: cobrar con tarjeta requiere un procesador de pagos (Stripe, Mercado Pago, PayPal) con verificación en un servidor. Mostrar la opción sin cobro real haría creer que un pedido está pagado.</p></div>`);
  [['pcash','cash'],['ptransfer','transfer'],['pcustom','custom']].forEach(([i,k])=>bindSwitch(i,P,k,VIEWS.pagos));
  bindInput('#ptinfo',P,'transferInfo');bindInput('#pcn',P,'customName');bindInput('#pci',P,'customInfo');
};

/* --- estadísticas --- */
let eTab='ventas';
VIEWS.estadisticas=()=>{
  const valid=S.orders.filter(o=>o.status!=='Cancelado');
  const days=[...Array(14)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-13+i);return d});
  const per=days.map(d=>valid.filter(o=>new Date(o.date).toDateString()===d.toDateString()).reduce((a,o)=>a+o.total,0));
  const max=Math.max(1,...per);
  const top={};valid.forEach(o=>o.items.forEach(i=>{top[i.title]=(top[i.title]||0)+i.q}));
  const tops=Object.entries(top).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const total=valid.reduce((a,o)=>a+o.total,0);
  V(`<h1>Estadísticas</h1><div class="tabs"><button data-t="ventas" class="${eTab==='ventas'?'on':''}">Ventas</button><button data-t="visitas" class="${eTab==='visitas'?'on':''}">Visitas</button></div>
  ${eTab==='ventas'?`<div class="grid4"><div class="stat"><small>Ventas totales</small><div>${money(total)}</div></div><div class="stat"><small>Pedidos</small><div>${valid.length}</div></div><div class="stat"><small>Ticket promedio</small><div>${money(valid.length?total/valid.length:0)}</div></div><div class="stat"><small>Productos activos</small><div>${S.products.filter(p=>!p.hidden).length}</div></div></div>
  <div class="card" style="margin-top:16px"><h2>Ingresos · últimos 14 días</h2>
    <svg viewBox="0 0 700 220" style="width:100%;height:auto" role="img" aria-label="Ingresos por día">${per.map((v,i)=>`<g><rect x="${i*50+8}" y="${190-v/max*170}" width="34" height="${Math.max(v/max*170,1)}" rx="4" fill="var(--accent)"><title>${days[i].toLocaleDateString('es')}: ${money(v)}</title></rect><text x="${i*50+25}" y="210" font-size="11" text-anchor="middle" fill="var(--muted)">${days[i].getDate()}</text></g>`).join('')}</svg></div>
  <div class="card"><h2>Más vendidos</h2>${tops.length?tops.map(([t,q])=>`<div class="row" style="padding:6px 0"><span style="flex:1">${esc(t)}</span><b>${q} u.</b></div>`).join(''):'<div class="empty">Aún no hay ventas.</div>'}</div>`
  :`<div class="grid4"><div class="stat"><small>Visitas a la tienda</small><div>${S.visits}</div></div><div class="stat"><small>Conversión</small><div>${S.visits?Math.round(valid.length/S.visits*100):0}%</div></div></div><p class="hint">Cuenta una visita por sesión de navegador. Es aproximado: no filtra robots ni recargas en sesiones nuevas.</p>`}`);
  $$('.tabs button').forEach(b=>b.onclick=()=>{eTab=b.dataset.t;VIEWS.estadisticas()});
};

/* --- checkout (todo lo que se configura aquí lo valida place_order en el servidor) --- */
let cTab='general';
VIEWS.checkout=()=>{const C=S.checkout;
  const T=[['general','General'],['mensaje','Mensaje'],['promos','Promociones'],['legal','Páginas legales'],['preguntas','Preguntas al cliente']];
  let body='';
  if(cTab==='general')body=`<div class="card">${setting('cpause','Pausar pedidos','La tienda sigue visible pero no acepta pedidos nuevos.',C.paused)}
      <label class="f">Moneda</label><select id="ccur">${CURRENCIES.map(c=>`<option ${c===S.store.currency?'selected':''}>${c}</option>`).join('')}</select>
      ${setting('cqon','Mostrar preguntas del checkout','Tus clientes responden las preguntas configuradas en "Preguntas al cliente".',C.questionsOn)}</div>
    <div class="card"><h2>Campos de dirección</h2><div class="hint">Campos que el cliente llena para entregas a domicilio.</div>
      <table><thead><tr><th>Campo</th><th>Mostrar</th><th>Obligatorio</th></tr></thead><tbody>${[['line1','Dirección (línea 1)'],['line2','Depto. / N° interior'],['city','Ciudad'],['state','Estado'],['zip','Código postal']].map(([k,n])=>`<tr><td>${n}</td><td><input type="checkbox" data-a="${k}" data-i="0" ${C.addr[k][0]?'checked':''}></td><td><input type="checkbox" data-a="${k}" data-i="1" ${C.addr[k][1]?'checked':''}></td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h2>Impuestos</h2>${setting('ctax','Habilitar impuestos','Se calculan sobre el subtotal después de descuentos.',C.taxOn)}
      ${C.taxOn?`<div class="grid2"><input type="text" id="ctn" maxlength="30" value="${esc(C.taxName)}"><input type="number" id="ctp" min="0" max="100" value="${C.taxPct}" placeholder="%"></div>`:''}</div>
    <div class="card"><h2>Tipos de pedido</h2>${setting('cdel','Entrega a domicilio','El cliente ingresa su dirección.',C.delivery)}
      ${C.delivery?`<label class="f">Precio de entrega fijo (${S.store.currency})</label><input type="number" id="cdp" min="0" value="${C.deliveryPrice}" style="max-width:200px">`:''}
      ${setting('cpick','Recoger en sucursal','',C.pickup)}
      ${setting('ctab','Pedido en mesa','El cliente indica el número de mesa.',C.table)}</div>
    <div class="card"><h2>Información del cliente</h2>${setting('cn','Pedir nombre','',C.askName)}${setting('cp','Pedir teléfono','',C.askPhone)}${setting('ce','Pedir correo','',C.askEmail)}</div>`;
  if(cTab==='mensaje')body=`<div class="card"><h2>Mensaje de WhatsApp</h2><p class="hint">El cliente lo envía después de confirmar el pedido. Incluye el número de pedido: compáralo siempre con el panel, porque el cliente puede editar el texto.</p><label class="f">Encabezado</label><textarea id="mh" maxlength="500">${esc(C.msgHeader)}</textarea><label class="f">Cierre</label><textarea id="mf" maxlength="500">${esc(C.msgFooter)}</textarea>
    <div class="card" style="box-shadow:none;margin-top:12px;white-space:pre-line;font-family:monospace;font-size:13px" id="mprev"></div></div>`;
  if(cTab==='promos')body=`<div class="card"><h2>Códigos de descuento</h2><p class="hint">Los códigos son privados: la tienda no los muestra y el servidor los valida al crear el pedido.</p><table><thead><tr><th>Código</th><th>Tipo</th><th>Valor</th><th>Activo</th><th></th></tr></thead><tbody>${C.promos.map((p,i)=>`<tr><td><input type="text" maxlength="40" data-p="${i}" data-k="code" value="${esc(p.code)}"></td><td><select data-p="${i}" data-k="type"><option value="pct" ${p.type==='pct'?'selected':''}>%</option><option value="fix" ${p.type==='fix'?'selected':''}>Monto fijo</option></select></td><td><input type="number" min="0" ${p.type==='pct'?'max="100"':''} data-p="${i}" data-k="value" value="${p.value}"></td><td><input type="checkbox" data-p="${i}" data-k="active" ${p.active?'checked':''}></td><td><button class="btn sm danger" data-pd="${i}" aria-label="Eliminar">✕</button></td></tr>`).join('')}</tbody></table><button class="btn" id="padd" style="margin-top:10px">+ Nueva promoción</button></div>`;
  if(cTab==='legal')body=`<div class="card"><h2>Páginas legales</h2><p class="hint">Si escribes algo, la tienda muestra el enlace al pie de página.</p><label class="f">Términos y condiciones</label><textarea id="lt" style="min-height:140px">${esc(C.legal.terms)}</textarea><label class="f">Política de privacidad</label><textarea id="lp" style="min-height:140px">${esc(C.legal.privacy)}</textarea></div>`;
  if(cTab==='preguntas')body=`<div class="card"><h2>Preguntas al cliente</h2><div class="hint">Se muestran en el checkout si están activadas en General.</div>${C.questions.map((q,i)=>`<div class="row" style="margin:8px 0"><input type="text" maxlength="200" data-q="${i}" value="${esc(q.text)}" style="flex:1"><label class="chk"><input type="checkbox" data-qr="${i}" ${q.required?'checked':''}> Obligatoria</label><button class="btn sm danger" data-qd="${i}" aria-label="Eliminar">✕</button></div>`).join('')}<button class="btn" id="qadd">+ Agregar pregunta</button></div>`;
  V(`<h1>Configuración de checkout</h1><div class="tabs">${T.map(([k,n])=>`<button data-t="${k}" class="${cTab===k?'on':''}">${n}</button>`).join('')}</div>${body}`);
  $$('.tabs button').forEach(b=>b.onclick=()=>{cTab=b.dataset.t;VIEWS.checkout()});
  const R=VIEWS.checkout;
  if(cTab==='general'){$('#ccur').onchange=e=>{S.store.currency=e.target.value;save()};
    [['cpause','paused'],['cqon','questionsOn'],['ctax','taxOn',1],['cdel','delivery',1],['cpick','pickup'],['ctab','table'],['cn','askName'],['cp','askPhone'],['ce','askEmail']].forEach(([i,k,r])=>bindSwitch(i,C,k,r?R:null));
    bindInput('#ctn',C,'taxName');bindInput('#ctp',C,'taxPct',1);bindInput('#cdp',C,'deliveryPrice',1);
    $$('[data-a]').forEach(el=>el.onchange=()=>{C.addr[el.dataset.a][+el.dataset.i]=el.checked;save()})}
  if(cTab==='mensaje'){const pv=()=>$('#mprev').textContent=`${C.msgHeader}\n\nPedido #1001\n1x Decant Dior Sauvage 10ml — ${money(18)}\n\nTotal: ${money(18)}\nTipo: Entrega a domicilio\n\n${C.msgFooter}`;pv();$('#mh').oninput=e=>{C.msgHeader=e.target.value;save();pv()};$('#mf').oninput=e=>{C.msgFooter=e.target.value;save();pv()}}
  if(cTab==='promos'){$('#padd').onclick=()=>{let n=10,code;do{code='PROMO'+n++}while(C.promos.some(p=>p.code.toLowerCase()===code.toLowerCase()));C.promos.push({code,type:'pct',value:10,active:true});save();R()};
    $$('[data-p]').forEach(el=>el.onchange=()=>{const p=C.promos[+el.dataset.p];const v=el.type==='checkbox'?el.checked:el.type==='number'?+el.value:el.value.trim();
      if(el.dataset.k==='code'&&C.promos.some(x=>x!==p&&x.code.toLowerCase()===String(v).toLowerCase())){toast('Ese código ya existe');el.value=p.code;return}
      p[el.dataset.k]=v;save();if(el.dataset.k==='type')R()});
    $$('[data-pd]').forEach(el=>el.onclick=()=>{C.promos.splice(+el.dataset.pd,1);save();R()})}
  if(cTab==='legal'){$('#lt').oninput=e=>{C.legal.terms=e.target.value;save()};$('#lp').oninput=e=>{C.legal.privacy=e.target.value;save()}}
  if(cTab==='preguntas'){$('#qadd').onclick=()=>{C.questions.push({text:'',required:false});save();R()};$$('[data-q]').forEach(el=>el.oninput=()=>{C.questions[+el.dataset.q].text=el.value;save()});$$('[data-qr]').forEach(el=>el.onchange=()=>{C.questions[+el.dataset.qr].required=el.checked;save()});$$('[data-qd]').forEach(el=>el.onclick=()=>{C.questions.splice(+el.dataset.qd,1);save();R()})}
};

/* --- estudio: posts para redes --- */
let stu={kind:'product',pid:null,style:'brand',fmt:'square',headline:'',ids:[]};
VIEWS.estudio=()=>{
  if(!S.products.some(p=>p.id===stu.pid))stu.pid=S.products[0]?.id;
  stu.ids=stu.ids.filter(id=>S.products.some(p=>p.id===id));
  V(`<h1>Estudio</h1><p class="hint" style="margin-top:-10px">Crea posts listos para WhatsApp, Instagram y tus estados a partir de tus productos.</p>
  <div class="studio-grid"><div class="card">
    <label class="f">¿Qué quieres crear?</label><select id="sk"><option value="product">Post de producto</option><option value="banner">Anuncio / Banner</option><option value="combo">Combo (2–3 productos)</option><option value="top">Recomendación (más vendido)</option></select>
    <div id="skp"></div>
    <label class="f">Texto principal</label><input type="text" id="sh" value="${esc(stu.headline)}" placeholder="Ej. ¡Nuevo ingreso!">
    <label class="f">Estilo</label><div class="seg">${[['brand','Marca'],['light','Claro'],['dark','Oscuro']].map(([k,n])=>`<button data-s="${k}" class="${stu.style===k?'on':''}">${n}</button>`).join('')}</div>
    <label class="f">Formato</label><div class="seg">${[['square','Post 1:1'],['story','Estado 9:16']].map(([k,n])=>`<button data-fm="${k}" class="${stu.fmt===k?'on':''}">${n}</button>`).join('')}</div>
    <div class="row" style="margin-top:16px"><button class="btn primary" id="sdl">Descargar PNG</button><button class="btn" id="ssave">Guardar en mis creaciones</button></div>
  </div><div><canvas id="post"></canvas>
  <h2 style="margin-top:20px">Mis creaciones</h2><div class="row">${prefs.studio.map((s,i)=>`<div style="position:relative"><img src="${esc(safeImg(s))}" alt="Creación" style="width:110px;border-radius:8px"><button class="btn sm" aria-label="Eliminar creación" data-sd="${i}" style="position:absolute;top:4px;right:4px;padding:0 6px">✕</button></div>`).join('')||'<span class="hint">Aún no guardaste posts.</span>'}</div></div></div>`);
  $('#sk').value=stu.kind;
  const prodSel=(multi)=>`<label class="f">${multi?'Productos (Ctrl/⌘ para varios)':'Producto'}</label><select id="sp" ${multi?'multiple size="5"':''}>${S.products.map(p=>`<option value="${p.id}" ${(multi?stu.ids.includes(p.id):p.id===stu.pid)?'selected':''}>${esc(p.title)}</option>`).join('')}</select>`;
  $('#skp').innerHTML=stu.kind==='product'?prodSel(false):stu.kind==='combo'?prodSel(true)+`<label class="f">Precio del combo</label><input type="number" id="scp" value="${stu.comboPrice||''}">`:'';
  $('#sk').onchange=e=>{stu.kind=e.target.value;VIEWS.estudio()};
  $('#sp')&&($('#sp').onchange=e=>{if(stu.kind==='combo')stu.ids=[...e.target.selectedOptions].map(o=>o.value).slice(0,3);else stu.pid=e.target.value;drawPost()});
  $('#scp')&&($('#scp').oninput=e=>{stu.comboPrice=e.target.value;drawPost()});
  $('#sh').oninput=e=>{stu.headline=e.target.value;drawPost()};
  $$('[data-s]').forEach(b=>b.onclick=()=>{stu.style=b.dataset.s;VIEWS.estudio()});
  $$('[data-fm]').forEach(b=>b.onclick=()=>{stu.fmt=b.dataset.fm;VIEWS.estudio()});
  $('#sdl').onclick=()=>{const a=document.createElement('a');a.href=$('#post').toDataURL('image/png');a.download='post.png';a.click()};
  $('#ssave').onclick=()=>{const c=$('#post'),t=document.createElement('canvas');t.width=270;t.height=c.height*270/c.width;t.getContext('2d').drawImage(c,0,0,t.width,t.height);prefs.studio.unshift(t.toDataURL('image/jpeg',.8));prefs.studio=prefs.studio.slice(0,12);savePrefs();VIEWS.estudio();toast('Guardado')};
  $$('[data-sd]').forEach(b=>b.onclick=()=>{prefs.studio.splice(+b.dataset.sd,1);savePrefs();VIEWS.estudio()});
  drawPost();
};
async function drawPost(){
  const c=$('#post');if(!c)return;const W=1080,H=stu.fmt==='story'?1920:1080;c.width=W;c.height=H;const g=c.getContext('2d');const D=S.design;
  const pal={brand:[D.secondary,D.primary,D.text],light:['#ffffff',D.primary,'#1d1d1f'],dark:['#111418',D.primary,'#f4f4f4']}[stu.style];
  const font=`'${D.font}', sans-serif`;await document.fonts.load(`700 40px ${font}`).catch(()=>{});
  g.fillStyle=pal[0];g.fillRect(0,0,W,H);g.fillStyle=pal[1];g.globalAlpha=.12;g.beginPath();g.arc(W*.85,H*.12,W*.35,0,7);g.fill();g.beginPath();g.arc(W*.1,H*.9,W*.3,0,7);g.fill();g.globalAlpha=1;
  const loadImg=src=>new Promise(r=>{if(!src)return r(null);const i=new Image();i.crossOrigin='anonymous';i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src});
  const wrap=(t,x,y,mw,lh,max=3)=>{const w=String(t).split(' ');let l='',n=0;for(const s of w){const tt=l?l+' '+s:s;if(g.measureText(tt).width>mw&&l){g.fillText(l,x,y);y+=lh;l=s;if(++n>=max-1){break}}else l=tt}g.fillText(l,x,y);return y};
  const cover=(im,x,y,w,h,r=40)=>{g.save();g.beginPath();g.roundRect(x,y,w,h,r);g.clip();if(im){const k=Math.max(w/im.width,h/im.height);g.drawImage(im,x+(w-im.width*k)/2,y+(h-im.height*k)/2,im.width*k,im.height*k)}else{g.fillStyle=pal[1]+'22';g.fillRect(x,y,w,h);g.fillStyle=pal[1];g.font=`200px ${font}`;g.textAlign='center';g.fillText('🏷',x+w/2,y+h/2+70)}g.restore()};
  g.textAlign='left';g.fillStyle=pal[2];g.font=`700 44px ${font}`;g.fillText(S.store.name,70,110);
  const top=Object.entries(S.orders.flatMap(o=>o.items).reduce((m,i)=>(m[i.title]=(m[i.title]||0)+i.q,m),{})).sort((a,b)=>b[1]-a[1])[0];
  let ps=stu.kind==='combo'?S.products.filter(p=>stu.ids.includes(p.id)):stu.kind==='top'?[S.products.find(p=>p.title===top?.[0])||S.products[0]]:stu.kind==='product'?[S.products.find(p=>p.id===stu.pid)]:[];
  ps=ps.filter(Boolean);
  const imgTop=170,imgH=stu.fmt==='story'?1050:560;
  if(stu.kind==='banner'){g.fillStyle=pal[1];g.font=`700 110px ${font}`;g.textAlign='center';wrap(stu.headline||'¡Gran promoción!',W/2,H/2-60,W-160,120,4);g.fillStyle=pal[2];g.font=`400 46px ${font}`;g.fillText(storeUrl().replace('https://',''),W/2,H-120);return}
  if(ps.length===1){cover(await loadImg(ps[0].img),70,imgTop,W-140,imgH)}
  else if(ps.length>1){const w=(W-140-(ps.length-1)*24)/ps.length;for(let i=0;i<ps.length;i++)cover(await loadImg(ps[i].img),70+i*(w+24),imgTop,w,imgH,30)}
  let y=imgTop+imgH+90;g.textAlign='left';
  if(stu.headline||stu.kind==='top'){g.fillStyle=pal[1];g.font=`700 40px ${font}`;g.fillText((stu.headline||'🔥 El más pedido').toUpperCase(),70,y);y+=70}
  g.fillStyle=pal[2];g.font=`700 64px ${font}`;y=wrap(ps.map(p=>p.title).join(' + ')||'Elige un producto',70,y,W-140,74,2)+90;
  const pr=stu.kind==='combo'?(stu.comboPrice||ps.reduce((a,p)=>a+(+p.price||0),0)):ps[0]?(ps[0].offer!==''&&ps[0].offer!=null?ps[0].offer:ps[0].price):'';
  if(pr!==''){g.fillStyle=pal[1];g.beginPath();g.roundRect(70,y-70,g.measureText(money(pr)).width+120,100,50);g.fill();g.fillStyle='#fff';g.font=`700 60px ${font}`;g.fillText(money(pr),110,y)}
  g.fillStyle=pal[2];g.font=`400 36px ${font}`;g.textAlign='right';g.fillText('Pide por WhatsApp →',W-70,H-70);
}

/* --- avanzado --- */
let aTab='acceso';
VIEWS.avanzado=()=>{
  const T=[['acceso','Acceso'],['dominio','Dominio'],['gestion','Respaldo']];
  let b='';
  if(aTab==='acceso')b=`<div class="card"><h2>Tu sesión</h2><p>Conectado como <b>${esc(USER&&USER.email)}</b>.</p><button class="btn" data-act="logout">Cerrar sesión</button></div>
    <div class="card"><h2>Dar acceso a otra persona</h2><p class="hint">Por seguridad, los administradores se agregan desde Supabase: crea el usuario en <b>Authentication → Users</b> y agrega su id a la tabla <code>admins</code>. Este panel no puede darse permisos a sí mismo.</p></div>`;
  if(aTab==='dominio')b=`<div class="card"><h2>Dominio personalizado</h2><p class="hint">La tienda vive en <code>${esc(storeUrl())}</code>. Para usar tu propio dominio, configúralo en GitHub → Settings → Pages → Custom domain y crea en tu proveedor un registro <b>CNAME</b> de <code>www</code> hacia <code>${esc(location.hostname)}</code>.</p></div>`;
  if(aTab==='gestion')b=`<div class="card"><h2>Respaldo</h2><p class="hint">Descarga una copia de productos, categorías, configuración y pedidos (incluye datos personales de clientes: guárdala en un lugar seguro).</p><button class="btn" data-act="backup">Descargar respaldo (.json)</button></div>`;
  V(`<h1>Configuración avanzada</h1><div class="tabs">${T.map(([k,n])=>`<button data-t="${k}" class="${aTab===k?'on':''}">${n}</button>`).join('')}</div>${b}`);
  $$('.tabs button').forEach(x=>x.onclick=()=>{aTab=x.dataset.t;VIEWS.avanzado()});
};
function openBackup(){download('flowymarket-respaldo-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({config:configRow(),categories:S.categories,products:S.products,promos:S.checkout.promos,orders:S.orders},null,1),'application/json')}
function beep(){try{const a=new AudioContext(),o=a.createOscillator(),g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=880;g.gain.value=.1;o.start();o.stop(a.currentTime+.25)}catch(e){}}
function openStore(){window.open(storeUrl(),'_blank','noopener')}

/* acciones declarativas (sin onclick en línea, compatible con la CSP) */
document.addEventListener('click',e=>{const t=e.target.closest('[data-act]');if(!t||t.closest('#app')===null&&t.closest('#modal')===null&&t.closest('.banner')===null&&t.closest('.side')===null)return;
  const a=t.dataset.act;
  if(a==='close-modal')closeModal();else if(a==='open-store')openStore();else if(a==='go')go(t.dataset.k);
  else if(a==='backup')openBackup();else if(a==='beep')beep();else if(a==='logout')logout();else if(a==='menu')$('.side').classList.toggle('open');else return;
  e.preventDefault()});

/* ---------- tiempo real: pedidos nuevos y cambios de stock ---------- */
async function reloadOrders(){const {data,error}=await sb.from('orders').select('*').order('created_at',{ascending:false}).limit(2000);if(error)return;
  S.orders=data.map(cleanOrder);synced.orders=snapshot().orders;if(['pedidos','clientes','estadisticas'].includes(cur))VIEWS[cur]()}
let channel=null;
function subscribe(){
  channel=sb.channel('panel')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'orders'},async p=>{await reloadOrders();if(prefs.sound)beep();toast('Nuevo pedido #'+(p.new&&p.new.num||''))})
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'orders'},()=>reloadOrders())
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'products'},p=>{
      // el stock cambia en el servidor al entrar un pedido: actualizarlo sin pisar ediciones locales pendientes
      const row=p.new&&cleanProduct(p.new);const local=row&&S.products.find(x=>x.id===row.id);if(!local)return;
      const i=S.products.indexOf(local);const before=JSON.stringify(prodRow(local,i));
      if(synced.prods.get(row.id)===before&&local.stock!==row.stock){local.stock=row.stock;synced.prods.set(row.id,JSON.stringify(prodRow(local,i)));if(cur==='productos'&&sub.edit===undefined)VIEWS.productos()}})
    .subscribe()}

/* ---------- sesión ---------- */
function showLogin(msg){
  $('#app').hidden=true;$('#login').hidden=false;$('#loginMsg').textContent=msg||'';
}
async function enter(session){
  USER=session.user;
  const {data:adm,error}=await sb.from('admins').select('user_id').eq('user_id',USER.id).maybeSingle();
  if(error||!adm){await sb.auth.signOut();showLogin('Esta cuenta no tiene permisos de administrador.');return}
  $('#login').hidden=true;$('#app').hidden=false;
  try{
    S=fromRows(await fetchAll());
    if(!S.exists){S=firstRunState();synced=emptySynced();await sync();await reloadAll();toast('Tienda creada con el catálogo inicial')}
    else synced=snapshot();
  }catch(e){$('#view').innerHTML='<div class="card">No se pudieron cargar los datos: '+esc(e.message||e)+'</div>';return}
  cur=VIEWS[prefs.view]?prefs.view:'productos';go(cur);subscribe();
}
async function logout(){if(channel)sb.removeChannel(channel);await sb.auth.signOut();location.reload()}
$('#loginForm').onsubmit=async e=>{e.preventDefault();const btn=$('#loginBtn');btn.disabled=true;$('#loginMsg').textContent='';
  const {data,error}=await sb.auth.signInWithPassword({email:$('#lemail').value.trim(),password:$('#lpass').value});
  btn.disabled=false;$('#lpass').value='';
  if(error){$('#loginMsg').textContent='Correo o contraseña incorrectos, o demasiados intentos. Espera un momento.';return}
  enter(data.session)};
$('#forgot').onclick=async e=>{e.preventDefault();const email=$('#lemail').value.trim();if(!email){$('#loginMsg').textContent='Escribe tu correo primero.';return}
  await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  $('#loginMsg').textContent='Si el correo existe, te llegará un enlace para cambiar la contraseña.'};
$('#newPassForm').onsubmit=async e=>{e.preventDefault();const p=$('#npass').value;if(p.length<10){$('#newPassMsg').textContent='Usa al menos 10 caracteres.';return}
  const {error}=await sb.auth.updateUser({password:p});$('#npass').value='';
  $('#newPassMsg').textContent=error?'No se pudo cambiar: '+error.message:'Contraseña actualizada. Ya puedes entrar.';if(!error)setTimeout(()=>location.replace(location.pathname),1500)};
sb.auth.onAuthStateChange((ev,session)=>{if(ev==='PASSWORD_RECOVERY'){$('#login').hidden=true;$('#app').hidden=true;$('#newPass').hidden=false}});

/* tema */
$('#themeBtn').onclick=()=>{const r=document.documentElement,d=r.dataset.theme==='dark'||(!r.dataset.theme&&matchMedia('(prefers-color-scheme: dark)').matches);r.dataset.theme=d?'light':'dark';prefs.theme=r.dataset.theme;savePrefs()};
if(prefs.theme)document.documentElement.dataset.theme=prefs.theme;
(async()=>{const {data}=await sb.auth.getSession();if(location.hash.includes('type=recovery'))return;if(data.session)enter(data.session);else showLogin()})();
