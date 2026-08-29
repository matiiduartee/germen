/**
 * Proxy de pedidos del mostrador — función HTTP de Velo.
 *
 * Va en el backend del sitio de Wix, en el archivo `backend/http-functions.js`.
 * Queda expuesto en:
 *     https://www.germinandonativas.com/_functions/pedido
 *
 * ¿Por qué acá y no en la tablet? Crear pedidos requiere permisos de
 * administrador. Si la tablet los tuviera, cualquiera con acceso físico al
 * dispositivo tendría acceso de administrador a toda la cuenta de Wix.
 * Acá el código corre dentro del sitio y usa `elevate()` sólo en las dos
 * llamadas que lo necesitan.
 *
 * La documentación de Wix avisa que las funciones HTTP son "particularmente
 * vulnerables por su naturaleza abierta", así que lo primero que hace esta
 * función es validar un secreto por dispositivo. Sin eso, sería un endpoint
 * público capaz de crear pedidos.
 *
 * Flujo:
 *   1. valida el secreto del dispositivo
 *   2. si ese envío ya se procesó, devuelve el pedido de antes (no duplica)
 *   3. crea un borrador  → Wix calcula precios, impuestos y envío
 *   4. convierte el borrador en pedido, con canal POS
 *   5. registra el pago, marcado como cobrado fuera de Wix
 *
 * Antes de usar hay que crear:
 *   - el secreto `germen-secreto-tablet` en el Administrador de secretos
 *   - la colección CMS `PedidosMostrador` con los campos: envioId (texto),
 *     orderId (texto), numero (texto), creado (fecha)
 */

import { ok, badRequest, forbidden, serverError } from 'wix-http-functions';
import { elevate } from 'wix-auth';
import { getSecret } from 'wix-secrets-backend';
import wixData from 'wix-data';
import { draftOrders, orderTransactions } from '@wix/ecom';

/** ID de la app Wix Stores. Es siempre el mismo para todas las tiendas. */
const APP_STORES = '215238eb-22a5-4c36-9e7b-e7c08025e04e';

const COLECCION = 'PedidosMostrador';
const MAX_LINEAS = 100;

const responder = (fn, cuerpo) => fn({ headers: { 'Content-Type': 'application/json' }, body: cuerpo });

export async function post_pedido(request) {
  let envio;
  try {
    envio = await request.body.json();
  } catch {
    return responder(badRequest, { error: 'El cuerpo no es JSON válido.' });
  }

  // ---- 1. autenticación del dispositivo ----
  try {
    const esperado = await getSecret('germen-secreto-tablet');
    const recibido = request.headers['x-germen-secreto'];
    if (!esperado || recibido !== esperado) {
      return responder(forbidden, { error: 'Dispositivo no autorizado.' });
    }
  } catch (e) {
    return responder(serverError, { error: 'No se pudo validar el dispositivo. ¿Existe el secreto germen-secreto-tablet?' });
  }

  const problema = validar(envio);
  if (problema) return responder(badRequest, { error: problema });

  // ---- 2. idempotencia ----
  // La tablet reintenta cuando se le corta la red. Sin esto, un reintento
  // crearía el pedido dos veces y descontaría el stock dos veces.
  try {
    const previo = await wixData.query(COLECCION)
      .eq('envioId', envio.id).limit(1).find({ suppressAuth: true });
    if (previo.items.length > 0) {
      return responder(ok, {
        numero: previo.items[0].numero,
        orderId: previo.items[0].orderId,
        yaExistia: true,
      });
    }
  } catch (e) {
    // Si la colección todavía no existe, seguimos: es peor no poder vender.
    console.warn(`[germen] no se pudo consultar ${COLECCION}: ${e.message}`);
  }

  try {
    // ---- 3. borrador: Wix pone los precios ----
    // Mandamos IDs y cantidades solamente. Los precios salen del catálogo de
    // Wix, así que una tablet con el catálogo viejo no puede cobrar de menos.
    const crearBorrador = elevate(draftOrders.createDraftOrder);
    const { calculatedDraftOrder } = await crearBorrador({
      draftOrder: {
        catalogLineItems: envio.lineas.map((l) => ({
          catalogReference: {
            catalogItemId: l.productoId,
            appId: APP_STORES,
            // Toda la tienda tiene manageVariants: true, así que la variante
            // se referencia por variantId.
            options: { variantId: l.varianteId },
          },
          quantity: l.cantidad,
        })),
        buyerInfo: envio.cliente?.email ? { email: envio.cliente.email } : undefined,
      },
    });

    const borrador = calculatedDraftOrder?.draftOrder;
    if (!borrador?.id) throw new Error('Wix no devolvió el borrador del pedido.');

    const errores = calculatedDraftOrder.calculationErrors;
    if (errores && Object.keys(errores).length > 0) {
      console.warn('[germen] el borrador vino con errores de cálculo:', JSON.stringify(errores));
    }

    const total = borrador.priceSummary?.total?.amount;

    // ---- 4. borrador → pedido ----
    const crearPedido = elevate(draftOrders.createOrderFromDraft);
    const resultado = await crearPedido(borrador.id, {
      channelInfo: { type: 'POS' },
      reason: `Mostrador — ${envio.medioDePago ?? 'sin especificar'}`,
      createSettings: {
        notifications: {
          sendNotificationToBuyer: true,
          sendNotificationsToBusiness: false,   // el pedido lo cargamos nosotros
        },
      },
    });

    const orderId = resultado?.committedDraftOrder?.orderId;
    const numero = resultado?.order?.number ?? resultado?.committedDraftOrder?.orderNumber ?? null;
    if (!orderId) throw new Error('El pedido se creó pero Wix no devolvió su ID.');

    // ---- 5. el pago, que ya se cobró afuera ----
    if (total && Number(total) > 0) {
      try {
        const agregarPago = elevate(orderTransactions.addPayments);
        await agregarPago(orderId, [{
          amount: { amount: String(total) },
          regularPaymentDetails: {
            offlinePayment: true,
            paymentMethod: envio.medioDePago ?? 'efectivo',
          },
        }]);
      } catch (e) {
        // El pedido ya existe: no lo tiramos abajo por no poder anotar el pago.
        // Queda impago en Wix y se marca a mano desde el panel.
        console.error(`[germen] pedido ${orderId} creado, pero falló registrar el pago: ${e.message}`);
      }
    }

    // ---- registro local, para la idempotencia ----
    try {
      await wixData.insert(COLECCION, {
        envioId: envio.id, orderId, numero: String(numero ?? ''), creado: new Date(),
      }, { suppressAuth: true });
    } catch (e) {
      console.warn(`[germen] no se pudo registrar el envío ${envio.id}: ${e.message}`);
    }

    return responder(ok, { numero, orderId });

  } catch (e) {
    console.error('[germen] falló la creación del pedido:', e);
    return responder(serverError, { error: e.message ?? 'Error creando el pedido en Wix.' });
  }
}

/** Chequeo simple para no mandarle basura a Wix. */
function validar(envio) {
  if (!envio || typeof envio !== 'object') return 'Falta el cuerpo del pedido.';
  if (!envio.id) return 'Falta el id del envío, que es lo que evita duplicados.';
  if (!Array.isArray(envio.lineas) || envio.lineas.length === 0) return 'El pedido no tiene líneas.';
  if (envio.lineas.length > MAX_LINEAS) return `El pedido tiene más de ${MAX_LINEAS} líneas.`;

  for (const l of envio.lineas) {
    if (!l.productoId || !l.varianteId) return 'Hay una línea sin producto o sin variante.';
    if (!Number.isInteger(l.cantidad) || l.cantidad < 1) return 'Hay una línea con cantidad inválida.';
  }
  return null;
}

/** Sirve para probar desde la tablet que el proxy está vivo y el secreto anda. */
export async function get_pedido(request) {
  try {
    const esperado = await getSecret('germen-secreto-tablet');
    if (request.headers['x-germen-secreto'] !== esperado) {
      return responder(forbidden, { error: 'Dispositivo no autorizado.' });
    }
    return responder(ok, { estado: 'ok', hora: new Date().toISOString() });
  } catch {
    return responder(serverError, { error: 'Falta configurar el secreto germen-secreto-tablet.' });
  }
}
