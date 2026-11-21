/* FlowyMarket · código compartido por la tienda (index.html) y el panel (admin.html).
   Todo lo que se pinta pasa por estos validadores: los datos vienen de la base de datos,
   pero se tratan como no confiables al convertirlos en HTML. */
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10);
/* validadores: todo dato que entra (localStorage, respaldo, CSV, pedidos) pasa por aquí */
const str=(v,max=2000)=>typeof v==='string'?v.slice(0,max):(typeof v==='number'?String(v):'');
const num=(v,min,max,d=0)=>{v=+v;return Number.isFinite(v)?Math.min(max,Math.max(min,v)):d};
const oneOf=(v,list,d)=>list.includes(v)?v:d;
const idOk=v=>typeof v==='string'&&/^[a-z0-9]{1,24}$/i.test(v)?v:'';
const digits=v=>str(v,40).replace(/\D/g,'').slice(0,15);
const safeColor=(v,d='')=>typeof v==='string'&&/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)?v:d;
const STORAGE_PREFIX=(window.FM_CONFIG&&FM_CONFIG.url||'').replace(/\/$/,'')+'/storage/v1/object/public/product-images/';
/* imágenes permitidas: las del bucket del proyecto o data: de mapa de bits */
const safeImg=v=>typeof v==='string'&&(
  (v.length<3e6&&/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(v))||
  (STORAGE_PREFIX.startsWith('https://')&&v.startsWith(STORAGE_PREFIX)&&/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,120}\.(jpg|jpeg|png|webp)$/.test(v.slice(STORAGE_PREFIX.length))))?v:'';
function safeUrl(v){v=str(v,2000).trim();if(!v)return '';if(/^#[\w-]*$/.test(v))return v;
  try{const u=new URL(v);return ['http:','https:','mailto:','tel:'].includes(u.protocol)?u.href:''}catch(e){return ''}}
const arr=(v,max=500)=>Array.isArray(v)?v.slice(0,max):[];
const fmtMoney=(n,c)=>new Intl.NumberFormat('es-MX',{style:'currency',currency:oneOf(c,CURRENCIES,'USD'),currencyDisplay:'narrowSymbol'}).format(+n||0);
const round2=n=>Math.round((+n||0)*100)/100;
const unitPrice=p=>p.offer!==''&&p.offer!=null?+p.offer:+p.price;

const PALETTES={Modern:['#2f80ed','#f5f8ff','#1c2733'],Elegant:['#8a6d3b','#faf7f2','#2b2420'],Minimal:['#111111','#ffffff','#222222'],Sakura:['#e0457b','#fdeef3','#5a2236'],Matcha:['#5b8a4a','#f2f6ee','#24331f'],Milano:['#b23a3a','#fbf3f0','#3a1f1f'],Santorini:['#1f5fa8','#eef5fc','#13283f'],Brooklyn:['#e2683c','#f7f3ef','#2a2a2a'],Coastal:['#1b8a8f','#eef8f8','#16393b'],Nordic:['#4a6375','#f2f4f6','#1f2a33'],Luxe:['#b8955a','#121212','#f1e9db'],'Tech Noir':['#22d3ee','#0b0f14','#e6f6fa'],'Dark Elegance':['#c9a96e','#16131a','#ece4f2'],'Midnight Blue':['#5b8cff','#0d1530','#e4ebff']};
const FONTS=['Inter','Poppins','Montserrat','DM Sans','Playfair Display','Cinzel','Georgia','Arial'];
const STATUSES=['Recibido','En Preparación','Listo','Entregado','Cancelado'];
const CURRENCIES=['USD','MXN','ARS','CLP','COP','PEN','EUR'];

/* tipos de bloque: nombre, descripción, valores por defecto y campos editables */
const BLOCKS={
  hero:{n:'Sección de Presentación',d:'Título, subtítulo, fondo y botón de acción',def:{title:'Mi tienda',subtitle:'',align:'center',color:'#ffffff',bg:'',overlay:40,cta:'',ctaUrl:'',size:'medium',full:false},
    f:[['title','Título','textarea'],['subtitle','Subtítulo','textarea'],['align','Alineación del texto','select',['left','center','right']],['color','Color del texto','color'],['bg','Imagen de fondo','image'],['overlay','Opacidad de superposición (%)','range'],['cta','Texto del botón','text'],['ctaUrl','URL del botón','url'],['size','Tamaño','select',['small','medium','large']],['full','Altura completa','bool']]},
  catalog:{n:'Catálogo de Productos',d:'Lista o cuadrícula con búsqueda y categorías',def:{layout:'list',search:true,sortFilter:true,showTitle:true,showPrice:true,showDesc:true,cartBtn:true,cats:''},
    f:[['layout','Estilo de plantilla','select',['list','grid','glass','classic']],['cats','Filtrar por categorías (separadas por coma, vacío = todas)','text'],['search','Mostrar barra de búsqueda','bool'],['sortFilter','Mostrar ordenar y filtrar','bool'],['showTitle','Mostrar título','bool'],['showPrice','Mostrar precio','bool'],['showDesc','Mostrar descripción','bool'],['cartBtn','Habilitar botón de carrito','bool']]},
  carousel:{n:'Carrusel de Productos',d:'Productos destacados desplazables',def:{title:'Destacados',ids:''},f:[['title','Título','text'],['ids','Etiqueta o categoría a mostrar (vacío = todos)','text']]},
  text:{n:'Texto',d:'Párrafo con título',def:{heading:'Sobre nosotros',body:'Escribe aquí tu texto.',align:'left'},f:[['heading','Título','text'],['body','Contenido','textarea'],['align','Alineación','select',['left','center','right']]]},
  image:{n:'Imagen',d:'Imagen con leyenda y enlace',def:{src:'',caption:'',link:''},f:[['src','Imagen','image'],['caption','Leyenda','text'],['link','Enlace','url']]},
  banner:{n:'Banner de Promociones',d:'Oferta destacada',def:{title:'2x1 en decants',text:'Solo este fin de semana',bg:'',cta:'Ver ofertas'},f:[['title','Título','text'],['text','Texto','text'],['cta','Texto del botón','text'],['bg','Color de fondo (vacío = primario)','color']]},
  bio:{n:'Biografía',d:'Perfil con imagen y descripción',def:{img:'',name:'Nuestro equipo',text:'Contamos quiénes somos.'},f:[['img','Imagen','image'],['name','Nombre','text'],['text','Descripción','textarea']]},
  youtube:{n:'YouTube',d:'Video incrustado',def:{url:''},f:[['url','URL del video','url']]},
  map:{n:'Mapa',d:'Ubicación con Google Maps',def:{address:'Ciudad de México'},f:[['address','Dirección','text']]},
  social:{n:'Iconos de Redes Sociales',d:'Enlaces a tus redes',def:{instagram:'',tiktok:'',facebook:'',whatsapp:''},f:[['instagram','Instagram (usuario)','text'],['tiktok','TikTok (usuario)','text'],['facebook','Facebook (URL)','url'],['whatsapp','WhatsApp (número)','text']]},
  links:{n:'Botones de Enlace',d:'Botones con enlaces personalizados',def:{items:'Instagram|https://instagram.com\nCatálogo PDF|https://'},f:[['items','Un botón por línea: Texto|URL','textarea']]},
  testimonials:{n:'Testimonios',d:'Reseñas de clientes',def:{items:'Ana|Llegó rapidísimo y huele increíble.|5\nLuis|Excelente atención por WhatsApp.|5'},f:[['items','Uno por línea: Nombre|Reseña|Estrellas','textarea']]},
  faq:{n:'Preguntas Frecuentes',d:'Preguntas con respuestas desplegables',def:{items:'¿Hacen envíos?|Sí, a todo el país.\n¿Los perfumes son originales?|Sí, 100% originales.'},f:[['items','Una por línea: Pregunta|Respuesta','textarea']]},
  gallery:{n:'Galería',d:'Imágenes en cuadrícula',def:{imgs:[]},f:[['imgs','Imágenes','images']]},
  hours:{n:'Horario',d:'Horario de atención',def:{items:'Lunes a viernes|10:00 – 20:00\nSábado|10:00 – 15:00\nDomingo|Cerrado'},f:[['items','Uno por línea: Día|Horario','textarea']]},
  stats:{n:'Estadísticas',d:'Cifras destacadas',def:{items:'+500|clientes\n24h|envíos\n100%|originales'},f:[['items','Una por línea: Cifra|Etiqueta','textarea']]},
  spacer:{n:'Espaciador',d:'Espacio o separador',def:{h:32,line:false},f:[['h','Altura (px)','number'],['line','Mostrar línea','bool']]},
  footer:{n:'Pie de Página',d:'Contacto y enlaces',def:{text:'© FlowyMarket',email:'',phone:''},f:[['text','Texto','text'],['email','Correo','email'],['phone','Teléfono','text']]},
  cartbtn:{n:'Botón de Carrito',d:'Botón flotante del carrito',def:{pos:'right'},f:[['pos','Posición','select',['right','left']]]},
  floating:{n:'Botón Flotante',d:'Contacto rápido por WhatsApp',def:{phone:'',msg:'Hola, quiero hacer un pedido'},f:[['phone','Número de WhatsApp','text'],['msg','Mensaje inicial','text']]},
  popup:{n:'Ventana Emergente',d:'Aviso al cargar la página',def:{title:'¡Bienvenido!',text:'10% de descuento en tu primer pedido',delay:2},f:[['title','Título','text'],['text','Texto','textarea'],['delay','Mostrar tras (segundos)','number']]}
};


/* valores por defecto de la configuración pública */
const DEFAULTS={
  store:{name:'Mi tienda',slug:'mi-tienda',whatsapp:'',currency:'USD',logo:'',seoTitle:'',seoDesc:'',qrColor:'#0e8aa8'},
  design:{palette:'Sakura',primary:'#e0457b',secondary:'#fdeef3',text:'#5a2236',font:'Poppins',corners:'round',blocks:[]},
  checkout:{paused:false,address:'',addr:{line1:[true,true],line2:[true,false],city:[true,true],state:[false,false],zip:[false,false]},
    taxOn:false,taxName:'IVA',taxPct:16,delivery:true,deliveryPrice:5,pickup:true,table:false,askName:true,askPhone:true,askEmail:false,
    questionsOn:false,questions:[],msgHeader:'¡Hola! Quiero hacer este pedido:',msgFooter:'¡Gracias!',legal:{terms:'',privacy:''}},
  payments:{cash:true,transfer:false,custom:false,transferInfo:'',customName:'',customInfo:''}
};
function typed(def,raw){raw=raw&&typeof raw==='object'?raw:{};const o={};
  for(const k in def){const d=def[k],v=raw[k];
    o[k]=typeof d==='boolean'?(v===undefined?d:!!v):typeof d==='number'?num(v,-1e9,1e9,d):typeof d==='string'?(v===undefined?d:str(v)):d}
  return o}
function cleanProps(type,raw){const def=BLOCKS[type];raw=raw&&typeof raw==='object'?raw:{};const o={};
  def.f.forEach(([k,,t,opts])=>{const v=raw[k]??def.def[k];
    o[k]=t==='bool'?!!v:t==='select'?oneOf(v,opts,def.def[k]):t==='color'?safeColor(v,''):t==='number'?num(v,0,2000,def.def[k]):t==='range'?num(v,0,90,def.def[k])
      :t==='image'?safeImg(v):t==='images'?arr(v,24).map(safeImg).filter(Boolean):str(v,5000)});
  return o}
/* fila de shop_config → objeto validado */
function cleanConfig(row){row=row||{};const D=DEFAULTS;
  const store=typed(D.store,row.store);store.slug=store.slug.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,60)||'mi-tienda';
  store.whatsapp=digits(store.whatsapp);store.currency=oneOf(store.currency,CURRENCIES,'USD');store.logo=safeImg(store.logo);store.qrColor=safeColor(store.qrColor,'#0e8aa8');
  const rd=row.design||{};
  const design={palette:str(rd.palette,40),primary:safeColor(rd.primary,D.design.primary),secondary:safeColor(rd.secondary,D.design.secondary),text:safeColor(rd.text,D.design.text),
    font:oneOf(rd.font,FONTS,'Inter'),corners:oneOf(rd.corners,['square','semi','round'],'round'),
    blocks:arr(rd.blocks,60).filter(b=>b&&Object.prototype.hasOwnProperty.call(BLOCKS,b.type)).map(b=>({id:idOk(b.id)||uid(),type:b.type,props:cleanProps(b.type,b.props)}))};
  const rc=row.checkout||{};const checkout=typed(D.checkout,rc);
  checkout.taxPct=num(checkout.taxPct,0,100,0);checkout.deliveryPrice=num(checkout.deliveryPrice,0,1e6,0);
  checkout.addr={};for(const k in D.checkout.addr){const a=(rc.addr||{})[k];checkout.addr[k]=Array.isArray(a)?[!!a[0],!!a[1]]:D.checkout.addr[k]}
  checkout.questions=arr(rc.questions,30).map(q=>({text:str(q&&q.text,200),required:!!(q&&q.required)}));
  checkout.legal={terms:str((rc.legal||{}).terms,50000),privacy:str((rc.legal||{}).privacy,50000)};
  const payments=typed(D.payments,row.payments);
  return {store,design,checkout,payments}}
/* fila de products → objeto validado (nombres de columnas de la base) */
function cleanProduct(p){p=p&&typeof p==='object'?p:{};
  return {id:idOk(p.id)||uid(),title:str(p.title,200),desc:str(p.desc??p.description,3000),price:round2(num(p.price,0,1e9,0)),offer:p.offer===''||p.offer==null?'':round2(num(p.offer,0,1e9,0)),
    cat:idOk(p.cat??p.category_id),tags:arr(p.tags,30).map(t=>str(t,40)).filter(Boolean),hidden:!!p.hidden,stock:Math.round(num(p.stock,0,99999,99999)),cart:p.cart!==false,
    img:safeImg(p.img),imgs:arr(p.imgs,10).map(safeImg).filter(Boolean),
    options:arr(p.options,20).map(o=>({title:str(o&&o.title,120),required:!!(o&&o.required),multi:!!(o&&o.multi),
      items:arr(o&&o.items,50).map(it=>({title:str(it&&it.title,120),price:round2(num(it&&it.price,0,1e9,0)),available:!(it&&it.available===false)}))}))}}
const cleanCategory=c=>({id:idOk(c&&c.id)||uid(),name:str(c&&c.name,80),parent:idOk(c&&c.parent)});

/* errores de place_order → mensajes para el cliente */
const ORDER_ERRORS={pedido_invalido:'El pedido no es válido.',demasiados_pedidos:'Demasiados pedidos seguidos. Intenta en unos minutos.',tienda_pausada:'La tienda no está tomando pedidos en este momento.',
  pedido_vacio:'El carrito está vacío.',producto_no_disponible:'Un producto ya no está disponible.',cantidad_invalida:'Cantidad inválida.',opciones_invalidas:'Opciones inválidas.',
  opcion_no_disponible:'Una opción elegida ya no está disponible.',falta_opcion_obligatoria:'Falta elegir una opción obligatoria.',sin_stock:'No hay stock suficiente para tu pedido.',
  tipo_invalido:'Elige un tipo de pedido válido.',pago_invalido:'Elige un método de pago válido.',codigo_invalido:'El código de descuento no es válido.',
  falta_nombre:'Escribe tu nombre.',falta_telefono:'Escribe un teléfono válido.',falta_email:'Escribe un correo válido.',falta_direccion:'Completa la dirección.',falta_respuesta:'Responde las preguntas obligatorias.'};
const orderError=e=>{const m=String(e&&e.message||'');const k=Object.keys(ORDER_ERRORS).find(k=>m.includes(k));return k?ORDER_ERRORS[k]:'No se pudo crear el pedido. Intenta de nuevo.'};

/* render de la tienda: devuelve {css, html} con todo escapado */
function renderStore(data){
  const cfg=data.config,D=cfg.design,st=cfg.store;
  const money=n=>fmtMoney(n,st.currency);
  const cats=data.categories||[];
  const catName=id=>(cats.find(c=>c.id===id)||{}).name||'';
  const rad={square:'2px',semi:'8px',round:'16px'}[D.corners]||'16px';
  const P=safeColor(D.primary,'#e0457b'),SC=safeColor(D.secondary,'#ffffff'),TX=safeColor(D.text,'#222222'),FONT=oneOf(D.font,FONTS,'Inter');
  const align=v=>oneOf(v,['left','center','right'],'left');
  const vis=(data.products||[]).filter(p=>!p.hidden);
  const lines=s=>String(s||'').split('\n').map(l=>l.split('|').map(x=>x.trim())).filter(l=>l[0]);
  const price=p=>p.offer!==''&&p.offer!=null?`<s style="opacity:.55">${money(p.price)}</s> ${money(p.offer)}`:money(p.price);
  const card=(p,c)=>`<div class="pc l-${oneOf(c.layout,['list','grid','glass','classic'],'list')}" data-id="${esc(p.id)}" data-cat="${esc(p.cat)}" data-t="${esc((p.title+' '+p.tags.join(' ')).toLowerCase())}" data-p="${+unitPrice(p)||0}">
    <div class="im">${p.img?`<img src="${esc(safeImg(p.img))}" alt="${esc(p.title)}" loading="lazy">`:'<span>🏷</span>'}</div><div class="tx">${c.showTitle?`<b>${esc(p.title)}</b>`:''}${c.showDesc?`<p>${esc(p.desc)}</p>`:''}${c.showPrice?`<div class="pr">${price(p)}</div>`:''}${p.stock<=0?'<div class="out">Agotado</div>':''}</div>
    ${c.cartBtn&&p.cart&&p.stock>0?`<button class="add" data-add="${esc(p.id)}" aria-label="Agregar ${esc(p.title)}">＋</button>`:''}</div>`;
  const R={
    hero:x=>{const ov=num(x.overlay,0,90,40)/100,bg=safeImg(x.bg);return `<section class="hero ${oneOf(x.size,['small','medium','large'],'medium')} ${x.full?'full':''}" style="text-align:${align(x.align)};color:${safeColor(x.color,'#ffffff')};${bg?`background-image:linear-gradient(rgba(0,0,0,${ov}),rgba(0,0,0,${ov})),url(&quot;${bg}&quot;)`:`background:${P}`}">
      <h1>${esc(x.title)}</h1>${x.subtitle?`<p>${esc(x.subtitle)}</p>`:''}${x.cta?`<a class="cta" href="${esc(safeUrl(x.ctaUrl)||'#catalogo')}">${esc(x.cta)}</a>`:''}</section>`},
    catalog:x=>{const allow=x.cats?x.cats.split(',').map(s=>s.trim().toLowerCase()):null;const ps=vis.filter(p=>!allow||allow.includes(catName(p.cat).toLowerCase()));
      const cs=data.categories.filter(c=>ps.some(p=>p.cat===c.id));
      return `<section id="catalogo" class="cat"><div class="bar">${x.search?'<input class="srch" placeholder="Buscar…">':''}<div class="cats"><button class="cb on" data-c="">Todo</button>${cs.map(c=>`<button class="cb" data-c="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div></div>
      ${x.sortFilter?'<div class="sort"><select class="ord"><option value="">Ordenar</option><option value="asc">Precio: menor a mayor</option><option value="desc">Precio: mayor a menor</option><option value="az">A–Z</option></select></div>':''}
      <div class="list ${oneOf(x.layout,['list','grid','glass','classic'],'list')}">${ps.map(p=>card(p,x)).join('')||'<p style="text-align:center;opacity:.6">Sin productos</p>'}</div></section>`},
    carousel:x=>{const f=(x.ids||'').toLowerCase();const ps=vis.filter(p=>!f||p.tags.map(t=>t.toLowerCase()).includes(f)||catName(p.cat).toLowerCase()===f);
      return `<section class="pad"><h2>${esc(x.title)}</h2><div class="car">${ps.map(p=>card(p,{layout:'grid',showTitle:1,showPrice:1,cartBtn:1})).join('')}</div></section>`},
    text:x=>`<section class="pad" style="text-align:${align(x.align)}"><h2>${esc(x.heading)}</h2><p style="white-space:pre-line">${esc(x.body)}</p></section>`,
    image:x=>safeImg(x.src)?`<section class="pad"><a ${safeUrl(x.link)?`href="${esc(safeUrl(x.link))}" target="_blank" rel="noopener noreferrer"`:''}><img src="${esc(safeImg(x.src))}" alt="${esc(x.caption)}" loading="lazy" style="width:100%;border-radius:${rad}"></a>${x.caption?`<p style="text-align:center;opacity:.7">${esc(x.caption)}</p>`:''}</section>`:'',
    banner:x=>`<section class="pad"><div class="ban" style="background:${safeColor(x.bg,P)}"><b>${esc(x.title)}</b><span>${esc(x.text)}</span>${x.cta?`<a href="#catalogo">${esc(x.cta)}</a>`:''}</div></section>`,
    bio:x=>`<section class="pad" style="text-align:center">${safeImg(x.img)?`<img src="${esc(safeImg(x.img))}" alt="${esc(x.name)}" style="width:110px;height:110px;border-radius:50%;object-fit:cover">`:''}<h2>${esc(x.name)}</h2><p>${esc(x.text)}</p></section>`,
    youtube:x=>{const m=(x.url||'').match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);return m?`<section class="pad"><iframe title="Video" style="width:100%;aspect-ratio:16/9;border:0;border-radius:${rad}" src="https://www.youtube-nocookie.com/embed/${m[1]}" loading="lazy" allowfullscreen></iframe></section>`:''},
    map:x=>`<section class="pad"><iframe title="Mapa" style="width:100%;height:240px;border:0;border-radius:${rad}" loading="lazy" src="https://maps.google.com/maps?q=${encodeURIComponent(str(x.address,200))}&amp;output=embed"></iframe></section>`,
    social:x=>`<section class="pad soc">${x.instagram?`<a href="https://instagram.com/${encodeURIComponent(str(x.instagram,60).replace(/^@/,''))}" target="_blank" rel="noopener noreferrer">Instagram</a>`:''}${x.tiktok?`<a href="https://tiktok.com/@${encodeURIComponent(str(x.tiktok,60).replace(/^@/,''))}" target="_blank" rel="noopener noreferrer">TikTok</a>`:''}${safeUrl(x.facebook)?`<a href="${esc(safeUrl(x.facebook))}" target="_blank" rel="noopener noreferrer">Facebook</a>`:''}${digits(x.whatsapp)?`<a href="https://wa.me/${digits(x.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`:''}</section>`,
    links:x=>`<section class="pad links">${lines(x.items).map(([t,u])=>`<a href="${esc(safeUrl(u)||'#')}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`).join('')}</section>`,
    testimonials:x=>`<section class="pad"><h2>Lo que dicen nuestros clientes</h2><div class="car">${lines(x.items).map(([n,t,s])=>`<div class="tes"><div>${'★'.repeat(num(s,1,5,5))}</div><p>“${esc(t)}”</p><b>${esc(n)}</b></div>`).join('')}</div></section>`,
    faq:x=>`<section class="pad"><h2>Preguntas frecuentes</h2>${lines(x.items).map(([q,a])=>`<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>`,
    gallery:x=>(x.imgs||[]).length?`<section class="pad gal">${x.imgs.map(s=>safeImg(s)?`<img src="${esc(safeImg(s))}" alt="" loading="lazy">`:'').join('')}</section>`:'',
    hours:x=>`<section class="pad"><h2>Horario</h2>${lines(x.items).map(([d,h])=>`<div class="hr"><span>${esc(d)}</span><b>${esc(h)}</b></div>`).join('')}</section>`,
    stats:x=>`<section class="pad sts">${lines(x.items).map(([n,l])=>`<div><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</section>`,
    spacer:x=>`<div style="height:${num(x.h,0,600,32)}px;${x.line?'border-bottom:1px solid rgba(0,0,0,.12)':''};margin:0 16px"></div>`,
    footer:x=>`<footer>${esc(x.text)}${x.email?` · <a href="mailto:${encodeURIComponent(str(x.email,160))}">${esc(x.email)}</a>`:''}${x.phone?` · ${esc(x.phone)}`:''}</footer>`,
    cartbtn:x=>`<button class="fcart" style="${oneOf(x.pos,['right','left'],'right')}:16px" id="fcart" aria-label="Abrir carrito">🛒 <span id="cc">0</span></button>`,
    floating:x=>`<a class="fwa" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" href="https://wa.me/${digits(x.phone)||digits(st.whatsapp)}?text=${encodeURIComponent(str(x.msg,500))}">💬</a>`,
    popup:x=>`<div class="pop" id="pop" data-delay="${num(x.delay,0,120,0)}"><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p><button data-act="close-pop">Entendido</button></div></div>`
  };
  const legal=cfg.checkout.legal;
  const body=D.blocks.map(b=>Object.prototype.hasOwnProperty.call(R,b.type)?R[b.type](b.props||{}):'').join('')
    +(legal.terms||legal.privacy?`<footer class="legal">${legal.terms?'<a href="#" data-act="legal" data-k="terms">Términos y condiciones</a>':''}${legal.terms&&legal.privacy?' · ':''}${legal.privacy?'<a href="#" data-act="legal" data-k="privacy">Política de privacidad</a>':''}</footer>`:'');
  const css=`*{box-sizing:border-box}body{margin:0;font-family:'${FONT}',sans-serif;background:${SC};color:${TX}}a{color:${P}}
  .hero{padding:48px 20px;background-size:cover;background-position:center}.hero.small{padding:28px 20px}.hero.large{padding:80px 20px}.hero.full{min-height:100vh;display:flex;flex-direction:column;justify-content:center}
  .hero h1{margin:0 0 10px;font-size:30px}.hero p{margin:0;line-height:1.5}.cta{display:inline-block;margin-top:16px;background:#fff;color:${P};padding:10px 20px;border-radius:${rad};text-decoration:none;font-weight:700}
  .pad{padding:20px 16px}h2{margin:0 0 12px;font-size:20px}
  .cat .bar{position:sticky;top:0;background:${SC};padding:12px 12px 8px;z-index:2}.srch{width:100%;padding:10px 12px;border:1px solid ${P}55;border-radius:${rad};margin-bottom:8px;background:#fff8}
  .cats{display:flex;gap:6px;overflow:auto}.cb{border:1px solid ${P};background:transparent;color:${P};padding:6px 14px;border-radius:40px;white-space:nowrap;cursor:pointer;font:inherit}.cb.on{background:${P};color:#fff}
  .sort{padding:0 12px 8px}.ord{border:1px solid ${P}55;border-radius:${rad};padding:6px;background:transparent;color:inherit;font:inherit}
  .list{padding:0 12px 20px;display:flex;flex-direction:column;gap:10px}.list.grid,.list.glass,.list.classic{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
  .pc{position:relative;display:flex;gap:12px;background:#ffffffcc;border-radius:${rad};padding:10px;cursor:pointer}.pc.l-grid,.pc.l-glass,.pc.l-classic{flex-direction:column}
  .pc.l-glass{background:#ffffff40;backdrop-filter:blur(8px);border:1px solid #ffffff60}.list.grid{gap:0}.pc.l-grid{border-radius:0}
  .im{width:84px;height:84px;flex:none;border-radius:${rad};background:#0001;display:grid;place-items:center;overflow:hidden;font-size:28px}.pc:not(.l-list) .im{width:100%;height:auto;aspect-ratio:1}.im img{width:100%;height:100%;object-fit:cover}.tx{flex:1;min-width:0}.tx b{color:${P};display:block}.tx p{margin:4px 0;font-size:13px;opacity:.8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .pr{font-weight:700;color:${P};margin-top:4px}.out{font-size:12px;color:#c33;font-weight:700}
  .add{position:absolute;right:10px;bottom:10px;width:34px;height:34px;border-radius:50%;border:0;background:${P};color:#fff;font-size:18px;cursor:pointer}
  .car{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px}.car>*{flex:0 0 160px}
  .ban{color:#fff;border-radius:${rad};padding:20px;display:flex;flex-direction:column;gap:6px}.ban b{font-size:20px}.ban a{color:#fff;font-weight:700}
  .soc,.links{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}.links{flex-direction:column}.soc a,.links a{background:${P};color:#fff;padding:10px 16px;border-radius:${rad};text-decoration:none;text-align:center}
  .tes{background:#fff9;border-radius:${rad};padding:14px}.tes div{color:#f5a623}
  details{background:#fff9;border-radius:${rad};padding:12px;margin-bottom:8px}summary{font-weight:600;cursor:pointer}
  .gal{display:grid;grid-template-columns:1fr 1fr;gap:6px}.gal img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:${rad}}
  .hr{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #0001}.sts{display:grid;grid-template-columns:repeat(3,1fr);text-align:center}.sts b{display:block;font-size:24px;color:${P}}
  footer{padding:24px 16px;text-align:center;font-size:13px;opacity:.75}
  .fcart{position:fixed;bottom:16px;z-index:5;background:${P};color:#fff;border:0;border-radius:40px;padding:12px 18px;font:inherit;font-weight:700;box-shadow:0 6px 20px #0004;cursor:pointer}
  .fwa{position:fixed;bottom:80px;right:16px;width:52px;height:52px;border-radius:50%;background:#25d366;display:grid;place-items:center;font-size:24px;text-decoration:none;z-index:5}
  .pop{position:fixed;inset:0;background:#0007;display:none;place-items:center;z-index:9}.pop.show{display:grid}.pop>div{background:#fff;color:#222;border-radius:${rad};padding:22px;max-width:300px;text-align:center}.pop button,.sh button.go,.sh a.go{background:${P};color:#fff;border:0;border-radius:${rad};padding:10px 18px;font:inherit;font-weight:700;cursor:pointer}
  .sh{position:fixed;inset:0;background:#0007;display:none;align-items:flex-end;z-index:8}.sh.open{display:flex}.sh>div{background:#fff;color:#222;width:100%;max-height:88vh;overflow:auto;border-radius:18px 18px 0 0;padding:18px}
  .sh input,.sh select,.sh textarea{width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;margin:4px 0 10px;font:inherit}.ci{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #eee}.ci .q{display:flex;gap:6px;align-items:center}.ci .q button{width:26px;height:26px;border-radius:50%;border:1px solid #ccc;background:#fff;cursor:pointer}
  .tot{display:flex;justify-content:space-between;padding:4px 0}.tot.b{font-weight:700;font-size:17px}`;
  return {css,html:body,font:FONT}}
