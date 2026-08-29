/**
 * Prueba de la app entera en un navegador real.
 *
 *   npm run prueba:navegador
 *
 * Levanta un servidor estático sobre app/ y recorre el camino completo del
 * mostrador: recorrido guiado, ficha, tope de stock, buscador y cola offline.
 *
 * Nota: las fotos viven en el CDN de Wix. Si el entorno no llega a
 * static.wixstatic.com, las imágenes no cargan y la consola muestra 504.
 * No es un fallo de la app.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const PUERTO = 8099;

const TIPOS = {
  '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript',
  '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

const servidor = createServer(async (req, res) => {
  const pedido = decodeURIComponent(req.url.split('?')[0]);
  const ruta = pedido === '/' ? '/index.html' : pedido;
  try {
    const datos = await readFile(join(APP, ruta));
    res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] ?? 'application/octet-stream' });
    res.end(datos);
  } catch {
    res.writeHead(404).end('no está');
  }
});
await new Promise((r) => servidor.listen(PUERTO, r));

// Playwright trae su propio Chromium; si el entorno ya tiene uno, se usa ése.
const ejecutable = process.env.CHROMIUM_PATH;



const errores = [];
const nav = await chromium.launch(ejecutable ? { executablePath: ejecutable } : {});
// Tamaño real de la Lenovo Tab 11 en landscape (dp).
const ctx = await nav.newContext({ viewport: { width: 1200, height: 800 }, locale: 'es-AR' });
const pg = await ctx.newPage();
pg.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
pg.on('pageerror', (e) => errores.push('PAGEERROR: ' + e.message));

const paso = async (nombre, fn) => {
  try { await fn(); console.log(`  ok  ${nombre}`); }
  catch (e) { console.log(`  FALLA  ${nombre}: ${e.message}`); process.exitCode = 1; }
};

await pg.goto('http://localhost:8099/', { waitUntil: 'networkidle' });

await paso('carga el inicio con el conteo real', async () => {
  await pg.waitForSelector('.portada', { timeout: 5000 });
  const sub = await pg.textContent('.sub');
  if (!sub.includes('8 productos')) throw new Error(`subtítulo inesperado: ${sub}`);
  if (!sub.includes('7 con stock')) throw new Error(`stock esperado 7 vendibles, dice: ${sub}`);
});

await paso('el recorrido avanza solo al elegir opción única', async () => {
  await pg.click('[data-ir="#/recorrido"]');
  await pg.waitForSelector('.opcion');
  const p1 = await pg.textContent('h1');
  if (!p1.includes('¿Dónde va a vivir')) throw new Error(p1);
  await pg.click('.opcion:has-text("Al sol casi todo el día")');
  await pg.waitForFunction(() => document.querySelector('h1')?.textContent.includes('¿Qué estás buscando?'));
});

await paso('el recorrido filtra el catálogo por colección', async () => {
  await pg.click('.opcion:has-text("Una enredadera")');
  await pg.waitForSelector('.opcion:has-text("Atraer mariposas")');
  await pg.click('[data-saltear]');
  await pg.waitForSelector('.grilla');
  const tarjetas = await pg.$$eval('.ficha-mini .nombre', (n) => n.map((x) => x.textContent.trim()));
  // Sol pleno + Quiz Enredadera → Arvejilla y Mburucuyá
  if (tarjetas.length !== 2) throw new Error(`esperaba 2, vinieron ${tarjetas.length}: ${tarjetas}`);
  if (!tarjetas.some((t) => t.includes('Mburucuyá'))) throw new Error(`falta Mburucuyá: ${tarjetas}`);
});

await paso('la ficha muestra las secciones y el precio', async () => {
  await pg.click('.ficha-mini:has-text("Mburucuyá")');
  await pg.waitForSelector('.precio-grande');
  const precio = await pg.textContent('.precio-grande');
  if (!precio.includes('13.000')) throw new Error(`precio inesperado: ${precio}`);
  const secciones = await pg.$$eval('.secciones summary', (n) => n.length);
  if (secciones < 2) throw new Error(`esperaba secciones de ficha, hay ${secciones}`);
});

await paso('agrega al pedido y respeta el tope de stock (2 unidades)', async () => {
  await pg.click('[data-agregar]');
  await pg.click('[data-agregar]');
  await pg.waitForFunction(() => document.getElementById('pedido-cuenta').textContent === '2');
  await pg.click('[data-agregar]');   // la tercera debe rechazarse
  await pg.waitForSelector('.aviso.malo');
  const aviso = await pg.textContent('.aviso');
  if (!aviso.includes('Ya cargaste las 2')) throw new Error(`aviso inesperado: ${aviso}`);
  const cuenta = await pg.textContent('#pedido-cuenta');
  if (cuenta !== '2') throw new Error(`el contador se pasó a ${cuenta}`);
});

await paso('bloquea la variante sin stock en la ficha', async () => {
  await pg.click('.marca');
  await pg.click('[data-ir="#/catalogo"]');
  await pg.waitForSelector('.grilla');
  await pg.click('.ficha-mini:has-text("Maceta Blum")');
  await pg.waitForSelector('.valores');
  // La Nº12 tiene stock; el resto no y deben venir deshabilitadas.
  const deshabilitadas = await pg.$$eval('.valor[disabled]', (n) => n.map((x) => x.textContent.trim()));
  if (deshabilitadas.length !== 5) throw new Error(`esperaba 5 medidas sin stock, hay ${deshabilitadas.length}: ${deshabilitadas}`);
  if (deshabilitadas.includes('12')) throw new Error('la Nº12 tiene stock y quedó deshabilitada');
});

await paso('un producto totalmente sin stock no se puede agregar', async () => {
  await pg.click('.marca');
  await pg.click('[data-ir="#/catalogo"]');
  await pg.waitForSelector('.grilla');
  await pg.click('.ficha-mini:has-text("Acacia café")');
  await pg.waitForSelector('[data-agregar]');
  const texto = await pg.textContent('[data-agregar]');
  const off = await pg.getAttribute('[data-agregar]', 'disabled');
  if (off === null) throw new Error('el botón de agregar debería estar deshabilitado');
  if (!texto.includes('Sin stock')) throw new Error(`texto inesperado: ${texto}`);
});

await paso('el buscador filtra por nombre y por SKU', async () => {
  await pg.fill('#busqueda', 'SAL-GUA');
  await pg.waitForFunction(() => document.querySelectorAll('.ficha-mini').length === 1);
  const n = await pg.textContent('.ficha-mini .nombre');
  if (!n.includes('Salvia azul')) throw new Error(n);
});

await paso('el pedido calcula el total y pide el email', async () => {
  await pg.fill('#busqueda', '');
  await pg.click('[data-ir="#/pedido"]');
  await pg.waitForSelector('.total');
  const total = await pg.textContent('.total');
  if (!total.includes('26.000')) throw new Error(`total esperado 26.000 (2 x 13.000), dice: ${total}`);
  await pg.click('[data-confirmar]');
  await pg.waitForSelector('.aviso.malo');
  const aviso = await pg.textContent('.aviso');
  if (!aviso.includes('email')) throw new Error(aviso);
});

await paso('vaciar el buscador no saca al vendedor de la pantalla del pedido', async () => {
  // Regresión: el debounce del buscador forzaba location.hash = '#/catalogo'
  // aunque el usuario ya se hubiera movido, y en mitad de cerrar una venta
  // te mandaba de vuelta a la grilla.
  await pg.fill('#busqueda', 'salvia');
  await pg.waitForFunction(() => location.hash.startsWith('#/catalogo'));
  await pg.fill('#busqueda', '');
  await pg.click('[data-ir="#/pedido"]');
  await pg.waitForSelector('.total');
  await pg.waitForTimeout(400);   // más que el debounce de 180 ms
  const hash = await pg.evaluate(() => location.hash);
  if (!hash.startsWith('#/pedido')) throw new Error(`se fue a ${hash}`);
});

await paso('sin conexión el pedido se encola en vez de perderse', async () => {
  await pg.fill('#cli-email', 'cliente@ejemplo.com');
  await pg.fill('#cli-nombre', 'Cliente de prueba');
  // Sin proxy configurado, enviar falla y debe encolar.
  await pg.click('[data-confirmar]');
  await pg.waitForFunction(() => location.hash === '#/inicio', { timeout: 5000 });
  const cuenta = await pg.textContent('#pedido-cuenta');
  if (cuenta !== '0') throw new Error('el pedido debería haberse vaciado tras encolar');
  const cola = await pg.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('germen', 1);
    r.onsuccess = () => {
      const req = r.result.transaction('pendientes').objectStore('pendientes').getAll();
      req.onsuccess = () => res(req.result);
    };
  }));
  if (cola.length !== 1) throw new Error(`esperaba 1 pendiente, hay ${cola.length}`);
  if (cola[0].lineas[0].cantidad !== 2) throw new Error('la línea encolada no coincide');
});


if (errores.length) { console.log('\nErrores de consola:'); errores.forEach((e) => console.log('  ' + e)); }
await nav.close();
servidor.close();
