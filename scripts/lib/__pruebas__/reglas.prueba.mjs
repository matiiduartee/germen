/**
 * Los productos de acá salen del catálogo real de Germinando Nativas, elegidos
 * porque cubren los tres casos de stock que existen hoy en la tienda:
 *   - Acacia café: todo sin stock (0)
 *   - Salvia azul: una variante con 13, otra en -2 (vendida de más)
 *   - Mburucuyá: única variante con 2
 *   - Maceta Cilindro: 6 medidas, sólo la Nº12 con stock
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  varianteVendible, stockDisponible, productoVendible, estadoStock,
  buscarVariante, agregarAlPedido, quitarDelPedido, totalDelPedido,
  pedidoVacio, filtrarPorRespuestas, ordenarParaMostrador, pesos,
} from '../../../app/js/reglas.mjs';

const ACACIA = {
  id: 'acacia', nombre: 'Acacia café (Sesbania virgata)', visible: true,
  colecciones: ['sol-pleno', 'arbustos'],
  variantes: [{ id: 'a1', opciones: { Maceta: 'Plástica de vivero', 'Tamaño': 'Entre 100 y 130 cm.' },
    sku: 'SES-VIR-10L', precio: 36000, precioConDescuento: 36000, visible: true, stock: 0, hayStock: false }],
};

const SALVIA = {
  id: 'salvia', nombre: 'Salvia azul (Salvia guaranitica)', visible: true,
  colecciones: ['sol-pleno', 'picaflores', 'florales'],
  variantes: [
    { id: 's1', opciones: { Maceta: 'Plástica de vivero', 'Tamaño': 'Entre 30 y 40 cm.' },
      sku: 'SAL-GUA-N14', precio: 9500, precioConDescuento: 9500, visible: true, stock: -2, hayStock: false },
    { id: 's2', opciones: { Maceta: 'Plástica de vivero', 'Tamaño': 'Entre 40 y 60 cm.' },
      sku: 'SAL-GUA-3L', precio: 9000, precioConDescuento: 9000, visible: true, stock: 13, hayStock: true },
  ],
};

const MBURUCUYA = {
  id: 'mburu', nombre: 'Mburucuyá (Passiflora caerulea)', visible: true,
  colecciones: ['sol-pleno', 'enredaderas', 'mariposas'],
  variantes: [{ id: 'm1', opciones: { Maceta: 'Plástica de vivero', 'Tamaño': 'Entre 30 y 40 cm.' },
    sku: 'PAS-CAE-N14', precio: 13000, precioConDescuento: 13000, visible: true, stock: 2, hayStock: true }],
};

const GUIA_DIGITAL = {
  id: 'guia', nombre: 'Guía de Cuidados', visible: true, colecciones: ['insumos'],
  variantes: [], stockProducto: { seSigue: false, cantidad: null, hayStock: true },
};

test('una variante vendida de más (stock negativo) no es vendible', () => {
  assert.equal(varianteVendible(SALVIA.variantes[0]), false);
  assert.equal(stockDisponible(SALVIA.variantes[0]), 0);
});

test('stockDisponible nunca devuelve negativo', () => {
  assert.equal(stockDisponible({ visible: true, hayStock: true, stock: -5 }), 0);
  assert.equal(stockDisponible({ visible: true, hayStock: true, stock: 13 }), 13);
});

test('sin cantidad conocida el stock no tiene tope', () => {
  assert.equal(stockDisponible({ visible: true, hayStock: true, stock: null }), null);
});

test('el estado de stock distingue disponible, parcial y sin stock', () => {
  assert.equal(estadoStock(ACACIA), 'sin-stock');
  assert.equal(estadoStock(SALVIA), 'parcial');
  assert.equal(estadoStock(MBURUCUYA), 'disponible');
  assert.equal(estadoStock(GUIA_DIGITAL), 'disponible');
});

test('un producto sin ninguna variante con stock no es vendible', () => {
  assert.equal(productoVendible(ACACIA), false);
  assert.equal(productoVendible(SALVIA), true);
  assert.equal(productoVendible(GUIA_DIGITAL), true);
});

test('busca la variante por la combinación exacta de opciones', () => {
  const v = buscarVariante(SALVIA, { Maceta: 'Plástica de vivero', 'Tamaño': 'Entre 40 y 60 cm.' });
  assert.equal(v.sku, 'SAL-GUA-3L');
  // una combinación incompleta no debe resolver a nada
  assert.equal(buscarVariante(SALVIA, { Maceta: 'Plástica de vivero' }), null);
  assert.equal(buscarVariante(SALVIA, {}), null);
});

test('bloquea agregar al pedido una variante sin stock', () => {
  const r = agregarAlPedido(pedidoVacio(), ACACIA, ACACIA.variantes[0]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /no tiene stock/);
  assert.deepEqual(r.pedido.lineas, []);
});

test('no deja pasarse del stock disponible, ni de a una ni acumulando', () => {
  let p = pedidoVacio();
  const v = MBURUCUYA.variantes[0];  // stock 2

  let r = agregarAlPedido(p, MBURUCUYA, v, 2);
  assert.equal(r.ok, true);
  p = r.pedido;

  r = agregarAlPedido(p, MBURUCUYA, v, 1);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Ya cargaste las 2/);
  assert.equal(r.pedido.lineas[0].cantidad, 2, 'el pedido no debe cambiar si se rechaza');
});

test('avisa cuántas quedan cuando se pide de más', () => {
  const r = agregarAlPedido(pedidoVacio(), MBURUCUYA, MBURUCUYA.variantes[0], 5);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Sólo quedan 2/);
});

test('agregar dos veces la misma variante suma en una sola línea', () => {
  let p = pedidoVacio();
  p = agregarAlPedido(p, SALVIA, SALVIA.variantes[1], 1).pedido;
  p = agregarAlPedido(p, SALVIA, SALVIA.variantes[1], 2).pedido;
  assert.equal(p.lineas.length, 1);
  assert.equal(p.lineas[0].cantidad, 3);
});

test('rechaza cantidades que no son enteros positivos', () => {
  for (const mala of [0, -1, 1.5, NaN]) {
    const r = agregarAlPedido(pedidoVacio(), MBURUCUYA, MBURUCUYA.variantes[0], mala);
    assert.equal(r.ok, false, `debería rechazar ${mala}`);
  }
});

test('el total suma precio por cantidad de cada línea', () => {
  let p = pedidoVacio();
  p = agregarAlPedido(p, SALVIA, SALVIA.variantes[1], 2).pedido;   // 9000 x2
  p = agregarAlPedido(p, MBURUCUYA, MBURUCUYA.variantes[0], 1).pedido; // 13000
  assert.equal(totalDelPedido(p), 31000);

  p = quitarDelPedido(p, 'm1');
  assert.equal(totalDelPedido(p), 18000);
  assert.equal(p.lineas.length, 1);
});

test('el recorrido guiado cruza los pasos: intersección entre pasos, unión adentro', () => {
  const todos = [ACACIA, SALVIA, MBURUCUYA, GUIA_DIGITAL];

  // un solo paso: unión
  assert.deepEqual(
    filtrarPorRespuestas(todos, { luz: { colecciones: ['sol-pleno'] } }).map((p) => p.id),
    ['acacia', 'salvia', 'mburu']);

  // dos pasos: hay que cumplir los dos
  assert.deepEqual(
    filtrarPorRespuestas(todos, {
      luz: { colecciones: ['sol-pleno'] },
      objetivo: { colecciones: ['mariposas', 'picaflores'] },
    }).map((p) => p.id),
    ['salvia', 'mburu']);

  // sin respuestas, no filtra nada
  assert.equal(filtrarPorRespuestas(todos, {}).length, 4);
  // un paso saltado no debe filtrar
  assert.equal(filtrarPorRespuestas(todos, { luz: { colecciones: [] } }).length, 4);
});

test('ordena poniendo primero lo que se puede vender hoy', () => {
  const orden = ordenarParaMostrador([ACACIA, SALVIA, MBURUCUYA]).map((p) => p.id);
  assert.deepEqual(orden, ['mburu', 'salvia', 'acacia']);
});

test('los precios se muestran en pesos argentinos', () => {
  const s = pesos(36000);
  assert.match(s, /36\.000/);
  assert.ok(s.includes('$'), `esperaba símbolo de peso en "${s}"`);
});
