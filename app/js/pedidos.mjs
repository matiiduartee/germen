/**
 * Envío de pedidos a Wix.
 *
 * La tablet NUNCA habla directo con wixapis.com: la API key es de administrador
 * de toda la cuenta y no puede vivir en el dispositivo. Habla con el proxy
 * (ver proxy/velo/http-functions.js), que es quien guarda la clave.
 *
 * Como el cobro se hace por fuera de Wix (efectivo, transferencia, QR, posnet),
 * el pedido se registra en Wix ya cobrado; el proxy se ocupa de eso.
 */

import { guardarPendiente, listarPendientes, borrarPendiente } from './almacen.mjs';

const CONFIG = 'germen.proxy';

export function configuracion() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG) ?? 'null');
  } catch { return null; }
}

export function configurar({ url, secreto }) {
  localStorage.setItem(CONFIG, JSON.stringify({ url, secreto }));
}

/**
 * Arma el cuerpo que espera el proxy. Mandamos IDs y cantidades, no precios:
 * los precios los pone Wix a partir del catálogo, así que una tablet con el
 * catálogo desactualizado no puede cobrar de menos.
 */
export function armarEnvio(pedido, { medioDePago = 'efectivo' } = {}) {
  return {
    // El id lo genera la tablet para que reintentar no duplique el pedido en Wix.
    id: crypto.randomUUID(),
    creado: new Date().toISOString(),
    medioDePago,
    cliente: pedido.cliente ?? null,
    nota: pedido.nota ?? '',
    lineas: pedido.lineas.map((l) => ({
      productoId: l.productoId,
      varianteId: l.varianteId,
      cantidad: l.cantidad,
      // De referencia, para poder auditar contra lo que devuelva Wix.
      nombre: l.nombre,
      precioEnTablet: l.precioUnitario,
    })),
  };
}

/** Manda un envío al proxy. Devuelve `{ ok, numero, motivo }`. */
export async function enviar(envio) {
  const cfg = configuracion();
  if (!cfg?.url) {
    return { ok: false, motivo: 'Falta configurar la dirección del proxy en Ajustes.' };
  }

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Germen-Secreto': cfg.secreto ?? '',
      },
      body: JSON.stringify(envio),
    });

    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      return { ok: false, motivo: `El servidor respondió ${res.status}. ${texto.slice(0, 200)}` };
    }
    const datos = await res.json();
    return { ok: true, numero: datos.numero ?? datos.orderNumber ?? null };
  } catch (e) {
    return { ok: false, motivo: `Sin conexión con el servidor (${e.message}).` };
  }
}

/**
 * Intenta enviar; si falla, lo deja en la cola para reintentar.
 * En el mostrador nunca se pierde una venta por un problema de red.
 */
export async function enviarOEncolar(envio) {
  const r = await enviar(envio);
  if (r.ok) return r;
  await guardarPendiente({ ...envio, ultimoError: r.motivo, intentos: 1 });
  return { ...r, encolado: true };
}

/** Reintenta todo lo que quedó pendiente. Se llama al volver la conexión. */
export async function reintentarPendientes() {
  const cola = await listarPendientes().catch(() => []);
  let enviados = 0;

  for (const envio of cola) {
    const { ultimoError, intentos, ...limpio } = envio;
    const r = await enviar(limpio);
    if (r.ok) {
      await borrarPendiente(envio.id);
      enviados++;
    } else {
      await guardarPendiente({ ...envio, ultimoError: r.motivo, intentos: (intentos ?? 0) + 1 });
    }
  }
  return { enviados, quedan: (await listarPendientes().catch(() => [])).length };
}

export { listarPendientes };
