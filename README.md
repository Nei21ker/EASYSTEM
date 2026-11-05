# EASYSTEM

Sistema de inventario, punto de venta, órdenes de servicio, cuadre de caja y nómina para **Edward Accesorios** (4 locales: Accesorios, Vidrios, Servicio Técnico y Controles).

## Stack

- **Interfaz:** [Astro](https://astro.build) (sitio estático) + [Tailwind CSS v4](https://tailwindcss.com), mobile-first.
- **Servidor:** un **Cloudflare Worker** que sirve el sitio y la API (`src/pages/api/**`).
- **Base de datos:** **Cloudflare D1** (SQLite). **Archivos:** **Cloudflare R2** (fotos de producto públicas; comprobantes de nómina y fotos de cuadre privados).
- **Cuentas:** [Better-Auth](https://www.better-auth.com) sobre D1 (clave con PBKDF2, sesión por cookie). **No hay registro público**: solo el administrador y el gerente crean usuarios.
- **Modo demo:** sin la variable `PUBLIC_USAR_API`, el sistema funciona solo con LocalStorage (sin servidor ni cuentas reales).

## Roles

administrador (dueño del servicio, nunca se bloquea) › gerente (dueño del negocio, todos los locales) › encargado (un local) › vendedor / técnico (un local); y **contador** (solo Nómina). Cada ruta de la API comprueba sesión, rol, local y suscripción (`src/server/authz.ts`); la interfaz solo oculta lo que no corresponde. `tests/server/matriz-roles.test.ts` prueba cada endpoint contra cada rol.

## Puesta en marcha (desarrollo)

```bash
npm install
npm run dev            # modo demo (LocalStorage), http://localhost:4321
```

Demo: `admin@edwardaccesorios.com` / `admin123`, `vendedor@…` / `vendedor123`, `gerente@…` / `gerente123`, `contador@…` / `contador123` (dominio `edwardaccesorios.com`).

**Con servidor local (Worker + D1 + R2 simulados):**

```bash
npm run db:local                                   # crea la base local con las migraciones
echo "BETTER_AUTH_SECRET=$(node -p "require('crypto').randomBytes(32).toString('hex')")" > .dev.vars
PUBLIC_USAR_API=true npx astro build && npx wrangler dev
node scripts/crear-admin.mjs --db local            # crea tu administrador (la clave se muestra UNA vez)
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas del servidor (workerd), del cliente y de los scripts |
| `npm run check:all` | `astro check` + tipos del servidor |
| `npm run build` | Compila el sitio y el Worker |
| `npm run db:local` | Aplica `migrations/` a la base D1 local |
| `npm run crear-admin -- --db local\|remote` | Crea el administrador del dueño |
| `npm run cargar-controles -- --api <url> --email <correo>` | Carga el inventario real del Local de controles (ver el encabezado del script) |
| `npm run backup` | Exporta la base remota a `backups/` (`wrangler d1 export`) |

## Estructura

```text
migrations/            Esquema D1 (0001, con triggers de seguridad) y semilla (0002: locales y modelos de teléfono)
src/pages/api/         Rutas de la API (todas con conSesion, salvo salud, auth, archivos públicos y estado de cuenta)
src/server/            authz, servicios (ventas, movimientos, nómina…), repos, auth, esquemas
src/lib/               Cliente: api.ts, auth.ts, inventoryService.ts (modo servidor o demo), db/* (llamadas a la API)
scripts/               crear-admin, cargar-controles, generar-seed
tests/                 server/ (workerd + D1 real), cliente/, scripts/
docs/superpowers/      Diseño, plan y recorrido manual de la migración
```

## Despliegue en Cloudflare

Lo hace el dueño con la persona que da soporte (ver la tarea 26 del plan en `docs/superpowers/plans/`). En resumen: `wrangler login` → crear D1 y los dos buckets de R2 → poner `BETTER_AUTH_SECRET` (`wrangler secret put`) → `wrangler d1 migrations apply easystem --remote` → `node scripts/crear-admin.mjs --db remote` → build con `PUBLIC_USAR_API=true` y `wrangler deploy` → cargar los controles con `scripts/cargar-controles.mjs`.

## Notas

- El stock nunca se escribe directo: solo cambia con movimientos de inventario (un trigger de D1 lo aplica). Cada unidad física tiene su propio código (EAN-13, prefijo 21).
- Las pantallas se actualizan solas: el navegador consulta `/api/cambios` cada 10 s (solo con la pestaña visible y con actividad).
- Las ventas no son transaccionales entre líneas: se procesan en secuencia (ver `registrarVenta` en `inventoryService.ts`).
