# Germen

App para atender clientes en el local de **Germinando Nativas** desde una tablet
Android, espejando el recorrido guiado de [germinandonativas.com](https://www.germinandonativas.com/)
y sincronizada con Wix para crear pedidos reales.

**El catálogo se navega 100% sin internet.** La red se usa sólo para dos cosas:
sincronizar el catálogo y mandar el pedido a Wix.

## Qué hay hecho

- **App de tablet** (`app/`) — PWA sin build ni dependencias: se sirve como
  archivos estáticos y anda offline. Recorrido guiado, catálogo con filtros y
  buscador, fichas con las fotos y textos de la web, pedido con bloqueo por
  stock y cola de envío para cuando no hay señal.
- **Proxy de pedidos** (`proxy/velo/http-functions.js`) — función HTTP de Velo
  que crea el pedido en Wix. Es quien tiene los permisos; la tablet no.
- **Sync del catálogo** (`scripts/sync-catalogo.mjs`) — baja los 162 productos
  con sus variantes, precios, stock, fotos y colecciones.
- **Pruebas** — 22 de las reglas de negocio y 10 de la app entera en un
  navegador real.

## Probarla ahora

No hace falta ni Wix ni credenciales: viene con 8 productos reales de muestra.

```bash
npm test                                  # reglas de negocio
npx serve app                             # o cualquier servidor estático
```

Un servidor estático alcanza; con `file://` no funciona, porque los módulos y
el service worker necesitan `http://`.

Para correr las pruebas de la app en el navegador:

```bash
npm install --no-save playwright
node --run prueba:navegador
```

## Ponerla en producción

### 1. El catálogo real

```bash
cp .env.example .env      # completá WIX_API_KEY
npm run sync              # genera data/catalogo.json con los 162 productos
npm run sync:imagenes     # además baja las fotos
cp data/catalogo.json app/datos/catalogo.json
```

La API key se saca del [API Keys Manager](https://manage.wix.com/account/api-keys)
y la crean sólo el dueño o los co-dueños. **Va en la máquina que sincroniza,
nunca en la tablet.**

### 2. El proxy en Wix

1. Pegá `proxy/velo/http-functions.js` en `backend/http-functions.js` del sitio.
2. Creá el secreto `germen-secreto-tablet` en el Administrador de secretos
   (inventá una cadena larga y al azar).
3. Creá la colección CMS `PedidosMostrador` con los campos `envioId` (texto),
   `orderId` (texto), `numero` (texto) y `creado` (fecha). Es la que evita que
   un reintento duplique el pedido.
4. Publicá el sitio. El endpoint queda en
   `https://www.germinandonativas.com/_functions/pedido`.

### 3. La tablet

Serví `app/` desde cualquier hosting estático, abrilo en Chrome en la tablet y
usá *Agregar a pantalla de inicio*. En Ajustes de la app, cargá la dirección
del proxy y el secreto.

## Documentación

- [Arquitectura y relevamiento del sitio](docs/arquitectura.md) — qué hay en la
  tienda, cómo se conecta con Wix, qué riesgos tiene.
- [Decisiones tomadas](docs/decisiones.md) — cobro, uso y stock: qué se decidió
  y qué implica en el código.

## Antes de confiar en esto para vender

Dos cosas están escritas contra la documentación de Wix pero **todavía no se
probaron contra la API real**, porque hace falta la clave de la cuenta:
el script de sync y el proxy de pedidos. El primer paso es hacer una venta de
prueba de punta a punta y confirmar que el pedido llega bien.
