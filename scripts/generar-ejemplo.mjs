#!/usr/bin/env node
/**
 * Arma app/datos/catalogo.json a partir de la muestra real del catálogo,
 * pasándola por la misma normalización que usa el sync contra Wix.
 *
 * Sirve para desarrollar y probar la app sin credenciales. Cuando corras
 * `npm run sync` contra Wix, ese catálogo completo reemplaza a éste.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizar, clasificarColecciones } from './lib/normalizar.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEN = join(RAIZ, 'scripts/lib/__pruebas__/muestra-real.json');
const DESTINO = join(RAIZ, 'app/datos/catalogo.json');

const muestra = JSON.parse(await readFile(ORIGEN, 'utf8'));
const productos = muestra.products.map(normalizar);
const { quiz, normales } = clasificarColecciones(muestra.collections);

const paquete = {
  generado: new Date().toISOString(),
  esMuestra: true,
  moneda: 'ARS',
  colecciones: normales,
  coleccionesQuiz: quiz,
  productos,
};
paquete.version = createHash('sha256')
  .update(JSON.stringify({ ...paquete, generado: null })).digest('hex').slice(0, 16);

await writeFile(DESTINO, JSON.stringify(paquete, null, 2));
console.log(`app/datos/catalogo.json — ${productos.length} productos de muestra, versión ${paquete.version}`);
