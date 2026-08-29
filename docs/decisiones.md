# Decisiones tomadas

Las tres definiciones que dio Matías y qué implican en el código.

## 1. El cobro se hace por fuera de Wix

Efectivo, transferencia, QR de MercadoPago o posnet. La tablet **no cobra**:
registra el pedido en Wix y lo marca como ya pagado.

En el código:

- La pantalla de pedido pide el medio de pago (efectivo · transferencia ·
  QR MercadoPago · posnet), sólo para dejar constancia.
- El proxy crea el pedido y después llama a **Add Payments** con
  `regularPaymentDetails.offlinePayment: true` y el medio elegido como
  `paymentMethod`. Es el mismo mecanismo que usa Wix cuando se marca un
  pedido como pagado a mano desde el panel.
- El canal del pedido es `channelInfo.type: "POS"`, que es el valor que Wix
  define para puntos de venta. Los pedidos del mostrador quedan distinguibles
  de los de la web en los informes.
- **Si falla el registro del pago, el pedido igual queda creado.** Preferimos
  un pedido marcado como impago (que se arregla con un clic en el panel) antes
  que perder la venta.

## 2. La usan las dos partes, pero manda el equipo

> "Ambos pero principalmente yo y mi equipo con el cliente, el cliente debe
> poder entender tanto el camino para entender qué servicio o producto quiere
> (que está pensado como las preguntas que hago en persona) y también poder ver
> plantas y las características de su producto solamente con las imágenes de la
> página web."

En el código:

- **Una sola app**, no dos modos. Se apoya la tablet en el mostrador y el
  cliente mira; cuando hay que cerrar, la toma el equipo. Sin claves ni cambios
  de contexto en el medio de una atención.
- El **recorrido guiado** (`app/datos/recorrido.json`) hace las tres preguntas
  que se hacen en persona: dónde va a vivir la planta, qué porte busca, si hay
  algo puntual detrás. Con opción única **avanza solo**, sin botón de confirmar:
  se parece más a una charla que a un formulario.
- El recorrido es **data, no código**. Se reordenan, reescriben o agregan pasos
  editando un JSON. Los textos actuales son una primera versión: hay que
  ajustarlos para que suenen a como preguntás vos.
- La **ficha** es la de la web: las fotos grandes, el encabezado con
  ☀️ sol / 💧 riego / 📏 tamaño / 🌸 floración / 🦋 fauna, y las secciones
  desplegables de beneficios, qué recibís, entrega, detalles botánicos y tip
  de experto. Un cliente puede entenderla solo, sin que nadie le explique.
- El buscador entra también **por SKU**, que es lo que sirve cuando el que
  busca es el equipo y no el cliente.

## 3. Bloquear lo que no tiene stock

Sólo se vende lo que Wix dice que hay.

**Pero hay un problema con eso que conviene mirar antes de aplicarlo tal cual:**
de los 162 productos del catálogo, hoy **sólo 55 tienen stock**. Los otros 107
están en 0, y 12 de ellos en negativo (vendidos de más). Un bloqueo que además
escondiera esos productos dejaría la tablet con un tercio del catálogo, y
chocaría de frente con el pedido de que el cliente pueda ver las plantas y sus
características.

Por eso la regla quedó partida en dos, que es lo que concilia las dos respuestas:

| | Se puede |
|---|---|
| **Mirar** el catálogo completo, con fotos y fichas | siempre, los 162 |
| **Agregar al pedido** | sólo lo que tiene stock |

En el código (`app/js/reglas.mjs`):

- El stock se lee **de la variante**, nunca del producto. Un producto con
  `inStock: true` puede tener la medida que el cliente quiere en cero.
- Las cantidades negativas se tratan como cero. La Salvia azul de 30-40 cm
  figura en `-2`: eso es deuda, no stock.
- Cada tarjeta muestra su estado: **Hay stock** · **Algunas medidas** ·
  **Sin stock**. Lo disponible aparece primero en toda grilla, para que el
  cliente no se enamore justo de lo que no hay.
- En la ficha, las medidas sin stock salen tachadas y deshabilitadas.
- El tope se revalida **cada vez** que se suma una unidad, no sólo al agregar:
  si hay 2 Mburucuyá, la tercera se rechaza con el motivo escrito.

## Lo que queda pendiente de definir

1. **El stock hay que ordenarlo.** Con 107 productos en cero, o el vivero está
   realmente sin nada, o el stock de Wix no refleja lo que hay en el local.
   Si es lo segundo, conviene resolverlo antes de poner la tablet a bloquear
   ventas. Una opción es que la tablet sirva también para corregir stock.
2. **Los textos del recorrido.** Los actuales son una interpretación de las
   colecciones `Quiz *` y del formulario "Identificación espacio". Hay que
   pasarlos por tus palabras.
3. **Envío y retiro.** Hoy el pedido no lleva dirección de entrega: asume
   retiro en el local. Si hay que despachar a domicilio desde el mostrador,
   falta agregar `shippingInfo` al borrador.
