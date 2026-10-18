# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EASYSTEM is an inventory/POS system for **Edward Accesorios** (phone accessories retailer). Astro + Tailwind CSS v4 frontend, mobile-first, with Supabase (Postgres + Auth) as the backend — but it also runs with **zero configuration** via an automatic LocalStorage fallback when Supabase credentials are absent or unreachable. The rest of this file (and the README, which is in Spanish) assumes familiarity with that dual-mode design.

## Commands

```
npm run dev            # dev server at localhost:4321
astro dev --background # dev server as a background process
astro dev stop         # stop the background dev server
astro dev status       # check if a background dev server is running
astro dev logs         # view logs from the background dev server
npm run build           # production build to ./dist/
npm run preview         # serve the production build locally
npm run astro check     # type-check the whole project
```

There is no test suite and no lint script configured. Use `npm run astro check` to verify TypeScript correctness after changes.

Demo login credentials (LocalStorage mode, no Supabase needed): `admin@edwardaccesorios.com` / `admin123` (administrador) and `vendedor@edwardaccesorios.com` / `vendedor123` (vendedor).

## Architecture

### The dual-mode data layer is the core design constraint

`src/lib/inventoryService.ts` and `src/lib/auth.ts` are the **only** allowed entry points for data access. No page or component should import `src/lib/db/*.ts`, `src/lib/mock-data.ts`, or `src/lib/supabase.ts` directly — always go through those two files. They each internally decide, at call time, whether to talk to Supabase (via `src/lib/db/`) or to LocalStorage (seeded from `src/lib/mock-data.ts`), based on whether `src/lib/supabase.ts` was able to instantiate a client from env vars.

Consequences of this that are easy to miss:
- The LocalStorage fallback only works in the browser, so **every page fetches its own data from a client-side `<script>` tag** ("self-fetching" pattern) rather than in Astro frontmatter. Don't move data fetching into frontmatter — it would break the fallback and offline behavior.
- `productos.stock_actual` is derived, never written directly. It only changes through `movimientos_inventario` rows (DB trigger `aplicar_movimiento_inventario`, mirrored in JS for the LocalStorage path). A POS sale is internally one or more `SALIDA` movements — if you need to touch stock, add a movimiento, don't write stock directly in either backend.
- Sales are **not transactional across line items**: lines are processed sequentially, so a sale can partially succeed (early lines committed, a later line rejected for insufficient stock). A true transactional sale needs a Postgres RPC function — this doesn't currently exist.
- When Supabase is configured, `inventoryService.ts` caches every successful read (productos/modelos/movimientos) to LocalStorage and serves that cache on network failure or `navigator.onLine === false`. Sales made offline queue in `easystem:cola-sync` and retry automatically on the `online` event; `ConnectionStatus.astro` (in the Header) shows sync status and a manual "Sincronizar" button. This is best-effort, sequential, and has no conflict resolution — it assumes a single till, not concurrent terminals.
- **Camera barcode scanner** (`src/components/CamaraEscaner.astro`, using `html5-qrcode`, lazy-imported on open): a single reusable modal, not a per-page component. Any element with `data-abrir-escaner` opens it (global click delegation); on a successful decode it dispatches `window` event `easystem:codigo-escaneado` with `{ detail: { codigo } }` and closes itself. Consuming pages (`ventas.astro`, `productos/index.astro`) just add a trigger button and a `window.addEventListener('easystem:codigo-escaneado', ...)` — no direct coupling to the component. Follow this same event-based pattern for any future scan targets instead of importing the modal's internals.

### Auth and roles

Two roles: `administrador` and `vendedor`. Role storage mirrors the same dual-mode pattern — `perfiles` table in Supabase, or a simulator in LocalStorage — both behind `src/lib/auth.ts`. Every page requires a session (`/login`); admin-only routes redirect vendedores to `/`. This guard (`protegerPagina`) runs client-side, called from `DashboardLayout.astro`, and is what every page layout relies on — it is **not** a substitute for server-side RLS if stronger protection is ever needed. Role also gates UI visibility client-side: purchase price column in Productos, Reportes, and Usuarios are hidden/blocked for vendedores.

**There is no public sign-up** — the system is internal (owner + a few employees). `/login` only logs in. Account creation is admin-only and is enforced in the database, not just the UI: migration `0004` adds a `BEFORE INSERT` trigger on `auth.users` that rejects any signup whose email wasn't pre-authorized (row in `usuarios_autorizados`, valid 10 min, consumed on use). `registrarUsuario` in `auth.ts` does it in two steps — admin inserts the authorization (RLS: admins only), then creates the account with an isolated client. Don't reintroduce a self-registration path, and never trust `raw_user_meta_data` for roles (the perfiles trigger always creates `vendedor`; admins promote via `update perfiles`).

First Supabase admin must be bootstrapped manually: insert the email into `usuarios_autorizados` via the SQL editor, create the user in Authentication → Users → Add user within 10 minutes, then `update public.perfiles set rol = 'administrador' where email = '...'`. After that, admins create more users from `/usuarios`.

### Directory map

- `src/lib/db/` — per-table Supabase access (productos, modelos, movimientos). Only called from `inventoryService.ts`.
- `src/lib/navLinks.ts` — sidebar links, each with a minimum required role.
- `src/lib/catalogo-modelos.ts` — master list of phone models (brand → models), the single source for both LocalStorage (`mock-data.ts` appends them, and `leerDB` back-fills missing ones into existing browsers) and Supabase (`migrations/0005_catalogo_modelos.sql` is **generated** from it — regenerate when the list changes). Products link to models **by model name**, so never rename an existing entry; add new ones instead.
- `src/types/database.types.ts` — types mirroring the SQL schema.
- `src/stores/theme.ts` — dark/light theme via nanostores + localStorage, applied class (`.dark` on `<html>`) before first paint to avoid flash.
- `src/utils/{format,csv,dateRange}.ts` — shared formatting/export/date-range helpers.
- `supabase/schema.sql` — full reference schema; `supabase/migrations/` — the actual migration history (`0001_init`, `0002_perfiles`); `supabase/seed.sql` — sample data.

### Product management (admin only)

Productos has admin-only tools, implemented as three `<dialog>` components in `src/components/productos/` (`FormularioProducto`, `EntradaStock`, `ImportadorCsv`). They follow the same event convention as the camera scanner: the page dispatches `easystem:abrir-producto` / `easystem:abrir-entrada` / `easystem:abrir-importador`, and the dialogs dispatch `easystem:productos-cambiaron` after saving so the page reloads its list. Each dialog re-checks the role itself.

- **Roles are enforced in the database too** (migration `0006`): products/models/compatibilities are writable only by `administrador`; any authenticated user may insert `SALIDA` movements (sales), but `ENTRADA` is admin-only. The stock trigger is `SECURITY DEFINER` so a vendedor's sale can still decrement stock. Column-level hiding of `precio_compra` is still UI-only.
- **Alerts**: `stock_minimo = 0` means "not tracked" — it never alerts (`esStockBajo` in `utils/format.ts`, mirrored by `vw_productos_stock_bajo`). Newly loaded products use 0 on purpose.
- **Barcodes**: products without a factory code get an internal EAN-13 with prefix `20` (`utils/codigos.ts`; same rule as SQL `ean13_interno`). Never hand-edit the algorithm in only one place.
- **CSV import**: `lib/importador.ts` is pure (parse → validate → *plan*); `inventoryService.importarProductos` applies it. Stock is never written directly: new stock enters as an `ENTRADA`, and a differing stock in the file becomes an `ENTRADA`/`SALIDA` "ajuste". Supabase applies it in batches; it requires a connection (not queued offline).
- **Forros per model** are generated by migration `0007`, and general (non-model) chargers/cables/popsockets by `0008` (both SQL, idempotent, skip names that already exist) — they are *not* in `mock-data.ts`; the LocalStorage demo keeps its small sample catalog, so test bulk loading there with the import template. Their sale prices are placeholders to be corrected via CSV import.
- **Test stock**: migration `0010` gives every product with `stock_actual = 0` a random 3–25 `ENTRADA` (motivo "Stock de prueba (aleatorio)"), through the normal movement/trigger path. It is demo data — replace with real counts via "Registrar entrada" or CSV import before real use.

### Exchange rate (USD → Bs)

Catalog prices are **in dollars** (`$`); bolívares are never stored on products — they are computed on screen as `precio × tasa del día` (`convertirABs`, `formatearBolivares` "Bs. 1.234,56", `htmlPrecioDual` in `utils/format.ts`).

- The rate is entered **manually** and kept as an append-only history in `tasas_cambio` (migration `0012`; LocalStorage: `db.tasas`); the current rate is the latest row. Any authenticated user may register it (so nobody waits on the admin). `inventoryService.obtenerTasaVigente()` returns `{ hoy, ultima }`, where "today" is the *local* date (`fechaLocalISO`). Offline, a registered rate is queued in `easystem:cola-tasas` and the last one is cached in `easystem:cache:tasa`.
- `components/layout/TasaDelDia.astro` (included by `DashboardLayout`) blocks the first entry of each day with a non-closable dialog until a rate is saved (shows the previous one to confirm; a change >25% asks for a second confirmation). The header chip (`$1 = Bs. …`) reopens it in editable/cancelable mode via the `easystem:abrir-tasa` event. If the rate can't be fetched (e.g. migration not applied) the app is **not** blocked.
- `stores/tasa.ts` (`tasaActual`, a nanostore) is the single source for rendering: pages call `tasaActual.get()` when rendering and re-render with `tasaActual.listen(...)`. It starts from the cached rate so Bs. appear without waiting for the network. Shown in Productos, POS, Dashboard (search + inventory value) and the model→products dialog; Reportes stays in USD.
- POS: a Bs payment method is entered in bolívares (converted at the day's rate), USD cash / Binance USDT in $. `registrarVenta` requires `tasa_cambio` and stores it with the sale.

### Split payments

A customer can pay one sale with several payment types (migration `0013`). The POS dialog has one row per payment (type + amount in that type's currency: Bs. for `BS_*`, $ for the rest; no repeated types; "Completar" fills what's left; the sum must equal the total ±$0.01, unless "¿Se debe dar vuelto?" = Sí). `DatosVenta.pagos: PagoVenta[]` = `{ metodo, monto_usd, monto_bs }`; the sale stores them in `ventas.pagos` (jsonb) and `ventas.metodo_pago` is the single type or `'MIXTO'`; `total_bs` = sum of what was received in Bs. **Always read payments through `pagosDeVenta()` (`utils/pagos.ts`)** — sales saved before 0013 have no `pagos` and get one synthetic payment. `resumirPorMetodo` (history summary + Reportes) groups by payment line, not by sale: a mixed sale adds each part to its own type. If only some lines of a sale were committed, the payments are scaled proportionally (`ajustarPagos`).

### Change (vuelto)

The payments form lives in `utils/formularioPagos.ts` (`FormularioPagos`, mounted on an empty container; used by the POS and by the exchange dialog). With "¿Se debe dar vuelto?" = Sí the received amounts may exceed the total; the excess is the **vuelto**, given in one of `METODOS_VUELTO` (USD cash, Bs cash, pago móvil) and stored in `ventas.vuelto` (migration `0014`). Invariant: `Σ pagos.monto_usd − vuelto.monto_usd = total`. `total_bs` is net (Bs received − Bs vuelto). `resumirPorMetodo` subtracts the vuelto from the method it was handed out with (net cash view).

### Returns and exchanges (devoluciones)

From **Ventas realizadas**, an **administrator** can open "Devolución / cambio" on a sale (`components/ventas/DevolucionVenta.astro`, events `easystem:abrir-devolucion` / `easystem:ventas-cambiaron`). `inventoryService.registrarDevolucion`: validates quantities against what was sold minus earlier returns; first moves stock OUT for replacement items (best-effort reverse if one fails), then stock IN (`ENTRADA`) for the returned ones, then saves a row in `devoluciones` (migration `0014`; LocalStorage: `db.devoluciones`). `diferencia = total_nuevo − total_devuelto`: > 0 the customer pays it (`pagos`/`vuelto`, same form), < 0 it is refunded with one of `METODOS_REEMBOLSO` (Bs amount at *today's* rate), ≈ 0 nothing. Admin-only because returned stock is an `ENTRADA` (already admin-only by RLS) and money moves; a vendedor can *read* the returns of sales they can see. Needs connection (not queued). Records are immutable (no update/delete). Reportes subtracts returned lines from revenue, cost and unit rankings (replacement items are already counted as `SALIDA`); the history shows net totals.

### Sales record (customer + payment type)

The POS asks for cédula (`V-`/`E-` + 5–9 digits), nombre, apellido, teléfono and *tipo de cobro* (`utils/pagos.ts`: Bs pago móvil / Bs punto de venta / Bs efectivo / USD efectivo / Binance USDT; `esMetodoBolivares` = the `BS_*` ones) in the same dialog that confirms the sale. `inventoryService.registrarVenta(items, { cliente, metodo_pago })` first moves stock (one `SALIDA` per line, motivo "Venta POS") and then saves a row in `ventas` (migration `0011`; LocalStorage: `db.ventas`) with the folio, customer, total (USD), `tasa_cambio`, `total_bs` (only when the payment is in Bs: total × rate, rounded to cents, frozen at sale time) and an `items` snapshot (name/code/price at sale time). The folio is assigned by the database (identity), so it persists across sessions.

- A vendedor only sees their own `ventas` (RLS); the admin sees all; nobody can update/delete from the app. They hold personal data — never log or export them casually.
- Not atomic: if a later line fails, or saving the record fails, the service throws `VentaIncompletaError` with `productosRegistrados`; the page removes those lines from the cart so they aren't charged twice. Offline, the record is queued in `easystem:cola-ventas` (synced with the stock queue; folio shows as "pendiente" on the ticket).
- **Historial** (`pages/historial-ventas.astro`, "Ventas realizadas", both roles): `inventoryService.listarVentas({ desde, hasta })` (date range filtered in the DB; offline-pending sales appear with folio 0). Search by folio/name/cédula/phone, filter by payment type, per-type summary (`utils/ventasResumen.ts`, shared with Reportes), paginated. The seller column and CSV export are **admin only** (personal data). In LocalStorage demo mode a vendedor is filtered by `vendedor_nombre` to mimic the RLS rule.
- **Reportes** adds "Ventas por tipo de cobro" (chart + table + printable section) from the same `listarVentas`. It only covers sales saved in `ventas` (i.e. since migration 0011); the stock-movement-based revenue/cost figures are unchanged.

### Product photos and per-model product lookup

- **Photos** (`productos.imagen_url`, migration `0009`): images are shrunk in the browser to ≤720px JPEG (`utils/imagenes.ts`) *before* saving. With Supabase they go to the public Storage bucket `productos` (admin-only write via storage policies) and the column holds the URL; in LocalStorage mode they are stored as a data URL inside the product (the browser quota is small, so `guardarImagenProducto` uses `guardarDBEstricto` and surfaces the error instead of silently dropping the photo). Always render thumbnails with `htmlMiniatura()` — it whitelists URL schemes. Photo upload is not queued offline.
- **Models → products**: clicking a chip in Modelos dispatches `easystem:abrir-modelo`; `components/modelos/ProductosDelModelo.astro` shows products linked to that model grouped by category, plus "universales" — unlinked products whose category is *not* inherently model-specific (Forros and Vidrios Templados are never offered as universal; chargers, cables, popsockets, audio are).

### UI conventions worth knowing before touching layout

- **Brand**: the palette comes from the company logo (`public/logo.png`; favicon set: `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`). Colors are Tailwind tokens in `src/styles/global.css` — `brand-*` (blues) and `accent-*` (the logo's cyan); never hardcode hex colors in pages (the Chart.js colors in `reportes.astro` are the only exception, since canvas can't read CSS tokens). `.bg-marca` / `.texto-marca` are the logo gradient.
- **Animations** live in `global.css` (keyframes + `.anim-*` classes) and are triggered from `src/utils/animaciones.ts` (`animarLista`, `reanimar`, `contarHasta`). They use the individual `translate`/`scale`/`rotate` properties so they don't clobber Tailwind transforms, and everything respects `prefers-reduced-motion`. Use `animarLista` only on the *first* render of a list — never on search-as-you-type re-renders, or rows flicker on every keystroke.

- Sidebar is a mobile drawer (`-translate-x-full`/`translate-x-0`, `lg:translate-x-0` pinned on desktop), toggled by the Header's hamburger button. POS (`ventas.astro`) adds a fixed bottom bar with total + "Cobrar" so checkout doesn't require scrolling on small screens.
- Ticket/report printing uses `window.print()` with Tailwind `print:` utilities to hide sidebar/header/forms, not a separate print view.

## Documentation

Full Astro documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
