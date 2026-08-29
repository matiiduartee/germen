/**
 * Reglas de negocio del mostrador. Puras, sin DOM y sin red, para poder probarlas.
 *
 * Decisiones que codifican (ver docs/decisiones.md):
 *  - Todo el catálogo se puede MIRAR. El bloqueo es sólo para VENDER.
 *  - El stock y el precio viven en la variante, nunca en el producto.
 *  - El cobro ocurre fuera de Wix; el pedido se registra ya pagado.
 */

/** Una variante se puede vender si está visible y tiene stock. */
export function varianteVendible(variante) {
  return variante.visible !== false && variante.hayStock === true;
}

/** Cuántas unidades se pueden vender de una variante. `null` = sin límite conocido. */
export function stockDisponible(variante) {
  if (!varianteVendible(variante)) return 0;
  // Wix devuelve cantidades negativas cuando se vendió de más: se tratan como cero.
  if (typeof variante.stock !== 'number') return null;
  return Math.max(0, variante.stock);
}

/** Un producto es vendible si alguna de sus variantes lo es. */
export function productoVendible(producto) {
  if (producto.visible === false) return false;
  if (producto.variantes?.length) return producto.variantes.some(varianteVendible);
  return producto.stockProducto?.hayStock === true;
}

/**
 * Estado de un producto para la grilla. Se muestran los tres:
 * el cliente ve todo el catálogo, pero sólo se cobra lo disponible.
 */
export function estadoStock(producto) {
  if (!producto.variantes?.length) {
    return producto.stockProducto?.hayStock ? 'disponible' : 'sin-stock';
  }
  const vendibles = producto.variantes.filter(varianteVendible).length;
  if (vendibles === 0) return 'sin-stock';
  if (vendibles < producto.variantes.length) return 'parcial';
  return 'disponible';
}

/** Busca la variante que corresponde a una combinación de opciones elegida. */
export function buscarVariante(producto, opcionesElegidas) {
  const claves = Object.keys(opcionesElegidas);
  return producto.variantes?.find((v) =>
    claves.length > 0 &&
    claves.every((k) => v.opciones?.[k] === opcionesElegidas[k]) &&
    Object.keys(v.opciones ?? {}).length === claves.length
  ) ?? null;
}

/** Precio efectivo de una variante: el con descuento si existe, si no el de lista. */
export function precioDe(variante) {
  return variante.precioConDescuento ?? variante.precio ?? 0;
}

/**
 * Intenta agregar una línea al pedido. Devuelve `{ ok, pedido, motivo }`.
 * Nunca lanza: el mostrador necesita un mensaje, no una excepción.
 */
export function agregarAlPedido(pedido, producto, variante, cantidad = 1) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return { ok: false, pedido, motivo: 'La cantidad tiene que ser un entero de 1 o más.' };
  }
  if (!varianteVendible(variante)) {
    return { ok: false, pedido, motivo: `«${producto.nombre}» no tiene stock en esa opción.` };
  }

  const lineas = [...pedido.lineas];
  const i = lineas.findIndex((l) => l.varianteId === variante.id);
  const yaEnPedido = i >= 0 ? lineas[i].cantidad : 0;
  const tope = stockDisponible(variante);

  if (tope !== null && yaEnPedido + cantidad > tope) {
    const restan = tope - yaEnPedido;
    return {
      ok: false,
      pedido,
      motivo: restan > 0
        ? `Sólo quedan ${restan} de «${producto.nombre}».`
        : `Ya cargaste las ${tope} unidades disponibles de «${producto.nombre}».`,
    };
  }

  if (i >= 0) {
    lineas[i] = { ...lineas[i], cantidad: yaEnPedido + cantidad };
  } else {
    lineas.push({
      productoId: producto.id,
      varianteId: variante.id,
      nombre: producto.nombre,
      opciones: variante.opciones ?? {},
      sku: variante.sku ?? '',
      precioUnitario: precioDe(variante),
      cantidad,
    });
  }
  return { ok: true, pedido: { ...pedido, lineas }, motivo: null };
}

export function quitarDelPedido(pedido, varianteId) {
  return { ...pedido, lineas: pedido.lineas.filter((l) => l.varianteId !== varianteId) };
}

export function totalDelPedido(pedido) {
  return pedido.lineas.reduce((a, l) => a + l.precioUnitario * l.cantidad, 0);
}

export function pedidoVacio() {
  return { lineas: [], cliente: null, nota: '' };
}

/**
 * Filtra el catálogo según las respuestas del recorrido guiado.
 * Cada paso aporta IDs de colección; un producto entra si pertenece a
 * al menos una colección de CADA paso respondido (intersección entre pasos,
 * unión dentro de un paso).
 */
export function filtrarPorRespuestas(productos, respuestas) {
  const grupos = Object.values(respuestas)
    .filter((r) => Array.isArray(r?.colecciones) && r.colecciones.length > 0)
    .map((r) => r.colecciones);

  if (grupos.length === 0) return productos;

  return productos.filter((p) => {
    const suyas = new Set(p.colecciones ?? []);
    return grupos.every((grupo) => grupo.some((id) => suyas.has(id)));
  });
}

/**
 * Ordena los resultados del recorrido: primero lo que se puede vender hoy.
 * Sin esto el cliente elige justo lo que no hay, que es la queja clásica de mostrador.
 */
export function ordenarParaMostrador(productos) {
  const rango = { 'disponible': 0, 'parcial': 1, 'sin-stock': 2 };
  return [...productos].sort((a, b) => {
    const d = rango[estadoStock(a)] - rango[estadoStock(b)];
    return d !== 0 ? d : a.nombre.localeCompare(b.nombre, 'es');
  });
}

/** Formatea un precio en pesos, como lo muestra el sitio. */
export function pesos(monto) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2,
  }).format(monto ?? 0);
}
