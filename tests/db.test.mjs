// Pruebas de seguridad del esquema (RLS, privilegios y place_order) sobre Postgres real (PGlite).
// Uso: npm i @electric-sql/pglite@0.2.17 && node tests/db.test.mjs
// Simula el entorno de Supabase: roles anon/authenticated, auth.uid(), storage y la publicación de realtime.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  .replace(/create extension if not exists pgcrypto;/, ''); // gen_random_uuid() ya viene en Postgres 13+

const db = new PGlite();
const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASA ' : 'FALLA'} · ${name}${extra ? ' · ' + extra : ''}`); };

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create publication supabase_realtime;
  grant usage on schema public, auth, storage to anon, authenticated;
  grant all on storage.objects to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  insert into auth.users values ('${ADMIN}', 'admin@x.test'), ('${USER}', 'otro@x.test');
`);
await db.exec(schema);
await db.exec(schema); // idempotencia: debe poder ejecutarse dos veces
ok('el esquema se aplica dos veces sin error', true);

// datos de prueba (como superusuario = panel de Supabase)
await db.exec(`
  insert into admins values ('${ADMIN}');
  insert into shop_config (id, store, design, checkout, payments) values (1, '{"name":"T","whatsapp":"5215500000000"}', '{}',
    '{"delivery":true,"deliveryPrice":5,"pickup":true,"table":false,"askName":true,"askPhone":true,"askEmail":false,"taxOn":false,
      "addr":{"line1":[true,true],"line2":[true,false],"city":[true,true],"state":[false,false],"zip":[false,false]},
      "questionsOn":true,"questions":[{"text":"¿Regalo?","required":true}]}',
    '{"cash":true,"transfer":true,"custom":false}');
  insert into categories (id, name) values ('cat1', 'Decants');
  insert into products (id, title, price, stock, category_id, options) values
    ('p1', 'Decant', 18, 3, 'cat1', '[{"title":"Tamaño","required":true,"multi":false,"items":[{"title":"5ml","price":0,"available":true},{"title":"20ml","price":10,"available":true},{"title":"Agotado","price":0,"available":false}]}]'),
    ('p2', 'Ilimitado', 10, 99999, null, '[]');
  insert into products (id, title, price, hidden) values ('p3', 'Oculto', 1, true);
  insert into promos values ('VIP10', 'pct', 10, true), ('OFF', 'pct', 50, false);
`);

async function as(role, sub, fn, ip = '1.1.1.1') {
  await db.exec(`reset role; set request.jwt.claim.sub = '${sub || ''}'; set request.headers = '{"x-forwarded-for":"${ip}"}'; set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const base = (extra = {}) => ({ type: 'Recoger en sucursal', pay: 'Efectivo', customer: { name: 'Ana', phone: '5512345678' }, answers: ['no'], items: [{ id: 'p2', q: 1 }], ...extra });
const order = (p) => q('select place_order($1::jsonb) as r', [JSON.stringify(p)]).then(r => r[0].r);
const orderErr = (p) => err('select place_order($1::jsonb)', [JSON.stringify(p)]);
let ipN = 0; const nextIp = () => `10.0.0.${++ipN}`;

// ---------- lectura pública ----------
await as('anon', '', async () => {
  ok('anon lee la configuración', (await q('select * from shop_config')).length === 1);
  ok('anon lee categorías', (await q('select * from categories')).length === 1);
  const prods = await q('select id from products');
  ok('anon no ve productos ocultos', prods.length === 2 && !prods.some(p => p.id === 'p3'));
  ok('anon no ve pedidos', (await q('select * from orders')).length === 0);
  ok('anon no ve códigos de descuento', (await q('select * from promos')).length === 0);
  ok('anon no ve administradores', (await q('select * from admins')).length === 0);
  ok('anon no puede leer estadísticas', !!(await err('select * from stats')));
  ok('anon no puede leer el registro de IPs', !!(await err('select * from order_rate')));
});

// ---------- escritura no autorizada ----------
await as('anon', '', async () => {
  ok('anon no puede insertar productos', !!(await err(`insert into products (id, title) values ('hack', 'x')`)));
  await q(`update products set price = 0`);
  await q(`delete from products`);
  ok('anon no puede insertar pedidos directo', !!(await err(`insert into orders (type, items, subtotal, total) values ('x', '[]', 0, 0)`)));
  ok('anon no puede hacerse administrador', !!(await err(`insert into admins values ('${USER}')`)));
  ok('anon no puede cambiar la configuración', (await q(`update shop_config set store = '{}' returning id`)).length === 0);
  ok('anon no puede subir imágenes', !!(await err(`insert into storage.objects (bucket_id, name) values ('product-images', 'x.jpg')`)));
});
ok('los productos siguen intactos tras los intentos de anon', (await q(`select count(*)::int c, sum(price)::numeric s from products`))[0].c === 3);
ok('el precio no cambió', (await q(`select price from products where id='p1'`))[0].price == 18);

await as('authenticated', USER, async () => {
  ok('usuario logueado sin rol admin no ve pedidos', (await q('select * from orders')).length === 0);
  ok('usuario logueado sin rol admin no edita productos', (await q(`update products set price = 1 returning id`)).length === 0);
  ok('usuario logueado sin rol admin no se hace admin', !!(await err(`insert into admins values ('${USER}')`)));
  ok('usuario logueado sin rol admin no ve promos', (await q('select * from promos')).length === 0);
  ok('usuario logueado sin rol admin no sube imágenes', !!(await err(`insert into storage.objects (bucket_id, name) values ('product-images', 'x.jpg')`)));
});

// ---------- place_order ----------
await as('anon', '', async () => {
  const r = await order(base({ items: [{ id: 'p1', q: 2, sel: [[0, 1]], price: 0.01, title: 'gratis' }], total: -5, discount: 999 }));
  ok('pedido válido: precio recalculado en el servidor', +r.total === 56 && +r.items[0].price === 28, `total=${r.total}`);
}, nextIp());
ok('pedido válido: descuenta stock', (await q(`select stock from products where id='p1'`))[0].stock === 1);
await as('anon', '', async () => {
  ok('sobreventa con varias líneas: rechazada', (await orderErr(base({ items: [{ id: 'p1', q: 1, sel: [[0, 0]] }, { id: 'p1', q: 1, sel: [[0, 0]] }] })))?.includes('sin_stock'));
}, nextIp());
ok('stock intacto tras pedido rechazado', (await q(`select stock from products where id='p1'`))[0].stock === 1);
await db.exec(`update products set stock = 50 where id = 'p1'`);
const cases = [
  ['opción única con varias selecciones', base({ items: [{ id: 'p1', q: 1, sel: [[0, 0], [0, 1]] }] }), 'opciones_invalidas'],
  ['opción duplicada en grupo único', base({ items: [{ id: 'p1', q: 1, sel: [[0, 1], [0, 1], [0, 1]] }] }), null],
  ['opción agotada para esquivar la obligatoria', base({ items: [{ id: 'p1', q: 1, sel: [[0, 2]] }] }), 'opcion_no_disponible'],
  ['falta opción obligatoria', base({ items: [{ id: 'p1', q: 1 }] }), 'falta_opcion_obligatoria'],
  ['índice de grupo inexistente', base({ items: [{ id: 'p1', q: 1, sel: [[0, 0], [5, 0]] }] }), 'opciones_invalidas'],
  ['índice de opción inexistente', base({ items: [{ id: 'p1', q: 1, sel: [[0, 9]] }] }), 'opcion_no_disponible'],
  ['índices no numéricos (__proto__)', base({ items: [{ id: 'p1', q: 1, sel: [['__proto__', 'x']] }] }), 'opciones_invalidas'],
  ['índice negativo', base({ items: [{ id: 'p1', q: 1, sel: [[0, -1]] }] }), 'opciones_invalidas'],
  ['cantidad decimal', base({ items: [{ id: 'p2', q: 1.5 }] }), 'cantidad_invalida'],
  ['cantidad como texto', base({ items: [{ id: 'p2', q: '5' }] }), 'cantidad_invalida'],
  ['cantidad 1e9', base({ items: [{ id: 'p2', q: 1e9 }] }), 'cantidad_invalida'],
  ['cantidad 0', base({ items: [{ id: 'p2', q: 0 }] }), 'cantidad_invalida'],
  ['producto oculto', base({ items: [{ id: 'p3', q: 1 }] }), 'producto_no_disponible'],
  ['producto inexistente', base({ items: [{ id: 'nope', q: 1 }] }), 'producto_no_disponible'],
  ['carrito vacío', base({ items: [] }), 'pedido_vacio'],
  ['51 líneas', base({ items: Array.from({ length: 51 }, () => ({ id: 'p2', q: 1 })) }), 'pedido_vacio'],
  ['tipo deshabilitado (mesa)', base({ type: 'Pedido en mesa' }), 'tipo_invalido'],
  ['pago con tarjeta (no habilitado)', base({ pay: 'Tarjeta' }), 'pago_invalido'],
  ['código de descuento inactivo', base({ promo: 'OFF' }), 'codigo_invalido'],
  ['código inventado', base({ promo: 'GRATIS100' }), 'codigo_invalido'],
  ['sin nombre', base({ customer: { name: '', phone: '5512345678' } }), 'falta_nombre'],
  ['teléfono inválido', base({ customer: { name: 'A', phone: 'abc' } }), 'falta_telefono'],
  ['pregunta obligatoria vacía', base({ answers: [''] }), 'falta_respuesta'],
  ['domicilio sin dirección obligatoria', base({ type: 'Entrega a domicilio', address: { line1: '', city: 'X' } }), 'falta_direccion'],
  ['payload enorme', base({ basura: 'x'.repeat(30000) }), 'pedido_invalido'],
];
for (const [name, payload, expected] of cases) {
  const e = await as('anon', '', () => orderErr(payload), nextIp());
  ok(name, expected ? !!e && e.includes(expected) : !e, e || 'aceptado');
}
await as('anon', '', async () => {
  const r = await order(base({ items: [{ id: 'p1', q: 1, sel: [[0, 1], [0, 1]] }] }));
  ok('opción duplicada cuenta una sola vez', +r.items[0].price === 28 && r.items[0].opts.length === 1);
  const r2 = await order(base({ promo: 'vip10', items: [{ id: 'p2', q: 2 }] }));
  ok('código válido aplicado en el servidor (sin distinguir mayúsculas)', +r2.discount === 2 && +r2.total === 18);
  const r3 = await order(base({ type: 'Entrega a domicilio', address: { line1: 'Calle 1', city: 'CDMX', line2: '' }, items: [{ id: 'p2', q: 1 }] }));
  ok('envío sumado por el servidor', +r3.shipping === 5 && +r3.total === 15);
}, nextIp());

// límite de pedidos por IP
const ip = nextIp(); let blocked = null;
for (let i = 0; i < 6; i++) { const e = await as('anon', '', () => orderErr(base()), ip); if (e) { blocked = { i, e }; break; } }
ok('límite: el 6.º pedido en 10 min desde la misma IP se rechaza', blocked && blocked.i === 5 && blocked.e.includes('demasiados_pedidos'), JSON.stringify(blocked));

// pausa
await db.exec(`update shop_config set checkout = checkout || '{"paused":true}'`);
ok('tienda pausada rechaza pedidos', (await as('anon', '', () => orderErr(base()), nextIp()))?.includes('tienda_pausada'));
await db.exec(`update shop_config set checkout = checkout || '{"paused":false}'`);

// ---------- administrador ----------
await as('authenticated', ADMIN, async () => {
  ok('admin ve pedidos', (await q('select * from orders')).length > 0);
  ok('admin edita productos', (await q(`update products set price = 19 where id = 'p2' returning id`)).length === 1);
  ok('admin ve promos', (await q('select * from promos')).length === 2);
  const o = (await q(`select id, total from orders order by num limit 1`))[0];
  ok('admin no puede alterar el total de un pedido', !!(await err(`update orders set total = 0 where id = '${o.id}'`)));
  ok('admin no puede alterar los productos de un pedido', !!(await err(`update orders set items = '[]' where id = '${o.id}'`)));
  ok('admin marca un pedido como pagado', (await q(`update orders set paid = true where id = '${o.id}' returning paid`))[0].paid === true);
  const before = (await q(`select stock from products where id='p1'`))[0].stock;
  await q(`update orders set status = 'Cancelado' where id = '${o.id}'`);
  ok('cancelar devuelve stock', (await q(`select stock from products where id='p1'`))[0].stock === before + 2);
  ok('un pedido cancelado no se puede reactivar', !!(await err(`update orders set status = 'Recibido' where id = '${o.id}'`)));
  ok('admin sube imágenes al bucket', !(await err(`insert into storage.objects (bucket_id, name) values ('product-images', 'ok.jpg')`)));
  ok('admin no sube a otro bucket', !!(await err(`insert into storage.objects (bucket_id, name) values ('otro', 'x.jpg')`)));
  ok('admin no puede agregar administradores desde la API', !!(await err(`insert into admins values ('${USER}')`)));
  ok('promo con más de 100 % rechazada', !!(await err(`insert into promos values ('MAL', 'pct', 150, true)`)));
  const r = await order({ type: 'Recoger en sucursal', pay: 'Efectivo', customer: {}, items: [{ id: 'p2', q: 1 }] });
  ok('admin crea pedido manual sin datos de cliente', +r.total === 19);
});
ok('stock nunca negativo', (await q(`select min(stock)::int m from products`))[0].m >= 0);
ok('realtime publicado en las 4 tablas', (await q(`select count(*)::int c from pg_publication_tables where pubname='supabase_realtime'`))[0].c === 4);

console.log(`\n${pass}/${pass + fail} pasan`);
process.exit(fail ? 1 : 0);
