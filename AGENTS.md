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

First Supabase admin has to be bootstrapped manually (Supabase Auth users can't be created via SQL): sign up through `/login`, then in the Supabase SQL editor run `update public.perfiles set rol = 'administrador' where email = '...'`. After that, admins create more users from `/usuarios`.

### Directory map

- `src/lib/db/` — per-table Supabase access (productos, modelos, movimientos). Only called from `inventoryService.ts`.
- `src/lib/navLinks.ts` — sidebar links, each with a minimum required role.
- `src/types/database.types.ts` — types mirroring the SQL schema.
- `src/stores/theme.ts` — dark/light theme via nanostores + localStorage, applied class (`.dark` on `<html>`) before first paint to avoid flash.
- `src/utils/{format,csv,dateRange}.ts` — shared formatting/export/date-range helpers.
- `supabase/schema.sql` — full reference schema; `supabase/migrations/` — the actual migration history (`0001_init`, `0002_perfiles`); `supabase/seed.sql` — sample data.

### UI conventions worth knowing before touching layout

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
