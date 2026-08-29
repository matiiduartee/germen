/**
 * Guardado local de la tablet.
 *
 * IndexedDB para lo que tiene que sobrevivir a un cierre de app:
 *   - el catálogo sincronizado
 *   - los pedidos que todavía no llegaron a Wix
 *
 * El pedido en curso vive en memoria: si se cierra la app en mitad de una
 * atención, es preferible empezar de nuevo antes que arrastrar un carrito viejo.
 */

const BASE = 'germen';
const VERSION = 1;
const CATALOGO = 'catalogo';
const PENDIENTES = 'pendientes';

let db = null;

function abrir() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(CATALOGO)) d.createObjectStore(CATALOGO);
      if (!d.objectStoreNames.contains(PENDIENTES)) {
        d.createObjectStore(PENDIENTES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function transaccion(almacen, modo, fn) {
  return abrir().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(almacen, modo);
    const pedido = fn(tx.objectStore(almacen));
    tx.oncomplete = () => resolve(pedido?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// ---------- catálogo ----------

export const guardarCatalogo = (paquete) =>
  transaccion(CATALOGO, 'readwrite', (s) => s.put(paquete, 'actual'));

export const leerCatalogo = () =>
  transaccion(CATALOGO, 'readonly', (s) => s.get('actual'));

/**
 * Trae el catálogo del disco local y, si hay red, se fija si el archivo
 * publicado cambió de versión. Nunca deja a la app sin datos por estar offline.
 */
export async function cargarCatalogo(url = 'datos/catalogo.json') {
  const local = await leerCatalogo().catch(() => null);

  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) {
      const remoto = await res.json();
      if (!local || remoto.version !== local.version) {
        await guardarCatalogo(remoto);
        return { catalogo: remoto, origen: local ? 'actualizado' : 'descargado' };
      }
    }
  } catch {
    // Sin red: seguimos con lo que haya guardado. Es el caso normal en el local.
  }

  if (local) return { catalogo: local, origen: 'local' };
  throw new Error('No hay catálogo guardado y no se pudo descargar. Conectate una vez para sincronizar.');
}

// ---------- pedidos que esperan a Wix ----------

export const guardarPendiente = (pedido) =>
  transaccion(PENDIENTES, 'readwrite', (s) => s.put(pedido));

export const listarPendientes = () =>
  transaccion(PENDIENTES, 'readonly', (s) => s.getAll());

export const borrarPendiente = (id) =>
  transaccion(PENDIENTES, 'readwrite', (s) => s.delete(id));
