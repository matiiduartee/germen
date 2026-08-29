# Germen

App local para atender clientes en el local de **Germinando Nativas** desde una tablet
Android, espejando el recorrido guiado de [germinandonativas.com](https://www.germinandonativas.com/)
y sincronizada con Wix para crear pedidos reales.

**Idea central:** el catálogo se navega 100% offline desde la tablet; internet se usa
sólo para sincronizar el catálogo y para enviar el pedido a Wix.

## Estado

Arranque del proyecto. Hoy hay:

- `docs/arquitectura.md` — relevamiento del sitio real (162 productos, 34 colecciones,
  Wix Stores catálogo V1) y la arquitectura propuesta, con los riesgos identificados.
- `scripts/sync-catalogo.mjs` — baja el catálogo de Wix y arma el paquete offline.
- `scripts/lib/normalizar.mjs` — transformación Wix → formato tablet, con pruebas
  contra payloads reales del sitio.

Todavía **no** hay app de tablet ni proxy: falta definir el flujo de cobro
(ver "Decisiones pendientes" en `docs/arquitectura.md`).

## Uso

```bash
cp .env.example .env      # y completá WIX_API_KEY
npm test                  # pruebas de la normalización
npm run sync              # genera data/catalogo.json
npm run sync:imagenes     # además baja las fotos a data/imagenes/
```

La API key se saca de [API Keys Manager](https://manage.wix.com/account/api-keys) y la
crean sólo el dueño o los co-dueños de la cuenta. **Nunca va en la tablet:** es una clave
de administrador de toda la cuenta.

## Documentación

- [Arquitectura y relevamiento](docs/arquitectura.md)
