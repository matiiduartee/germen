/**
 * Transformaciones puras del catálogo de Wix al formato que usa la tablet.
 * Están separadas del script de sync para poder probarlas con payloads reales,
 * sin red y sin credenciales.
 */

// Ancho al que se sirven las fotos en la tablet. La Lenovo Tab 11 es 2000x1200:
// 800px alcanza para la ficha y pesa una fracción del original.
export const ANCHO_FICHA = 800;
export const ANCHO_GRILLA = 400;

/** Reescribe una URL de static.wixstatic.com al ancho que necesitamos. */
export function redimensionar(url, ancho) {
  return url.replace(/\/v1\/fit\/w_\d+,h_\d+,q_\d+\//, `/v1/fit/w_${ancho},h_${ancho},q_85/`);
}

export function imagenesDe(producto) {
  const items = producto.media?.items ?? [];
  return items
    .filter((i) => i.mediaType === 'image' && i.image?.url)
    .map((i) => ({
      id: i.id,
      grilla: redimensionar(i.image.url, ANCHO_GRILLA),
      ficha: redimensionar(i.image.url, ANCHO_FICHA),
    }));
}

/**
 * Aplana el producto a lo que la tablet realmente usa. El payload de Wix trae
 * mucho campo que no se muestra nunca y que sólo engorda la base local.
 */
export function normalizar(producto) {
  // Con manageVariants el precio y el stock viven en la variante, no en el producto.
  const variantes = (producto.variants ?? []).map((v) => ({
    id: v.id,
    opciones: v.choices ?? {},
    sku: v.variant?.sku ?? '',
    precio: v.variant?.priceData?.price ?? null,
    precioConDescuento: v.variant?.priceData?.discountedPrice ?? null,
    visible: v.variant?.visible !== false,
    stock: v.stock?.quantity ?? null,
    hayStock: v.stock?.inStock ?? false,
  }));

  return {
    id: producto.id,
    nombre: producto.name,
    slug: producto.slug,
    visible: producto.visible,
    tipo: producto.productType,
    marca: producto.brand ?? '',
    descripcionHtml: producto.description ?? '',
    secciones: (producto.additionalInfoSections ?? []).map((s) => ({
      titulo: s.title,
      html: s.description,
    })),
    opciones: (producto.productOptions ?? []).map((o) => ({
      nombre: o.name,
      tipo: o.optionType,
      valores: (o.choices ?? []).map((c) => ({
        valor: c.value,
        visible: c.visible !== false,
        hayStock: c.inStock ?? false,
      })),
    })),
    manejaVariantes: producto.manageVariants === true,
    variantes,
    precioDesde: producto.priceRange?.minValue ?? producto.price?.price ?? null,
    precioHasta: producto.priceRange?.maxValue ?? producto.price?.price ?? null,
    moneda: producto.price?.currency ?? 'ARS',
    stockProducto: {
      seSigue: producto.stock?.trackInventory ?? false,
      cantidad: producto.stock?.quantity ?? null,
      hayStock: producto.stock?.inStock ?? false,
    },
    colecciones: producto.collectionIds ?? [],
    fotos: imagenesDe(producto),
    urlEnSitio: producto.productPageUrl
      ? producto.productPageUrl.base.replace(/\/$/, '') + producto.productPageUrl.path
      : null,
    actualizado: producto.lastUpdated ?? null,
  };
}

/**
 * Las colecciones "Quiz *" son el destino del recorrido guiado del sitio.
 * Separarlas acá le da a la tablet el mapa tipo-de-planta → productos sin
 * tener que adivinar por nombre en tiempo de ejecución.
 */
export function clasificarColecciones(colecciones) {
  const quiz = [];
  const normales = [];
  for (const c of colecciones) {
    const item = { id: c.id, nombre: c.name, slug: c.slug ?? null };
    if (/^quiz\s/i.test(c.name)) {
      quiz.push({ ...item, tipo: c.name.replace(/^quiz\s+/i, '').trim() });
    } else {
      normales.push(item);
    }
  }
  return { quiz, normales };
}
