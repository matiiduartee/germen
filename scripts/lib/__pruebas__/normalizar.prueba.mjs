/**
 * Se corre con: node --test scripts/lib/__pruebas__/
 *
 * El fixture es un recorte fiel de lo que devolvió de verdad
 * /stores-reader/v1/products/query para el sitio de Germinando Nativas,
 * así que las aserciones validan contra la forma real del catálogo V1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizar, clasificarColecciones, redimensionar } from '../normalizar.mjs';

const PRODUCTO_REAL = {
  id: '04ce80f1-aa0a-87fc-ccf4-dc212aa861ce',
  name: 'Acacia café (Sesbania virgata)',
  slug: 'acacia-café-sesbania-virgata',
  visible: true,
  productType: 'physical',
  description: '<p><span>☀️ Sol: pleno</span></p>',
  stock: { trackInventory: true, quantity: 0, inStock: false, inventoryStatus: 'OUT_OF_STOCK' },
  price: { currency: 'ARS', price: 36000, discountedPrice: 36000 },
  priceRange: { minValue: 36000, maxValue: 36000 },
  additionalInfoSections: [
    { title: '🦋 Beneficios y usos en el paisaje', description: '<p>La <strong>Acacia café</strong>…</p>' },
    { title: '📦 ¿Qué recibís con tu compra?', description: '<p>Vas a recibir una planta viva…</p>' },
  ],
  media: {
    items: [{
      mediaType: 'image',
      id: '9377b6_ddd42a94eb414545904463f541358904~mv2.jpg',
      image: {
        url: 'https://static.wixstatic.com/media/9377b6_ddd42a94eb414545904463f541358904~mv2.jpg/v1/fit/w_1024,h_683,q_90/file.jpg',
        width: 1024, height: 683,
      },
    }],
  },
  manageVariants: true,
  productOptions: [
    { optionType: 'drop_down', name: 'Maceta', choices: [{ value: 'Plástica de vivero', inStock: false, visible: true }] },
    { optionType: 'drop_down', name: 'Tamaño', choices: [{ value: 'Entre 100 y 130 cm.', inStock: false, visible: true }] },
  ],
  variants: [{
    id: 'f6c19d63-77a9-4bdd-843f-431e8e532738',
    choices: { Maceta: 'Plástica de vivero', 'Tamaño': 'Entre 100 y 130 cm.' },
    variant: { priceData: { currency: 'ARS', price: 36000, discountedPrice: 36000 }, sku: 'SES-VIR-10L', visible: true },
    stock: { trackQuantity: true, quantity: 0, inStock: false },
  }],
  productPageUrl: { base: 'https://www.germinandonativas.com/', path: '/product-page/acacia-café-sesbania-virgata' },
  collectionIds: ['787c59ec-fb9b-8c59-a5b8-0f5e6c7cc359', '059eb0da-3842-4a5d-83fd-62e59bee86db'],
  brand: 'Germinando Nativas',
  lastUpdated: '2026-08-27T19:40:43.074Z',
};

test('toma precio y SKU de la variante, no del producto', () => {
  const p = normalizar(PRODUCTO_REAL);
  assert.equal(p.manejaVariantes, true);
  assert.equal(p.variantes.length, 1);
  assert.equal(p.variantes[0].sku, 'SES-VIR-10L');
  assert.equal(p.variantes[0].precio, 36000);
  assert.deepEqual(p.variantes[0].opciones, { Maceta: 'Plástica de vivero', 'Tamaño': 'Entre 100 y 130 cm.' });
});

test('conserva las secciones de ficha que usa el sitio', () => {
  const p = normalizar(PRODUCTO_REAL);
  assert.equal(p.secciones.length, 2);
  assert.equal(p.secciones[0].titulo, '🦋 Beneficios y usos en el paisaje');
  assert.match(p.secciones[0].html, /Acacia café/);
});

test('reescribe las URLs de wixstatic a los anchos de la tablet', () => {
  const p = normalizar(PRODUCTO_REAL);
  assert.equal(p.fotos.length, 1);
  assert.match(p.fotos[0].grilla, /\/v1\/fit\/w_400,h_400,q_85\//);
  assert.match(p.fotos[0].ficha, /\/v1\/fit\/w_800,h_800,q_85\//);
  // el resto de la URL tiene que quedar intacto
  assert.match(p.fotos[0].ficha, /^https:\/\/static\.wixstatic\.com\/media\/9377b6_/);
  assert.match(p.fotos[0].ficha, /\/file\.jpg$/);
});

test('no rompe si el producto no tiene variantes ni fotos', () => {
  const digital = {
    id: 'x', name: 'Guía de Cuidados', slug: 'guia', visible: true,
    productType: 'digital', manageVariants: false,
    price: { currency: 'ARS', price: 0, discountedPrice: 0 },
    stock: { trackInventory: false, inStock: true },
  };
  const p = normalizar(digital);
  assert.deepEqual(p.variantes, []);
  assert.deepEqual(p.fotos, []);
  assert.deepEqual(p.secciones, []);
  assert.equal(p.precioDesde, 0);
  assert.equal(p.stockProducto.hayStock, true);
  assert.equal(p.urlEnSitio, null);
});

test('arma la URL del producto en el sitio sin barra doble', () => {
  const p = normalizar(PRODUCTO_REAL);
  assert.equal(p.urlEnSitio, 'https://www.germinandonativas.com/product-page/acacia-café-sesbania-virgata');
});

test('separa las colecciones de quiz de las de catálogo', () => {
  const { quiz, normales } = clasificarColecciones([
    { id: '1', name: 'Árboles' },
    { id: '2', name: 'Quiz Arbol' },
    { id: '3', name: 'Quiz Acuatica' },
    { id: '4', name: 'Sol pleno' },
    { id: '5', name: 'Quizás algo' },  // no debe contarse como quiz: no hay espacio tras "Quiz"
  ]);
  assert.deepEqual(quiz.map((c) => c.tipo), ['Arbol', 'Acuatica']);
  assert.deepEqual(normales.map((c) => c.nombre), ['Árboles', 'Sol pleno', 'Quizás algo']);
});

test('redimensionar deja intacta una URL que no es de wixstatic', () => {
  const otra = 'https://ejemplo.com/foto.jpg';
  assert.equal(redimensionar(otra, 400), otra);
});
