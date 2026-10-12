# EASYSTEM

Sistema de gestión de inventario y punto de venta para **Edward Accesorios** (accesorios de teléfono: forros, cargadores, vidrios templados, etc.).

## Stack

- **Frontend:** [Astro](https://astro.build) + [Tailwind CSS v4](https://tailwindcss.com), mobile-first (sidebar como menú hamburguesa en pantallas pequeñas)
- **Backend/DB:** [Supabase](https://supabase.com) (PostgreSQL + Auth), con **fallback automático a LocalStorage** si no hay credenciales configuradas o si se pierde la conexión
- **Estado cliente:** JavaScript moderno (vanilla) en cada página/componente, orquestado por `src/lib/inventoryService.ts` y `src/lib/auth.ts`

## Roles y acceso

| | Administrador | Vendedor |
|---|---|---|
| Dashboard, Productos, Modelos, Movimientos | ✅ | ✅ |
| Precio de compra (columna en Productos) | ✅ | ❌ oculto |
| Nueva Venta (POS) | ✅ | ✅ |
| Reportes & Métricas (financieros) | ✅ | ❌ sin acceso |
| Gestión de Usuarios | ✅ | ❌ sin acceso |

Todas las páginas exigen sesión iniciada (`/login`); las rutas de administrador redirigen a "/" si un vendedor intenta entrar. Esto se aplica en el cliente (`src/lib/auth.ts` → `protegerPagina`, llamado desde `DashboardLayout.astro`), apropiado para un sitio estático — no reemplaza RLS/políticas de servidor si necesitas protección más estricta.

**Credenciales demo (modo LocalStorage, sin Supabase):**
- Administrador: `admin@edwardaccesorios.com` / `admin123`
- Vendedor: `vendedor@edwardaccesorios.com` / `vendedor123`

## Estructura del proyecto

```text
EASYSTEM/
├── src/
│   ├── components/
│   │   ├── dashboard/     # StatCard, QuickSearch, LowStockTable, RecentMovements (todos autoalimentados)
│   │   └── layout/        # Sidebar (drawer responsivo), Header, NotificationsBell, ConnectionStatus
│   ├── layouts/
│   │   └── DashboardLayout.astro   # aplica el guard de auth a todas las páginas
│   ├── lib/
│   │   ├── supabase.ts         # Cliente de Supabase (solo se instancia si hay credenciales)
│   │   ├── auth.ts             # Login/roles: Supabase Auth o simulador en LocalStorage
│   │   ├── inventoryService.ts # Datos: Supabase (+ caché/cola offline) o LocalStorage
│   │   ├── navLinks.ts         # Enlaces del sidebar, con rol mínimo por enlace
│   │   ├── mock-data.ts        # Datos de ejemplo (semilla de LocalStorage)
│   │   └── db/                 # Acceso a Supabase por tabla (productos, modelos, movimientos)
│   ├── pages/
│   │   ├── login.astro       # Inicio de sesión / registro
│   │   ├── index.astro       # Dashboard principal
│   │   ├── ventas.astro      # Punto de venta (POS), optimizado para móvil/tablet
│   │   ├── productos/
│   │   ├── modelos/
│   │   ├── movimientos.astro # Historial de entradas/salidas
│   │   ├── reportes.astro    # Solo administrador
│   │   └── usuarios.astro    # Solo administrador
│   ├── stores/theme.ts   # Tema claro/oscuro (nanostores + localStorage)
│   ├── styles/global.css # Tailwind + tema oscuro
│   ├── types/database.types.ts # Tipos que reflejan el esquema SQL
│   └── utils/{format,csv,dateRange}.ts
└── supabase/
    ├── schema.sql         # Esquema completo de referencia (inventario + roles)
    ├── seed.sql           # Datos de ejemplo
    └── migrations/{0001_init,0002_perfiles}.sql
```

## Puesta en marcha

EASYSTEM funciona **sin ninguna configuración**: si no hay `.env`, guarda todo en `localStorage` del navegador (sembrado con los datos de ejemplo de `src/lib/mock-data.ts`, incluidos los dos usuarios demo de arriba). Para conectarlo a Supabase:

1. Instala dependencias:

   ```sh
   npm install
   ```

2. Crea un proyecto en [supabase.com](https://supabase.com), copia `.env.example` a `.env` y completa las variables:

   ```sh
   cp .env.example .env
   ```

3. Aplica el esquema (`supabase/schema.sql`, o `supabase db push` con la CLI usando las migraciones en `supabase/migrations/`). Opcionalmente corre `supabase/seed.sql` para productos de ejemplo.

4. Levanta el entorno de desarrollo:

   ```sh
   npm run dev
   ```

5. **Primer administrador** (Supabase no permite crear usuarios de Auth por SQL): entra a `/login`, pestaña "Crear cuenta" — queda como Vendedor por el trigger `manejar_nuevo_usuario`. Luego, en el SQL Editor de Supabase:

   ```sql
   update public.perfiles set rol = 'administrador' where email = 'tu-correo@dominio.com';
   ```

   Desde ahí, ese administrador ya puede crear más empleados en `/usuarios`.

## Despliegue en producción

EASYSTEM es un sitio **100% estático** (`astro.config.mjs` no define `output`, por lo que usa el valor por defecto `static`; no hay rutas `/api`, ni código de servidor en el frontmatter de las páginas). Esto significa que **no hace falta ningún adaptador** (`@astrojs/vercel`, `@astrojs/netlify`, etc.) para desplegarlo: tanto Vercel como Netlify sirven el contenido de `dist/` directamente como archivos estáticos.

### Variables de entorno requeridas

| Variable                     | Descripción                                              | Obligatoria |
| :---------------------------- | :-------------------------------------------------------- | :---------- |
| `PUBLIC_SUPABASE_URL`         | URL del proyecto (Project Settings → API en supabase.com) | No*         |
| `PUBLIC_SUPABASE_ANON_KEY`    | Clave anónima/pública del proyecto                        | No*         |

\* Si se omiten (o el build no las recibe), EASYSTEM sigue funcionando: cae automáticamente al modo LocalStorage descrito arriba. Para producción real con datos persistentes y multiusuario, configúralas.

### 1. Sube el esquema a Supabase

Con la [CLI de Supabase](https://supabase.com/docs/guides/cli) enlazada a tu proyecto:

```sh
supabase link --project-ref tu-project-ref
supabase db push
```

Esto aplica las migraciones de `supabase/migrations/` (`0001_init.sql`, `0002_perfiles.sql`) en orden. Alternativamente, pega el contenido de `supabase/schema.sql` directamente en el SQL Editor del dashboard de Supabase — es el esquema completo equivalente.

Corre `supabase/seed.sql` (botón "Run" en el SQL Editor, o `supabase db reset` en local) si quieres el catálogo de ejemplo de accesorios/modelos de teléfono.

No olvides el paso de [bootstrap del primer administrador](#puesta-en-marcha) una vez desplegado.

### 2. Despliega en Vercel

1. Importa el repositorio en [vercel.com/new](https://vercel.com/new). Vercel detecta Astro automáticamente (`npm run build`, directorio de salida `dist`) — no se necesita configuración adicional ni el paquete `@astrojs/vercel`, ya que el sitio es estático.
2. En **Settings → Environment Variables**, agrega `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` (Production, y Preview si quieres previews conectados a Supabase).
3. Despliega. Cada push a la rama configurada dispara un nuevo build.

### 3. Despliega en Netlify

1. Importa el repositorio en [app.netlify.com/start](https://app.netlify.com/start).
2. Build command: `npm run build` · Publish directory: `dist` (Netlify también autodetecta Astro y sugiere estos valores).
3. En **Site configuration → Environment variables**, agrega `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`.
4. Despliega.

### 4. Verifica el build antes de desplegar

```sh
npm run build
npm run preview
```

`npm run build` debe terminar sin errores y generar `./dist/`; `npm run preview` sirve ese build localmente para una última revisión antes de publicar.

## Notas de arquitectura

- **`inventoryService.ts` y `auth.ts` son las únicas puertas de entrada a los datos.** Ninguna página o componente debería importar `src/lib/db/*.ts`, `mock-data.ts` o `supabase.ts` directamente.
- **El fallback de LocalStorage solo corre en el navegador.** Por eso todas las páginas cargan sus datos desde un `<script>` de cliente (patrón "self-fetching"), no desde el frontmatter de Astro.
- **Stock derivado, no editable directamente:** `productos.stock_actual` sólo cambia a través de `movimientos_inventario` (trigger `aplicar_movimiento_inventario`, replicado en JS para LocalStorage). Una venta en el POS es, internamente, uno o más movimientos `SALIDA`.
- **Ventas no son atómicas entre líneas:** se procesan en secuencia; si el stock alcanza para las primeras líneas pero no para una posterior, esas primeras quedan registradas igual. Una venta transaccional real requeriría una función RPC de Postgres.
- **Resiliencia offline (con Supabase configurado):** `inventoryService.ts` cachea en LocalStorage cada lectura exitosa de productos/modelos/movimientos. Si una llamada falla por falta de red (o `navigator.onLine` es `false`), sirve esa caché en su lugar, y las ventas se encolan (`easystem:cola-sync`) en vez de perderse. Al reconectar (evento `online`) se reintentan automáticamente; `ConnectionStatus.astro` en el Header muestra el estado y un botón "Sincronizar" manual. Es *best-effort* y secuencial, sin resolución de conflictos — pensado para una sola caja, no para múltiples terminales concurrentes.
- **Roles:** `perfiles` (Supabase) o un simulador en LocalStorage (`src/lib/auth.ts`), con el mismo patrón dual que el resto de la app. La visibilidad de "Reportes", "Usuarios" y la columna "Precio de compra" se decide en el cliente según el rol de la sesión activa.
- **Modo oscuro:** clase `.dark` en `<html>`, controlada por `src/stores/theme.ts` (persistida en `localStorage`) y aplicada antes del primer paint para evitar parpadeos.
- **Ticket de venta / reporte de ventas:** imprimen con `window.print()` + utilidades `print:` de Tailwind (ocultan sidebar/header/formularios y dejan visible solo el contenido a imprimir).
- **Móvil:** el sidebar es un drawer (`-translate-x-full` / `translate-x-0`, con `lg:translate-x-0` fijo en escritorio) que se abre con el botón hamburguesa del Header. El POS agrega una barra inferior fija con el total y un botón "Cobrar" para no tener que hacer scroll en pantallas chicas.

## Comandos

| Comando           | Acción                                       |
| :----------------- | :-------------------------------------------- |
| `npm run dev`       | Servidor de desarrollo en `localhost:4321`   |
| `npm run build`     | Build de producción a `./dist/`              |
| `npm run preview`   | Sirve el build de producción localmente      |
| `npm run astro check` | Chequeo de tipos de todo el proyecto        |
| `npm run backup`     | Respaldo en JSON del inventario en Supabase (`backups/`, requiere `SUPABASE_SERVICE_ROLE_KEY`) |

## Checklist final de despliegue

1. **Crea el proyecto en Supabase** en [supabase.com](https://supabase.com) → **New project**. Ya dentro, ve a **SQL Editor**, pega el contenido completo de [`supabase/schema.sql`](supabase/schema.sql) y ejecútalo (**Run**). Esto crea todas las tablas, triggers y políticas de una sola vez.
2. **Sube el repositorio a GitHub:**

   ```sh
   git init
   git add .
   git commit -m "EASYSTEM listo para producción"
   git branch -M main
   git remote add origin https://github.com/tu-usuario/tu-repo.git
   git push -u origin main
   ```

3. **Conecta el repositorio con Vercel o Netlify:** importa el repo desde [vercel.com/new](https://vercel.com/new) o [app.netlify.com/start](https://app.netlify.com/start) — ambos detectan Astro automáticamente (`vercel.json`/`netlify.toml` ya están en la raíz del proyecto con la configuración de build).
4. **Agrega las variables de entorno y despliega:** en el panel del proyecto (Vercel: **Settings → Environment Variables**; Netlify: **Site configuration → Environment variables**), agrega `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` con los valores de tu proyecto de Supabase, y lanza el deploy. Al terminar, sigue el [paso de bootstrap del primer administrador](#puesta-en-marcha) antes de compartir la URL con el equipo.
