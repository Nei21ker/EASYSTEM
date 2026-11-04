# Resultados de la fase 0 (prueba de viabilidad) — migración a Cloudflare

Fecha: 2026-11-03. Rama `cloudflare`. Sin commits (regla del dueño). Plan: tareas 1–3.

## Veredicto: GO, con tres ajustes que necesitan tu visto bueno

Las cuatro preguntas del spec (§14, fase 0) tienen respuesta favorable:

| Pregunta | Resultado |
|---|---|
| (a) ¿Astro + adaptador de Cloudflare compila el sitio estático y una ruta `/api` con D1 y R2? | **Sí.** `astro build` genera las 15 páginas estáticas y el Worker; con `wrangler dev`, `/api/salud` devuelve `{"ok":true,"d1":true,"r2":true}` y `/`, `/login/`, `/ventas/` se sirven como archivos estáticos. |
| (b) ¿Un trigger de SQLite con `RAISE(ABORT)` aborta todo un `db.batch` y el mensaje llega al código? | **Sí.** El lote se rechaza con el mensaje del trigger y la primera sentencia queda revertida. Comprobado también al revés: sin el trigger, la prueba falla. El diseño de las tareas 4 y 11 se mantiene. |
| (c) ¿Better-Auth sobre D1 + Drizzle, registro cerrado y hasher PBKDF2? | **Sí.** El registro público responde error, un usuario creado por el servidor inicia sesión con su clave PBKDF2 y una clave incorrecta se rechaza. |
| (d) ¿Los límites de los planes gratuitos son los esperados? | **En lo esencial sí** (detalle abajo), con una excepción importante: las fotos por `r2.dev`. |

Pruebas: 12/12 en verde (`npx vitest run`). `astro check` sin errores; el servidor se revisa aparte (`npm run check:server`, 0 errores).

## Lo que cambió respecto al plan (rulings tomados)

1. **Versiones.** Tu Node es 22.20 y Astro ≥ 7.4 pide Node ≥ 22.23.4, así que **Astro se queda en 7.3.3** (la versión que ya usabas) con **`@astrojs/cloudflare` 14.3.4**. Funciona. Si más adelante actualizas Node, se pueden subir los dos juntos.
2. **Plugin de pruebas.** `@cloudflare/vitest-pool-workers` está descontinuado; se usa `@cloudflare/vitest-plugin` (con Vitest 4).
3. **Tipos separados.** Los tipos de Workers chocan con los del navegador, así que el servidor tiene su propio `tsconfig.server.json` (`npm run check:server`).
4. **Barra final en las direcciones.** Cloudflare redirige `/login` → `/login/` (307). Una línea de `src/lib/auth.ts` compara la ruta exacta y hay que normalizarla en la tarea 17 (queda anotado).
5. **Enlaces automáticos del adaptador.** El adaptador agrega por su cuenta un binding KV (`SESSION`) y otro de imágenes (`IMAGES`) que no usamos; se revisan/desactivan antes de desplegar (tarea 26).

## Límites verificados en la documentación de Cloudflare

- **Workers gratis:** 100.000 peticiones/día, **10 ms de CPU por petición**, 50 subpeticiones. Si se excede, las rutas que invocan el Worker (nuestra `/api/*`) responden **429** (no hay caída a archivos estáticos).
- **Archivos estáticos:** "gratis e ilimitados": no cuentan para las 100.000. Confirma que mantener el sitio estático es lo correcto.
- **D1 gratis:** 5 M filas leídas/día, 100.000 escritas/día, 5 GB en total, 10 bases. La documentación no aclara cuánto cuentan los triggers en las filas escritas.
- **R2 gratis:** 10 GB, 1 M operaciones de escritura y 10 M de lectura al mes, salida de datos gratis. **La documentación no dice si pide tarjeta para activar R2**; se sabrá al activarlo (tarea 26).
- **PBKDF2:** la documentación no fija un límite de iteraciones. En local aceptó hasta 600.000, pero se usa **100.000** por prudencia (límite que recuerdo en producción, sin confirmar). El hash tarda ~37 ms de reloj en local; **lo que cuenta es el tiempo de CPU, que solo se puede medir ya desplegado.** Es el riesgo que queda abierto: si un inicio de sesión superara los 10 ms de CPU del plan gratuito, se reduce el costo o se pasa al plan de pago (unos 5 USD/mes). Se mide en la tarea 26.

## Ajustes al diseño que necesito que apruebes

1. **Fotos de producto: no usar `r2.dev` en producción.** La documentación dice que esa dirección tiene límite de uso y es solo para desarrollo. Propuesta: **servir las fotos por el Worker** (`GET /api/archivos/publico/…`) con caché del navegador de un año (cada foto tiene un nombre único, así que no se queda desactualizada): cada dispositivo la pide una sola vez. Con un catálogo pequeño como el de los cargadores es muy poco consumo de las 100.000 peticiones diarias. Si más adelante quieres, se pasa a un dominio propio en Cloudflare y las fotos salen del Worker. (`URL_FOTOS_PUBLICAS` ya apunta a esa ruta.)
2. **Plan gratuito ajustado en CPU, no en peticiones.** Lo único que puede obligar a pagar pronto es el límite de CPU de 10 ms. Se vigila en el despliegue.
3. **R2 y tarjeta:** puede pedirte registrar una tarjeta al activarlo aunque el uso sea gratuito; no lo sabré hasta ese paso.

## Siguiente paso

Con tu visto bueno sigo con la **fase 1** (esquema D1, tablas y semilla de los 4 locales) y luego las fases 2 a 6. Si prefieres que cambie algo de los tres ajustes de arriba, dímelo ahora.
