# FlowyMarket

Tienda en línea con pedidos por WhatsApp y panel de administración. Es un sitio estático
(GitHub Pages) que usa Supabase como base de datos, inicio de sesión, almacenamiento de
imágenes y actualizaciones en tiempo real.

- `index.html`: tienda pública. Los cambios publicados desde el panel se ven al instante.
- `admin.html`: panel de administración (requiere iniciar sesión como administrador).

## Seguridad

- **Nunca** pongas la clave `service_role` en este repositorio. `config.js` lleva solo la URL del proyecto
  y la clave pública `anon`, que es segura de publicar porque la base de datos está protegida con RLS.
- Lectura pública: configuración, categorías y productos visibles. Todo lo demás requiere ser administrador
  (`public.admins`), verificado en el servidor con `is_admin()`.
- Los pedidos solo se crean con la función `place_order()`, que recalcula precios, opciones, envío, impuestos y
  descuentos, valida el stock de forma atómica y limita pedidos por IP. El navegador del cliente no decide ningún importe.
- Los códigos de descuento nunca salen de la base de datos.
- No hay cobros en línea: el administrador marca manualmente "Pago recibido".
- El mensaje de WhatsApp lo puede editar el cliente: verifica siempre el número de pedido en el panel.

## Puesta en marcha

1. En Supabase → SQL Editor, ejecuta `supabase/schema.sql`.
2. Crea tu usuario en Authentication → Users y agrégalo como administrador:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'tu@correo.com';
   ```
3. En Authentication → Sign In / Providers, desactiva "Allow new users to sign up".
4. En Authentication → URL Configuration, usa como Site URL la dirección de GitHub Pages
   (necesario para el correo de recuperación de contraseña).
5. Completa `config.js` con la URL del proyecto y la clave `anon`, y reemplaza `__SUPABASE_URL__` y
   `__SUPABASE_WSS__` en la CSP de `index.html` y `admin.html`.
6. Publica el repositorio con GitHub Pages (rama `main`, carpeta raíz).

## Pruebas

```bash
npm i @electric-sql/pglite@0.2.17
node tests/db.test.mjs
```

Ejecuta el esquema sobre Postgres real (PGlite) y prueba RLS, privilegios y `place_order` como `anon`,
como usuario sin permisos y como administrador.

## Limitaciones conocidas

- GitHub Pages no permite cabeceras HTTP propias: `frame-ancestors` (clickjacking) no se puede aplicar.
- La sesión del panel se guarda en `localStorage` (así funciona supabase-js en sitios estáticos), no en cookies HttpOnly.
  Por eso es clave que no haya XSS: todo el contenido se escapa y la CSP no permite scripts en línea.
- El límite de pedidos por IP depende de la cabecera `x-forwarded-for` que entrega Supabase.
- El contador de visitas es aproximado.
