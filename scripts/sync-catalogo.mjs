#!/usr/bin/env node
/**
 * Baja el catálogo completo de Wix Stores (catálogo V1) y arma el paquete
 * que la tablet guarda en IndexedDB para funcionar sin internet.
 *
 *   node scripts/sync-catalogo.mjs [--imagenes]
 *
 * Variables de entorno (ver .env.example):
 *   WIX_API_KEY   clave de https://manage.wix.com/account/api-keys
 *   WIX_SITE_ID   id del sitio
 *
 * Con --imagenes además descarga las fotos redimensionadas a data/imagenes/,
 * para poder precachearlas en el service worker.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizar, clasificarColecciones } from './lib/normalizar.mjs';

const API = 'https://www.wixapis.com';
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'data');

function entorno() {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !siteId) {
    console.error('Faltan WIX_API_KEY y/o WIX_SITE_ID. Copiá .env.example a .env y completalo.');
    process.exit(1);
  }
  return { apiKey, siteId };
}

async function pedir(ruta, cuerpo, { apiKey, siteId }) {
  const res = await fetch(API + ruta, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
      'wix-site-id': siteId,
    },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) {
    throw new Error(`${ruta} respondió ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

/** Wix V1 pagina por offset y espera filter/sort como strings JSON, no como objetos. */
async function traerProductos(cred) {
  const productos = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const r = await pedir('/stores-reader/v1/products/query', {
      query: {
        sort: JSON.stringify([{ fieldName: 'name', order: 'ASC' }]),
        paging: { limit: 100, offset },
      },
      includeVariants: true,
    }, cred);

    const lote = r.products ?? [];
    total = r.totalResults ?? lote.length;
    productos.push(...lote);
    if (lote.length === 0) break;
    offset += lote.length;
    process.stdout.write(`\r  productos: ${productos.length}/${total}`);
  }
  process.stdout.write('\n');
  return productos;
}

async function traerColecciones(cred) {
  const r = await pedir('/stores-reader/v1/collections/query', {
    query: { paging: { limit: 100, offset: 0 } },
  }, cred);
  return r.collections ?? [];
}

async function bajarImagenes(productos) {
  const dir = join(SALIDA, 'imagenes');
  await mkdir(dir, { recursive: true });
  let n = 0;
  const total = productos.reduce((a, p) => a + p.fotos.length * 2, 0);

  for (const p of productos) {
    for (const foto of p.fotos) {
      for (const [uso, url] of [['grilla', foto.grilla], ['ficha', foto.ficha]]) {
        const res = await fetch(url);
        if (!res.ok) { console.warn(`\n  no se pudo bajar ${url} (${res.status})`); continue; }
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(join(dir, `${foto.id.replace(/[^\w.-]/g, '_')}.${uso}.jpg`), buf);
        process.stdout.write(`\r  imágenes: ${++n}/${total}`);
      }
    }
  }
  process.stdout.write('\n');
}

async function main() {
  const cred = entorno();
  const bajarFotos = process.argv.includes('--imagenes');

  console.log('Sincronizando catálogo de Wix…');
  const [crudos, colecciones] = await Promise.all([
    traerProductos(cred),
    traerColecciones(cred),
  ]);

  const productos = crudos.map(normalizar);
  const { quiz, normales } = clasificarColecciones(colecciones);

  const paquete = {
    generado: new Date().toISOString(),
    sitio: cred.siteId,
    moneda: 'ARS',
    colecciones: normales,
    coleccionesQuiz: quiz,
    productos,
  };
  // El hash es lo que consulta la tablet para saber si tiene que bajar de nuevo.
  // Se calcula sin `generado` para que dos corridas sin cambios den la misma versión.
  paquete.version = createHash('sha256')
    .update(JSON.stringify({ ...paquete, generado: null }))
    .digest('hex')
    .slice(0, 16);

  await mkdir(SALIDA, { recursive: true });
  await writeFile(join(SALIDA, 'catalogo.json'), JSON.stringify(paquete, null, 2));

  if (bajarFotos) await bajarImagenes(productos);

  const conStock = productos.filter((p) =>
    p.variantes.some((v) => v.hayStock) || p.stockProducto.hayStock).length;

  console.log(`
  versión      ${paquete.version}
  productos    ${productos.length} (${conStock} con stock)
  colecciones  ${normales.length} + ${quiz.length} de quiz
  archivo      data/catalogo.json`);
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
