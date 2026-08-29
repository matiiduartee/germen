/**
 * Mostrador de Germinando Nativas.
 *
 * Una sola app para dos usos, como se atiende en el local:
 *  - el recorrido guiado, que hace las mismas preguntas que se hacen en persona
 *  - la vista de mostrador, para buscar rápido y cerrar el pedido
 *
 * Todo lo que se navega sale del catálogo guardado en la tablet. Internet se usa
 * solamente para sincronizar el catálogo y para mandar el pedido a Wix.
 */

import { cargarCatalogo } from './almacen.mjs';
import {
  estadoStock, productoVendible, varianteVendible, stockDisponible,
  buscarVariante, precioDe, agregarAlPedido, quitarDelPedido, totalDelPedido,
  pedidoVacio, filtrarPorRespuestas, ordenarParaMostrador, pesos,
} from './reglas.mjs';
import {
  armarEnvio, enviarOEncolar, reintentarPendientes, listarPendientes,
  configuracion, configurar,
} from './pedidos.mjs';

const pantalla = document.getElementById('pantalla');
const avisoEl = document.getElementById('aviso');

const estado = {
  catalogo: null,
  recorrido: null,
  pedido: pedidoVacio(),
  respuestas: {},   // respuestas del recorrido guiado
  paso: 0,
  filtro: null,     // id de colección elegida en la grilla
  busqueda: '',
};

// ---------- utilidades ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let avisoTimer;
function avisar(texto, malo = false) {
  clearTimeout(avisoTimer);
  avisoEl.textContent = texto;
  avisoEl.classList.toggle('malo', malo);
  avisoEl.hidden = false;
  avisoTimer = setTimeout(() => { avisoEl.hidden = true; }, malo ? 4200 : 2600);
}

const productoPorId = (id) => estado.catalogo.productos.find((p) => p.id === id);

/** Nombre de colección por id, para los chips de filtro. */
function nombreColeccion(id) {
  return estado.catalogo.colecciones.find((c) => c.id === id)?.nombre ?? '';
}

/** El primer párrafo de la descripción trae los íconos ☀️💧📏 — sirve de resumen. */
function resumenDe(producto) {
  const lineas = [...(producto.descripcionHtml ?? '').matchAll(/<p[^>]*>(.*?)<\/p>/gs)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  return lineas.slice(0, 5);
}

function foto(producto, uso = 'grilla') {
  return producto.fotos?.[0]?.[uso] ?? null;
}

function actualizarCabecera() {
  const n = estado.pedido.lineas.reduce((a, l) => a + l.cantidad, 0);
  document.getElementById('pedido-cuenta').textContent = String(n);

  const el = document.getElementById('estado-catalogo');
  if (!estado.catalogo) { el.textContent = ''; return; }
  const dias = Math.floor((Date.now() - new Date(estado.catalogo.generado)) / 86400000);
  const viejo = dias >= 2;
  el.textContent = estado.catalogo.esMuestra
    ? 'catálogo de muestra'
    : dias <= 0 ? 'catálogo de hoy' : `catálogo de hace ${dias} día${dias > 1 ? 's' : ''}`;
  el.classList.toggle('viejo', viejo || estado.catalogo.esMuestra);
}

// ---------- vistas ----------

function verInicio() {
  const total = estado.catalogo.productos.length;
  const vendibles = estado.catalogo.productos.filter(productoVendible).length;

  pantalla.innerHTML = `
    <h1>¿En qué andamos?</h1>
    <p class="sub">${total} productos en el catálogo · ${vendibles} con stock para vender hoy</p>
    <div class="portada">
      <button class="tarjeta-grande destacada" data-ir="#/recorrido">
        <span class="emoji">🧭</span>
        <strong>Empezar el recorrido</strong>
        <span class="texto">Tres preguntas para llegar a las plantas que le sirven a esta persona.</span>
      </button>
      <button class="tarjeta-grande" data-ir="#/catalogo">
        <span class="emoji">📖</span>
        <strong>Ver todo el catálogo</strong>
        <span class="texto">Toda la tienda, con las fotos y las fichas de la web.</span>
      </button>
      <button class="tarjeta-grande" data-ir="#/pedido">
        <span class="emoji">🧺</span>
        <strong>Ir al pedido</strong>
        <span class="texto">Cerrar la venta y registrarla en Wix.</span>
      </button>
    </div>
    <p style="margin-top:36px"><button class="volver" data-ir="#/ajustes">⚙️ Ajustes del dispositivo</button></p>
  `;
}

function verRecorrido() {
  const pasos = estado.recorrido.pasos;
  const paso = pasos[estado.paso];

  if (!paso) { location.hash = '#/resultados'; return; }

  const elegidas = estado.respuestas[paso.id]?.opciones ?? [];

  pantalla.innerHTML = `
    <button class="volver" data-atras>← ${estado.paso === 0 ? 'Salir del recorrido' : 'Pregunta anterior'}</button>
    <div class="progreso">${pasos.map((_, i) =>
      `<i class="${i <= estado.paso ? 'hecho' : ''}"></i>`).join('')}</div>
    <h1>${esc(paso.pregunta)}</h1>
    <p class="sub">${esc(paso.ayuda ?? '')}</p>
    <div class="opciones">
      ${paso.opciones.map((o, i) => `
        <button class="opcion" data-opcion="${i}" aria-pressed="${elegidas.includes(i)}">
          <span class="emoji">${o.icono ?? '•'}</span>
          <span>
            <strong>${esc(o.etiqueta)}</strong>
            ${o.detalle ? `<small>${esc(o.detalle)}</small>` : ''}
          </span>
        </button>`).join('')}
    </div>
    <div class="acciones">
      <button class="boton" data-seguir ${!paso.opcional && elegidas.length === 0 ? 'disabled' : ''}>
        ${estado.paso === pasos.length - 1 ? 'Ver las plantas' : 'Seguir'}
      </button>
      ${paso.opcional ? '<button class="boton secundario" data-saltear>Saltear</button>' : ''}
    </div>
  `;
}

function elegirOpcion(indice) {
  const paso = estado.recorrido.pasos[estado.paso];
  const actual = estado.respuestas[paso.id]?.opciones ?? [];

  const nuevas = paso.multiple
    ? (actual.includes(indice) ? actual.filter((i) => i !== indice) : [...actual, indice])
    : [indice];

  estado.respuestas[paso.id] = {
    opciones: nuevas,
    colecciones: nuevas.flatMap((i) => paso.opciones[i].colecciones ?? []),
  };

  // Con opción única no hace falta confirmar: se avanza solo, como en una charla.
  if (!paso.multiple) avanzarPaso();
  else verRecorrido();
}

function avanzarPaso() {
  if (estado.paso >= estado.recorrido.pasos.length - 1) location.hash = '#/resultados';
  else { estado.paso++; verRecorrido(); }
}

function tarjeta(p) {
  const estadoP = estadoStock(p);
  const etiqueta = { 'disponible': 'Hay stock', 'parcial': 'Algunas medidas', 'sin-stock': 'Sin stock' }[estadoP];
  const img = foto(p);
  const precio = p.precioDesde === p.precioHasta
    ? pesos(p.precioDesde)
    : `desde ${pesos(p.precioDesde)}`;

  return `
    <button class="ficha-mini ${estadoP === 'sin-stock' ? 'agotado' : ''}" data-producto="${esc(p.id)}">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<img alt="">'}
      <span class="cuerpo">
        <span class="nombre">${esc(p.nombre)}</span>
        <span class="precio">${precio}</span>
        <span class="marca-stock ${estadoP}">${etiqueta}</span>
      </span>
    </button>`;
}

function verResultados() {
  const encontrados = ordenarParaMostrador(
    filtrarPorRespuestas(estado.catalogo.productos, estado.respuestas));
  const conStock = encontrados.filter(productoVendible).length;

  pantalla.innerHTML = `
    <button class="volver" data-ir="#/recorrido">← Cambiar las respuestas</button>
    <h1>${encontrados.length ? `${encontrados.length} opciones para ese lugar` : 'No encontramos nada con esas respuestas'}</h1>
    <p class="sub">${encontrados.length
      ? `${conStock} con stock hoy. Las disponibles aparecen primero.`
      : 'Probá aflojando alguna respuesta, o mirá el catálogo completo.'}</p>
    ${encontrados.length
      ? `<div class="grilla">${encontrados.map(tarjeta).join('')}</div>`
      : `<div class="vacio"><button class="boton" data-ir="#/catalogo">Ver todo el catálogo</button></div>`}
  `;
}

function verCatalogo() {
  let lista = estado.catalogo.productos;

  if (estado.filtro) lista = lista.filter((p) => p.colecciones.includes(estado.filtro));
  if (estado.busqueda) {
    const q = estado.busqueda.toLowerCase();
    lista = lista.filter((p) =>
      p.nombre.toLowerCase().includes(q) ||
      p.variantes.some((v) => v.sku.toLowerCase().includes(q)));
  }
  lista = ordenarParaMostrador(lista);

  // Sólo las colecciones que tienen productos: los chips vacíos son ruido en mostrador.
  const conProductos = estado.catalogo.colecciones.filter((c) =>
    c.nombre !== 'All Products' && c.nombre !== 'Todos los productos' &&
    estado.catalogo.productos.some((p) => p.colecciones.includes(c.id)));

  pantalla.innerHTML = `
    <h1>Catálogo</h1>
    <p class="sub">${lista.length} de ${estado.catalogo.productos.length} productos${
      estado.busqueda ? ` para «${esc(estado.busqueda)}»` : ''}</p>
    <div class="filtros">
      <button class="chip" data-filtro="" aria-pressed="${!estado.filtro}">Todo</button>
      ${conProductos.map((c) => `
        <button class="chip" data-filtro="${esc(c.id)}" aria-pressed="${estado.filtro === c.id}">
          ${esc(c.nombre)}
        </button>`).join('')}
    </div>
    ${lista.length
      ? `<div class="grilla">${lista.map(tarjeta).join('')}</div>`
      : '<div class="vacio">No hay productos que coincidan.</div>'}
  `;
}

// Opciones elegidas en la ficha abierta.
let opcionesFicha = {};

function verProducto(id) {
  const p = productoPorId(id);
  if (!p) { location.hash = '#/catalogo'; return; }

  // Arranca preseleccionando la primera combinación con stock: es la que se vende.
  if (opcionesFicha.__producto !== id) {
    const primera = p.variantes.find(varianteVendible) ?? p.variantes[0];
    opcionesFicha = { __producto: id, ...(primera?.opciones ?? {}) };
  }

  const elegidas = { ...opcionesFicha };
  delete elegidas.__producto;
  const variante = buscarVariante(p, elegidas);
  const disponible = variante ? stockDisponible(variante) : 0;
  const vendible = variante ? varianteVendible(variante) : false;

  pantalla.innerHTML = `
    <button class="volver" data-atras>← Volver</button>
    <div class="ficha">
      <div class="fotos">
        ${p.fotos.length
          ? p.fotos.map((f) => `<img src="${esc(f.ficha)}" alt="${esc(p.nombre)}">`).join('')
          : '<img alt="">'}
      </div>
      <div>
        <h1>${esc(p.nombre)}</h1>
        <div class="resumen">${resumenDe(p).map((l) => `<p>${esc(l)}</p>`).join('')}</div>

        <div class="precio-grande">${variante ? pesos(precioDe(variante)) : pesos(p.precioDesde)}</div>

        ${p.opciones.map((op) => `
          <div class="selector">
            <h3>${esc(op.nombre)}</h3>
            <div class="valores">
              ${op.valores.map((v) => {
                // Una opción se deshabilita sólo si NINGUNA variante que la use tiene stock.
                const hay = p.variantes.some((va) =>
                  va.opciones?.[op.nombre] === v.valor && varianteVendible(va));
                return `<button class="valor" data-opcion-nombre="${esc(op.nombre)}"
                          data-opcion-valor="${esc(v.valor)}"
                          aria-pressed="${opcionesFicha[op.nombre] === v.valor}"
                          ${hay ? '' : 'disabled title="Sin stock"'}>${esc(v.valor)}</button>`;
              }).join('')}
            </div>
          </div>`).join('')}

        <div class="acciones">
          <button class="boton" data-agregar ${vendible ? '' : 'disabled'}>
            ${vendible ? 'Agregar al pedido' : 'Sin stock en esta opción'}
          </button>
          ${vendible && disponible !== null && disponible <= 5
            ? `<span style="align-self:center;color:var(--gris)">Quedan ${disponible}</span>` : ''}
        </div>

        <div class="secciones" style="margin-top:32px">
          ${p.secciones.map((s, i) => `
            <details ${i === 0 ? 'open' : ''}>
              <summary>${esc(s.titulo)}</summary>
              <div class="contenido">${s.html}</div>
            </details>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function verPedido() {
  const p = estado.pedido;
  const total = totalDelPedido(p);

  pantalla.innerHTML = `
    <button class="volver" data-ir="#/catalogo">← Seguir agregando</button>
    <h1>Pedido</h1>
    ${p.lineas.length === 0
      ? '<div class="vacio">Todavía no hay nada cargado.</div>'
      : `
      <div class="lineas">
        ${p.lineas.map((l) => `
          <div class="linea">
            <div class="desc">
              <strong>${esc(l.nombre)}</strong>
              <small>${esc(Object.values(l.opciones).join(' · '))}${l.sku ? ` · ${esc(l.sku)}` : ''}</small>
            </div>
            <div class="cantidad">
              <button data-menos="${esc(l.varianteId)}" aria-label="Quitar uno">−</button>
              <span>${l.cantidad}</span>
              <button data-mas="${esc(l.varianteId)}" aria-label="Agregar uno">+</button>
            </div>
            <div class="monto">${pesos(l.precioUnitario * l.cantidad)}</div>
            <button class="volver" data-quitar="${esc(l.varianteId)}" aria-label="Sacar del pedido">✕</button>
          </div>`).join('')}
      </div>

      <div class="total"><span>Total</span><span>${pesos(total)}</span></div>

      <h2>Datos de quien compra</h2>
      <label class="campo"><span>Nombre y apellido</span>
        <input id="cli-nombre" autocomplete="name" value="${esc(p.cliente?.nombre ?? '')}"></label>
      <label class="campo"><span>Email — para que le llegue la confirmación</span>
        <input id="cli-email" type="email" autocomplete="email" value="${esc(p.cliente?.email ?? '')}"></label>
      <label class="campo"><span>Teléfono (opcional)</span>
        <input id="cli-tel" type="tel" autocomplete="tel" value="${esc(p.cliente?.telefono ?? '')}"></label>
      <label class="campo"><span>Nota del pedido (opcional)</span>
        <textarea id="cli-nota" rows="2">${esc(p.nota ?? '')}</textarea></label>

      <h2>Cómo pagó</h2>
      <div class="valores" id="medios">
        ${['efectivo', 'transferencia', 'QR MercadoPago', 'posnet'].map((m, i) => `
          <button class="valor" data-medio="${m}" aria-pressed="${i === 0}">${m}</button>`).join('')}
      </div>

      <div class="acciones">
        <button class="boton" data-confirmar>Registrar el pedido en Wix</button>
        <button class="boton peligro" data-vaciar>Vaciar</button>
      </div>`}
    <div id="cola"></div>
  `;
  dibujarPendientes();
}

async function dibujarPendientes() {
  const cola = await listarPendientes().catch(() => []);
  const el = document.getElementById('cola');
  if (!el || cola.length === 0) return;
  el.innerHTML = `
    <div class="pendientes">
      <strong>${cola.length} pedido${cola.length > 1 ? 's' : ''} sin subir a Wix.</strong>
      Se guardaron en la tablet y se reintentan solos al volver la conexión.
      <div class="acciones"><button class="boton secundario" data-reintentar>Reintentar ahora</button></div>
    </div>`;
}

function verAjustes() {
  const cfg = configuracion() ?? {};
  pantalla.innerHTML = `
    <button class="volver" data-ir="#/inicio">← Volver</button>
    <h1>Ajustes del dispositivo</h1>
    <p class="sub">La tablet no guarda la clave de Wix. Sólo sabe a qué proxy hablarle.</p>
    <label class="campo"><span>Dirección del proxy</span>
      <input id="cfg-url" placeholder="https://www.germinandonativas.com/_functions/pedido"
             value="${esc(cfg.url ?? '')}"></label>
    <label class="campo"><span>Secreto de este dispositivo</span>
      <input id="cfg-secreto" value="${esc(cfg.secreto ?? '')}"></label>
    <div class="acciones"><button class="boton" data-guardar-cfg>Guardar</button></div>
    <h2>Catálogo</h2>
    <p class="sub">
      Versión ${esc(estado.catalogo.version)} · generado ${esc(estado.catalogo.generado)}<br>
      ${estado.catalogo.productos.length} productos.
      ${estado.catalogo.esMuestra ? '<strong>Es el catálogo de muestra</strong>, no el real.' : ''}
    </p>
  `;
}

// ---------- acciones del pedido ----------

function agregarActual() {
  const p = productoPorId(opcionesFicha.__producto);
  const elegidas = { ...opcionesFicha };
  delete elegidas.__producto;
  const variante = buscarVariante(p, elegidas);
  if (!variante) return avisar('Elegí todas las opciones.', true);

  const r = agregarAlPedido(estado.pedido, p, variante, 1);
  if (!r.ok) return avisar(r.motivo, true);

  estado.pedido = r.pedido;
  actualizarCabecera();
  avisar(`${p.nombre} — agregado`);
}

function cambiarCantidad(varianteId, delta) {
  const linea = estado.pedido.lineas.find((l) => l.varianteId === varianteId);
  if (!linea) return;

  if (delta < 0) {
    if (linea.cantidad <= 1) estado.pedido = quitarDelPedido(estado.pedido, varianteId);
    else linea.cantidad--;
  } else {
    const p = productoPorId(linea.productoId);
    const variante = p?.variantes.find((v) => v.id === varianteId);
    // Se vuelve a validar contra el stock: no alcanza con haber podido agregar antes.
    const r = agregarAlPedido(estado.pedido, p, variante, 1);
    if (!r.ok) return avisar(r.motivo, true);
    estado.pedido = r.pedido;
  }
  actualizarCabecera();
  verPedido();
}

function leerCliente() {
  const v = (id) => document.getElementById(id)?.value.trim() ?? '';
  estado.pedido.cliente = { nombre: v('cli-nombre'), email: v('cli-email'), telefono: v('cli-tel') };
  estado.pedido.nota = v('cli-nota');
}

async function confirmar(boton) {
  leerCliente();
  if (!estado.pedido.cliente.email) return avisar('Falta el email para poder registrar el pedido.', true);

  const medio = document.querySelector('#medios [aria-pressed="true"]')?.dataset.medio ?? 'efectivo';
  boton.disabled = true;
  boton.textContent = 'Registrando…';

  const r = await enviarOEncolar(armarEnvio(estado.pedido, { medioDePago: medio }));

  if (r.ok) {
    avisar(r.numero ? `Pedido #${r.numero} registrado en Wix` : 'Pedido registrado en Wix');
    estado.pedido = pedidoVacio();
    actualizarCabecera();
    location.hash = '#/inicio';
  } else if (r.encolado) {
    avisar('Sin conexión: el pedido quedó guardado y se sube solo.', true);
    estado.pedido = pedidoVacio();
    actualizarCabecera();
    location.hash = '#/inicio';
  } else {
    avisar(r.motivo, true);
    boton.disabled = false;
    boton.textContent = 'Registrar el pedido en Wix';
  }
}

// ---------- eventos ----------

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;

  if (b.dataset.ir) { location.hash = b.dataset.ir; return; }
  if ('atras' in b.dataset) { history.back(); return; }
  if (b.dataset.producto) { location.hash = `#/producto/${b.dataset.producto}`; return; }
  if ('filtro' in b.dataset) { estado.filtro = b.dataset.filtro || null; verCatalogo(); return; }
  if (b.dataset.opcion !== undefined) { elegirOpcion(Number(b.dataset.opcion)); return; }
  if ('seguir' in b.dataset) { avanzarPaso(); return; }
  if ('saltear' in b.dataset) {
    delete estado.respuestas[estado.recorrido.pasos[estado.paso].id];
    avanzarPaso(); return;
  }
  if (b.dataset.opcionNombre) {
    opcionesFicha[b.dataset.opcionNombre] = b.dataset.opcionValor;
    verProducto(opcionesFicha.__producto); return;
  }
  if ('agregar' in b.dataset) { agregarActual(); return; }
  if (b.dataset.mas) { cambiarCantidad(b.dataset.mas, +1); return; }
  if (b.dataset.menos) { cambiarCantidad(b.dataset.menos, -1); return; }
  if (b.dataset.quitar) {
    estado.pedido = quitarDelPedido(estado.pedido, b.dataset.quitar);
    actualizarCabecera(); verPedido(); return;
  }
  if (b.dataset.medio) {
    document.querySelectorAll('#medios .valor')
      .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    return;
  }
  if ('vaciar' in b.dataset) {
    estado.pedido = pedidoVacio(); actualizarCabecera(); verPedido(); return;
  }
  if ('confirmar' in b.dataset) { confirmar(b); return; }
  if ('reintentar' in b.dataset) {
    reintentarPendientes().then(({ enviados, quedan }) => {
      avisar(enviados ? `${enviados} pedido(s) subidos. Quedan ${quedan}.` : 'Todavía no se pudo subir.', !enviados);
      verPedido();
    });
    return;
  }
  if ('guardarCfg' in b.dataset) {
    configurar({
      url: document.getElementById('cfg-url').value.trim(),
      secreto: document.getElementById('cfg-secreto').value.trim(),
    });
    avisar('Ajustes guardados');
    return;
  }
});

let debounce;
document.getElementById('busqueda').addEventListener('input', (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    const texto = e.target.value.trim();
    if (texto === estado.busqueda) return;
    estado.busqueda = texto;

    // Si ya estamos en el catálogo, se refresca la grilla y listo.
    // Si estamos en otra pantalla, sólo llevamos al catálogo cuando hay algo
    // que buscar: vaciar el buscador no puede sacar a nadie de donde está
    // (por ejemplo, en mitad de cerrar un pedido).
    if (location.hash.startsWith('#/catalogo')) verCatalogo();
    else if (texto) location.hash = '#/catalogo';
  }, 180);
});

// Al volver la conexión, se sube solo lo que quedó pendiente.
addEventListener('online', () => {
  reintentarPendientes().then(({ enviados }) => {
    if (enviados) avisar(`${enviados} pedido(s) pendientes se subieron a Wix`);
  });
});

// ---------- ruteo ----------

function rutear() {
  if (!estado.catalogo) return;
  const ruta = location.hash || '#/inicio';

  if (ruta.startsWith('#/producto/')) verProducto(decodeURIComponent(ruta.slice(11)));
  else if (ruta.startsWith('#/recorrido')) verRecorrido();
  else if (ruta.startsWith('#/resultados')) verResultados();
  else if (ruta.startsWith('#/catalogo')) verCatalogo();
  else if (ruta.startsWith('#/pedido')) verPedido();
  else if (ruta.startsWith('#/ajustes')) verAjustes();
  else verInicio();

  scrollTo(0, 0);
  actualizarCabecera();
}

addEventListener('hashchange', rutear);

// ---------- arranque ----------

async function arrancar() {
  try {
    const [{ catalogo }, recorrido] = await Promise.all([
      cargarCatalogo(),
      fetch('datos/recorrido.json').then((r) => r.json()),
    ]);
    estado.catalogo = catalogo;
    estado.recorrido = recorrido;
    // El recorrido siempre empieza de cero: cada cliente es una conversación nueva.
    estado.paso = 0;
    estado.respuestas = {};
    rutear();
    reintentarPendientes().catch(() => {});
  } catch (e) {
    pantalla.innerHTML = `<div class="vacio"><h1>No se pudo abrir el catálogo</h1><p>${esc(e.message)}</p></div>`;
  }
}

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

arrancar();
