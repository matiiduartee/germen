# Germen — app de tablet para Germinando Nativas

App local para atender clientes en el local desde una tablet Android (Lenovo Tab 11),
espejando el recorrido guiado de www.germinandonativas.com, y sincronizada con Wix
para crear y administrar pedidos reales.

## Relevamiento del sitio (datos reales, obtenidos por API)

Sitio Wix: `Germinando Nativas` — ID `7f752b63-1b75-465e-8382-43aae9432de0`
Publicado, plan Premium, dominio propio, Velo **habilitado**.
Idioma `es`, país `AR`, huso `America/Argentina/Buenos_Aires`, moneda **ARS**.

### Catálogo

- **Wix Stores con catálogo V1** (no V3). Esto define los endpoints: se usa
  `/stores-reader/v1/...`; los `/stores/v3/...` devuelven `428 Precondition Required`.
- **162 productos**, casi todos `productType: physical`, uno `digital`
  (la guía de cuidados descargable).
- `manageVariants: true` en la mayoría: las opciones son **Maceta** y **Tamaño**
  (`optionType: drop_down`). El precio y el stock viven **en la variante**, no en el
  producto. El SKU también (ej. `SES-VIR-10L`).
- Descripciones ricas en HTML + `additionalInfoSections` con secciones fijas por planta:
  beneficios y usos, qué recibís, métodos de entrega, detalles botánicos, tip de experto.
  El encabezado de la descripción trae los íconos de ☀️ sol, 💧 riego, 📏 tamaño,
  🌸 floración y 🦋 fauna: es material listo para la ficha de la tablet.
- Imágenes en el CDN de Wix (`static.wixstatic.com`), con transformaciones por URL
  (`/v1/fit/w_,h_,q_/file.jpg`), lo que permite bajar el tamaño exacto que necesita la tablet.

### Colecciones (34)

Se agrupan en tres familias, y esto es lo que hace posible espejar el recorrido guiado:

1. **Botánicas / tipo**: Árboles, Arbustos, Herbáceas, Gramíneas, Enredaderas y trepadoras,
   Rastreras y cubresuelos, Plantas de hoja, Cactus y suculentas, Aromáticas y medicinales.
2. **Condiciones del espacio**: Sol pleno, Media sombra, Bajo riego, De interior.
3. **Objetivo / uso**: Plantas para mariposas, Plantas para picaflores, Cerco vivo,
   Colección "Delta", Colección primavera, Módulos listos para plantar.

Y, por separado, ocho colecciones **`Quiz *`**: `Quiz Arbol`, `Quiz Arbusto`, `Quiz Herbacea`,
`Quiz Graminea`, `Quiz Enredadera`, `Quiz Rastrera`, `Quiz Cactus`, `Quiz Acuatica`.
Son el destino del recorrido guiado del sitio: el cuestionario clasifica al cliente en un
tipo de planta y lo aterriza en una de estas colecciones.

### Recorrido guiado existente

En el CMS hay formularios que implementan el diagnóstico:

- **"Identificación espacio"** — campos `cuanto_sol_tenes`, `donde_irian_las_plantas_1`,
  `selector_de_etiquetas`. Es el cuestionario de espacio.
- **"Interacción y calificación interiores"** — ventanas iluminadas, espacios cálidos,
  días al mes de dedicación, aire/estufas. Es la variante para interiores.
- Colecciones nativas de apoyo: `Diagnosticador` (nombre científico / común),
  `Especies`, `RespuestasDiseno` (`estilo`, `fauna`), `Preciocuponmacetas`.

La app de tablet debe reimplementar esta lógica **localmente**, como un árbol de decisión
en datos (no en código), para que se pueda ajustar sin recompilar.

## Arquitectura propuesta

Tres piezas, y la separación entre ellas es lo que resuelve el requisito de
"local para navegar, internet sólo para pedidos".

```
┌────────────────────────┐     ┌──────────────────────┐     ┌───────────────┐
│  Tablet (PWA/Capacitor)│────▶│  Proxy (backend fino)│────▶│   Wix APIs    │
│  catálogo en IndexedDB │◀────│  guarda la API key   │◀────│   (wixapis)   │
│  imágenes precacheadas │     └──────────────────────┘     └───────────────┘
│  cola de pedidos       │
└────────────────────────┘
```

### 1. Tablet — app offline-first

- **PWA con service worker**, empaquetada con Capacitor para tener ícono, pantalla
  completa y modo kiosco en Android. Un solo código, se desarrolla y prueba en el navegador.
- Todo el catálogo vive en **IndexedDB**; las imágenes en el **Cache Storage**.
  Navegar, filtrar, hacer el quiz y armar el carrito funciona **sin red**.
- La red se usa sólo para: (a) sincronizar el catálogo, (b) enviar el pedido.

### 2. Proxy — backend fino

**Requisito de seguridad, no opcional:** la API key de Wix es de administrador y
**no puede vivir en la tablet**. Cualquiera con acceso físico al dispositivo la extraería.
Va en un proxy con un secreto propio por dispositivo.

Dos opciones:

- **A — Velo HTTP functions** en el mismo sitio Wix. Velo ya está habilitado. Cero
  infraestructura nueva, el código corre dentro del sitio con permisos elevados.
- **B — Worker / VPS chico** (Cloudflare Worker o similar). Más control, logs propios,
  independiente de Wix.

### 3. Sincronización del catálogo

`scripts/sync-catalogo.mjs` baja productos, variantes y colecciones y produce un
`catalogo.json` versionado con hash. La tablet pide el hash; si cambió, baja el
paquete completo. Con 162 productos el JSON es chico y bajarlo entero es más simple
y más robusto que un diff incremental.

## Cómo se crea el pedido en Wix

Hay dos caminos, y **conviene el segundo**:

### Camino directo — `POST /ecom/v1/orders` (Create Order)

Existe y está pensado justamente para esto ("orders from external systems, such as POS").
Pero tiene dos problemas serios para un punto de venta:

1. **Límite de 5 llamadas por hora por sitio** para apps no publicadas en el Wix App Market.
   Con identidad de API key (admin) el límite *no debería* aplicar, porque no es una app
   — pero eso hay que **verificarlo empíricamente antes de construir encima**. Es el
   primer spike del proyecto.
2. Obliga a calcular a mano totales, impuestos y envío. Cada línea debe traer
   `taxDetails` o `taxInfo`. Replicar la aritmética fiscal en ARS del lado de la tablet
   es una fuente de errores permanente.

### Camino recomendado — Draft Orders

```
POST /ecom/v1/draft-orders                          → crea el borrador
  body: { draftOrder: { catalogLineItems: [
    { catalogReference: { catalogItemId, appId }, quantity } ] } }

POST /ecom/v1/draft-orders/{id}/create-order        → lo convierte en pedido real
  body: { channelInfo: { type: "..." }, createSettings: { notifications: {...} } }
```

Ventajas concretas:

- **Wix calcula precios, impuestos y envío.** La respuesta es un `calculatedDraftOrder`
  con `shippingOptions` y `calculationErrors`. La tablet no hace aritmética fiscal.
- El `appId` de Wix Stores es `215238eb-22a5-4c36-9e7b-e7c08025e04e` — coincide con la
  app instalada en el sitio, así que las líneas quedan enlazadas al catálogo real
  (no como texto suelto), y el stock se descuenta solo.
- Se puede editar el borrador antes de confirmar (agregar líneas, descuentos, envío),
  que es exactamente el flujo de mostrador: el cliente cambia de opinión antes de pagar.
- No tiene el límite de 5/hora documentado.

En ambos casos, `channelInfo.type` debe reflejar el origen real de la venta.

## Riesgos identificados

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Límite de 5 pedidos/hora | Bloquea el uso real | Spike de verificación con API key **antes** de construir. Camino Draft Orders como plan principal |
| API key en el dispositivo | Compromiso total de la cuenta | Proxy obligatorio, secreto por dispositivo, revocable |
| Stock por variante | Vender lo que no hay | Sincronizar `variants[].stock`, no el stock del producto |
| Catálogo desactualizado | Precio viejo en mostrador | Sync al abrir + banner con antigüedad del catálogo |
| Sin internet al cobrar | Pedido perdido | Cola local persistente con reintento e idempotencia |

## Estado del stock hoy

En el relevamiento, la mayoría de los productos figura con `quantity: 0` o negativo
(`-1`, `-3`) y `inStock: false`, pero `visible: true`. Algunos sí tienen stock real
(Bio-neem 10, Arvejilla 20, Suspiros 2). Hay que definir si la tablet muestra stock,
lo ignora, o bloquea la venta — ver decisiones pendientes.

## Fuentes

- https://dev.wix.com/docs/api-reference/business-solutions/stores/skills/query-products-catalog-v1
- https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/create-order
- https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/draft-orders/create-draft-order
- https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/draft-orders/create-order-from-draft
- https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/make-api-calls-with-an-api-key
- https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/list-data-collections
