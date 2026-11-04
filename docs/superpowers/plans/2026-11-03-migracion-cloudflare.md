# Migración de EASYSTEM a Cloudflare — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover EASYSTEM de Vercel + Supabase a Cloudflare (Workers con archivos estáticos + D1 + R2 + Better-Auth), con 4 locales, sin migrar datos de Supabase y conservando el modo demo.

**Architecture:** El sitio sigue siendo estático; solo `/api/*` corre en el Worker. Las políticas RLS pasan a un módulo `authz` y los repositorios exigen un `Alcance`; los triggers de Postgres pasan a servicios que ejecutan `db.batch` más triggers/CHECK de SQLite como red de seguridad. El cliente conserva `inventoryService`/`auth` y sustituye `src/lib/db/*` por llamadas a la API.

**Tech Stack:** Astro 7.3 (`output: 'static'`) + `@astrojs/cloudflare`, Wrangler, Cloudflare D1 y R2, Drizzle ORM (`drizzle-orm/d1`), Better-Auth, zod, Vitest (`@cloudflare/vitest-pool-workers`), PBKDF2 (WebCrypto).

**Spec:** `docs/superpowers/specs/2026-11-03-migracion-cloudflare-design.md` (leerlo antes de empezar). El esquema Postgres actual, que es la fuente de las columnas y mensajes de error, está en `supabase/migrations/0001…0034`.

## Global Constraints

- Rama de trabajo `cloudflare`. **No hacer commit ni push sin que el dueño escriba "súbelo".** Al terminar cada fase se le pide autorización; las tareas no contienen pasos de commit.
- Sitio estático; solo las rutas de `src/pages/api/**` usan `export const prerender = false`.
- D1 no tiene transacciones interactivas: solo `db.batch([...])` atómico.
- Tipos: UUID → `TEXT` (`crypto.randomUUID()`); dinero → `REAL` redondeado a 2 decimales; `timestamptz` → `TEXT` ISO-8601 UTC; `date` → `TEXT` `aaaa-mm-dd`; `jsonb`/`text[]` → `TEXT` con `CHECK (json_valid(col))`; enums → `TEXT` con `CHECK (col IN (...))`; folios y la secuencia de códigos de unidad → tabla `contadores(nombre, valor)`.
- Ningún repositorio se llama sin un `Alcance`. Los mensajes de error visibles al usuario son **en español e idénticos a los actuales** (copiarlos de las migraciones y de `inventoryService.ts`).
- Contraseñas con PBKDF2-SHA-256 (WebCrypto); registro público deshabilitado.
- Fotos de producto en R2 público (URL absoluta en `imagen_url`); comprobantes de nómina y fotos de cuadre en R2 privado servido por el Worker tras autorizar (tipos jpg/jpeg/png/webp).
- Actualización en vivo: consulta cada **5 s** solo con pestaña visible y actividad reciente; sin Durable Objects.
- Semilla: 4 locales con ids `00000000-0000-4000-8000-00000000000{1,2,3,4}` (Accesorios, Vidrios, Servicio Técnico, Local de controles, este último de tipo `controles`) + catálogo de modelos; **ningún producto**.
- Las firmas públicas de `inventoryService.ts` y `auth.ts` no cambian; el modo demo (LocalStorage) sigue funcionando y se activa cuando `PUBLIC_USAR_API` no es `true`. El indicador `supabaseConfigurado` pasa a llamarse `modoServidor`.
- Todo se prueba en local (D1/R2 simulados); **nada se crea en la cuenta de Cloudflare sin avisar** (solo en la tarea 26, con el dueño presente).

## Review Focus

1. Usuario desactivado o con sesión cerrada a la fuerza que conserva una cookie válida: toda ruta responde 401 (tarea 8).
2. Vendedor/técnico que llama a la API directamente pidiendo ventas, nómina, cuadres o stock de **otro local**: 403 o lista vacía, nunca datos ajenos (tareas 8, 12, 15, 23).
3. Dos ventas simultáneas de la misma unidad escaneada: una se confirma y la otra falla sin dejar stock ni unidades a medias (tarea 11).
4. Archivo privado (comprobante, foto de cuadre) de otro local, o foto subida a un cuadre ya cerrado: rechazado (tarea 14).
5. Local suspendido o vencido: lecturas vacías y escrituras rechazadas; si **todos** los locales están bloqueados, también el gerente y el contador; el administrador nunca (tareas 8, 23).
6. Carga inicial de cargadores con foto faltante, precio no numérico o nombre repetido: el script lo informa y no escribe nada hasta confirmar (tarea 22).

## Contratos compartidos (todas las tareas los usan con estos nombres)

```ts
// src/server/entorno.ts
export interface Entorno { DB: D1Database; FOTOS_PUBLICAS: R2Bucket; FOTOS_PRIVADAS: R2Bucket; BETTER_AUTH_SECRET: string; URL_FOTOS_PUBLICAS: string; }
// src/server/errores.ts
export class ErrorApi extends Error { constructor(public status: number, mensaje: string, public codigo?: string) }
// src/server/authz.ts
export type Rol = 'administrador' | 'gerente' | 'encargado' | 'vendedor' | 'tecnico' | 'contador';
export interface Sesion { userId: string; email: string; nombre: string; rol: Rol; localId: string | null; status: 'active' | 'inactive'; emitidaEn: number /* segundos */; }
export type Alcance = { tipo: 'todos' } | { tipo: 'locales'; ids: string[] };
export function cargarSesion(env: Entorno, request: Request): Promise<Sesion>;            // 401 si no hay sesión válida
export function alcanceDe(env: Entorno, sesion: Sesion, localSolicitado?: string): Promise<Alcance>;
export function exigirRol(sesion: Sesion, roles: Rol[]): void;                            // 403
export function localAccesible(env: Entorno, sesion: Sesion, localId: string): Promise<boolean>;
export function esAdministrador(r: Rol): boolean; export function esGlobal(r: Rol): boolean; // administrador|gerente
export function esGerencia(r: Rol): boolean;                                              // + encargado
// src/server/http.ts
export function conSesion(handler: (c: { env: Entorno; sesion: Sesion; request: Request; params: Record<string, string | undefined> }) => Promise<unknown>): APIRoute; // JSON {…} o ErrorApi → {error, codigo}
// src/server/util.ts
export function nuevoId(): string; export function ahoraISO(): string; export function redondear2(n: number): number;
export function sentenciaContador(db: D1Database, nombre: string): D1PreparedStatement;   // UPDATE contadores SET valor = valor + 1 … RETURNING valor
```

Convenciones: repos en `src/server/repos/<modulo>.ts` (reciben `env`, `alcance`), servicios en `src/server/servicios/<modulo>.ts` (reciben `env`, `sesion`), rutas finas en `src/pages/api/<modulo>/…` que solo validan con zod y llaman al servicio. Pruebas en `tests/server/<modulo>.test.ts` con el ayudante `tests/server/ayudas.ts`: `crearEntornoDePrueba()`, `sesionDePrueba(rol, localId)`, `sembrarLocales()`.

---

## FASE 0 — Prueba de viabilidad (go/no-go)

### Task 1: Rama, adaptador y primer endpoint con D1/R2

**Files:**
- Create: `wrangler.jsonc`, `vitest.config.ts`, `src/server/entorno.ts`, `src/pages/api/salud.ts`, `tests/server/ayudas.ts`, `tests/server/salud.test.ts`
- Modify: `astro.config.mjs` (adaptador Cloudflare, `output: 'static'`), `package.json` (dependencias y scripts `test`, `dev:cf`, `db:local`), `.gitignore` (`datos-controles/`, `.wrangler/`, `.dev.vars`)

**Interfaces:**
- Produces: `Entorno`, `GET /api/salud` → `{ ok: true, d1: true, r2: true }`, ayudantes de prueba.

- [ ] **Step 1:** `git switch -c cloudflare`; instalar `@astrojs/cloudflare wrangler drizzle-orm zod better-auth` y, como dev, `vitest @cloudflare/vitest-pool-workers drizzle-kit`.
- [ ] **Step 2: Escribir la prueba** `salud.test.ts`: `GET salud` con el entorno de prueba devuelve 200 y `{ ok: true, d1: true, r2: true }`, tras ejecutar `SELECT 1` en D1 y un `put`/`get` en `FOTOS_PRIVADAS`.
- [ ] **Step 3:** Ejecutar `npx vitest run tests/server/salud.test.ts` → falla (ruta inexistente).
- [ ] **Step 4:** Implementar `salud.ts` con `prerender = false`; `wrangler.jsonc` con bindings `DB` (database_name `easystem`, `database_id` provisional `LOCAL`), `FOTOS_PUBLICAS` y `FOTOS_PRIVADAS` y `assets` apuntando a `dist`; `astro.config.mjs` con el adaptador.
- [ ] **Step 5: Verificar** `npx vitest run` pasa; `npx astro build` genera las páginas estáticas **y** el Worker; `npx wrangler dev` y `curl localhost:8787/api/salud` responde 200 y `/login` sirve el HTML estático. **Si el adaptador no soporta Astro 7.3, detenerse y avisar al dueño con alternativas (spec §14, fase 0a).**

### Task 2: Un trigger de SQLite aborta el lote completo

**Files:**
- Create: `tests/server/spike-triggers.test.ts`

- [ ] **Step 1: Prueba** (crea tablas y trigger temporales en el `beforeEach`): un `db.batch([insertMovimiento, updateStock])` donde el trigger lanza `RAISE(ABORT, 'Stock insuficiente para el producto en este local')` **rechaza** y el mensaje contiene `Stock insuficiente`; después, la tabla `movimientos` sigue vacía (el lote se revirtió entero).
- [ ] **Step 2:** Ejecutar → debe pasar si D1 se comporta como se espera. Si no, documentar el comportamiento real: el diseño de las tareas 4 y 11 cambia a "verificar `meta.changes` y compensar".

### Task 3: PBKDF2, Better-Auth sobre D1 y límites reales

**Files:**
- Create: `src/server/password.ts`, `tests/server/password.test.ts`, `docs/superpowers/plans/2026-11-03-resultados-fase-0.md`

**Interfaces:**
- Produces: `hashearClave(clave: string): Promise<string>` (formato `pbkdf2$<iteraciones>$<salt b64>$<hash b64>`), `verificarClave(clave: string, hash: string): Promise<boolean>`.

- [ ] **Step 1: Pruebas** en `password.test.ts`: `ida y vuelta` (verifica la misma clave → true); `clave incorrecta` → false; `sal distinta` (dos hashes de la misma clave difieren); `formato` (cumple la regex `^pbkdf2\$\d+\$`); `hash mal formado` → false sin lanzar.
- [ ] **Step 2:** Ejecutar → fallan. Implementar con `crypto.subtle` (SHA-256, sal de 16 bytes, comparación en tiempo constante); iteraciones en una constante `ITERACIONES_PBKDF2` calibrada para que `hashearClave` tarde <10 ms de CPU en `wrangler dev` (anotar el valor y la medición).
- [ ] **Step 3:** Prueba de arranque de Better-Auth (en `tests/server/spike-auth.test.ts`): con el adaptador Drizzle/D1 y `emailAndPassword.disableSignUp: true`, el endpoint público de registro responde 4xx.
- [ ] **Step 4:** Con `WebFetch`, leer la documentación vigente de límites de Workers, D1 y R2 y los planes gratuitos; anotar en `2026-11-03-resultados-fase-0.md`: resultados de las tareas 1–3, límites verificados (peticiones/día, CPU por petición, filas leídas/escritas de D1, R2 y si exige tarjeta) y cualquier diferencia con las cifras del spec.
- [ ] **Step 5: GATE:** presentar el documento de resultados al dueño y esperar su visto bueno antes de la fase 1. Pedir autorización de commit de la fase 0.

---

## FASE 1 — Esquema y semilla

### Task 4: Esquema D1 con triggers

**Files:**
- Create: `migrations/0001_d1_schema.sql`, `tests/server/esquema.test.ts`

**Interfaces:**
- Produces: las tablas `locales, modelos_telefono, productos, compatibilidades, inventario_local, movimientos_inventario, unidades_producto, ventas, devoluciones, tasas_cambio, ordenes_servicio, empleados, nominas, nomina_reventas, cuadres_caja, suscripcion_eventos, perfiles, contadores, cambios` + las de Better-Auth (`user, session, account, verification`). Columnas y nombres **iguales a las migraciones de Postgres** convertidos según "Global Constraints". `locales.tipo` admite `accesorios, vidrios, servicio_tecnico, controles`.

- [ ] **Step 1: Pruebas** en `esquema.test.ts` (cada una aplica `0001` sobre D1 vacío): `aplica sin errores`; `stock negativo`: insertar un `inventario_local` con 2 unidades y una SALIDA de 3 → falla con `Stock insuficiente`; `código de unidad único`; `cuadre cerrado inmutable`: actualizar un cuadre CERRADO a CERRADO con otro `notas` falla con `Este cuadre ya está cerrado y no se puede modificar.` pero CERRADO→ABIERTO se permite; `nómina pagada inmutable` (update y delete fallan); `total de nómina`: `pago_base + bonos - deducciones != total_pagado` viola el CHECK; `reventa por debajo del precio de lista` viola el CHECK; `empleado independiente con frecuencia QUINCENAL` viola el CHECK; `orden de servicio en un local que no es de servicio técnico` falla; `un cuadre por local y día`.
- [ ] **Step 2:** Ejecutar → fallan. Escribir la migración (índices, UNIQUE y CHECK de la sección "Reglas que se conservan" del spec §6; triggers `RAISE(ABORT, …)` con los mensajes actuales).
- [ ] **Step 3:** `npx vitest run tests/server/esquema.test.ts` → pasan.

### Task 5: Esquema Drizzle y utilidades

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/db/cliente.ts`, `src/server/util.ts`, `tests/server/util.test.ts`

**Interfaces:**
- Produces: `bd(env: Entorno): DrizzleD1Database<typeof schema>`; tipo personalizado `json<T>()` para columnas JSON; las utilidades de "Contratos compartidos".

- [ ] **Step 1: Pruebas** (`util.test.ts`): `redondear2(1.005 + 1.005)` = 2.01 y `redondear2(0.1 + 0.2)` = 0.3; `nuevoId()` produce UUID distintos; `ahoraISO()` cumple `/^\d{4}-\d\d-\d\dT.*Z$/`; `sentenciaContador` dos veces seguidas en un `batch` devuelve 1 y 2 y es independiente por nombre.
- [ ] **Step 2:** Implementar `util.ts`, `schema.ts` (espejo de la migración 0001, solo para consultas) y `cliente.ts`; prueba de ida y vuelta de una fila con columna JSON en `bd(env)`.

### Task 6: Semilla de locales y modelos

**Files:**
- Create: `scripts/generar-seed.mjs`, `migrations/0002_seed.sql`, `tests/server/seed.test.ts`
- Modify: `src/lib/constantes-locales.ts` (cuarto local `controles`, ids), `src/types/database.types.ts` (`TipoLocal` + `'controles'`)

- [ ] **Step 1: Pruebas** (`seed.test.ts`): tras `0001` + `0002` hay exactamente 4 locales con los ids del spec y `subscription_status = 'ACTIVE'`; el número de modelos coincide con el de `src/lib/catalogo-modelos.ts`; `SELECT count(*) FROM productos` = 0; existen los contadores `ventas`, `devoluciones`, `ordenes_servicio`, `unidades` con valor 0.
- [ ] **Step 2:** Implementar el generador (lee `catalogo-modelos.ts`, escribe `0002_seed.sql`; ejecutable con `node scripts/generar-seed.mjs`); `constantes-locales.ts` pasa a exponer los 4 ids y el modo demo gana el cuarto local vacío (revisar `localesPorDefecto()` y `mock-data.ts`).
- [ ] **Step 3:** Pruebas pasan; `npx astro check` sin errores. Pedir autorización de commit de la fase 1.

---

## FASE 2 — Autenticación y autorización

### Task 7: Servidor de autenticación

**Files:**
- Create: `src/server/auth.ts`, `src/pages/api/auth/[...todo].ts`, `tests/server/auth.test.ts`

**Interfaces:**
- Produces: `crearAuth(env: Entorno)` (Better-Auth con adaptador Drizzle/D1, `hashearClave`/`verificarClave` como hasher, registro público deshabilitado, cookies de sesión del mismo origen); `crearUsuarioInterno(env, datos: { email: string; nombre: string; clave: string; rol: Rol; localId: string | null }): Promise<string /* userId */>` (usa el adaptador interno de Better-Auth y crea la fila de `perfiles`).

- [ ] **Step 1: Pruebas:** `el registro público está cerrado` (POST al endpoint de sign-up → 4xx); `inicia sesión con la clave correcta y devuelve cookie`; `rechaza clave incorrecta` (mensaje en español `Correo o contraseña incorrectos.`); `la sesión incluye el userId`; `crearUsuarioInterno` crea `user`, `account` (hash PBKDF2) y `perfiles`.
- [ ] **Step 2:** Ejecutar → fallan. Implementar. Las contraseñas nunca se registran en logs.

### Task 8: Autorización (reemplazo de RLS)

**Files:**
- Create: `src/server/errores.ts`, `src/server/authz.ts`, `src/server/http.ts`, `tests/server/authz.test.ts`

**Interfaces:** ver "Contratos compartidos". `alcanceDe` devuelve para: administrador `todos`; gerente `todos` si hay algún local vigente (si no, 403 `local_suspendido`); encargado/vendedor/técnico `locales: [su local]` solo si está vigente (si no, 403 `local_suspendido`); contador lanza 403 salvo que la ruta use `exigirRol` de nómina. Con `localSolicitado` el resultado se restringe a ese local si es accesible, si no 403.

- [ ] **Step 1: Pruebas** (`authz.test.ts`): una tabla por rol de `esAdministrador/esGlobal/esGerencia`; `cargarSesion rechaza sin cookie (401)`; `rechaza usuario inactivo (401, codigo usuario_inactivo)`; `rechaza sesión emitida antes de last_force_logout_at (401, codigo sesion_cerrada)`; `alcanceDe` para cada rol; `local suspendido excluido para vendedor (403)`; `local con subscription_expires_at pasado cuenta como bloqueado`; `todos los locales bloqueados: gerente y contador 403, administrador pasa`; `encargado pidiendo otro local: 403`; `conSesion convierte ErrorApi en JSON {error, codigo} con su status`.
- [ ] **Step 2:** Implementar. `conSesion` carga la sesión, ejecuta el handler y serializa; ningún handler accede a `request` sin pasar por él salvo la lista blanca de la tarea 23.

### Task 9: Cuenta, suscripciones y usuarios

**Files:**
- Create: `src/server/servicios/cuenta.ts`, `src/server/servicios/usuarios.ts`, `src/server/repos/usuarios.ts`, `src/pages/api/cuenta/estado.ts`, `src/pages/api/suscripciones/[...ruta].ts`, `src/pages/api/usuarios/[...ruta].ts`, `tests/server/usuarios.test.ts`

**Interfaces:**
- Produces (en `servicios/cuenta.ts` y `usuarios.ts`): `estadoCuenta(env, sesion): Promise<{ acceso: boolean; motivo: 'ok'|'local_suspendido'|'usuario_inactivo'|'sesion_cerrada'|'sin_perfil'; local_nombre?: string; subscription_status?: string }>`; `cambiarSuscripcionLocal(env, sesion, localId: string, estado: 'ACTIVE'|'SUSPENDED'|'PAST_DUE', vence: string | null, cambiarVencimiento: boolean)`; `cerrarSesionForzada(env, sesion, usuarioId: string)`; `cerrarSesionesLocal(env, sesion, localId: string)`; `listarUsuariosSistema(env, sesion)`; `crearUsuario(env, sesion, datos)`; `actualizarUsuario(env, sesion, id, cambios: { rol?: Rol; localId?: string | null; status?: 'active'|'inactive' })`; `eliminarUsuario(env, sesion, id)`; `cambiarClaveUsuario(env, sesion, id, clave: string)`.

- [ ] **Step 1: Pruebas** (reglas de `auth.ts` actual: `rolesAsignables`, `puedeGestionarUsuario`): el administrador crea cualquier rol; el gerente solo encargado/vendedor/técnico y **no ve** administradores en `listarUsuariosSistema`; el encargado recibe 403 en todo; nadie cambia su propio rol ni estado; el administrador no puede eliminarse a sí mismo; `cambiarClaveUsuario` borra las sesiones del usuario objetivo (su cookie deja de servir); `cerrarSesionForzada` hace que su cookie falle con `sesion_cerrada`; `cerrarSesionesLocal` afecta solo a usuarios de ese local; solo el administrador cambia suscripciones y cada cambio queda en `suscripcion_eventos`; `estadoCuenta` devuelve los motivos del spec.
- [ ] **Step 2:** Implementar; las rutas validan con zod. Pedir autorización de commit de la fase 2.

---

## FASE 3 — API por módulo

> Patrón de cada tarea: pruebas con las reglas del módulo (usar los escenarios de las migraciones y de `inventoryService.ts` como especificación), repos que **exigen `Alcance`**, servicios y rutas finas. Las firmas de respuesta replican los tipos de `src/types/database.types.ts`.

### Task 10: Locales, modelos, catálogo y tasas

**Files:**
- Create: `src/server/repos/{locales,modelos,productos,tasas}.ts`, `src/server/servicios/{catalogo,tasas}.ts`, `src/pages/api/{locales,modelos,productos,tasas}/…`, `tests/server/catalogo.test.ts`

**Interfaces:**
- Produces: `listarProductosConInventario(env, alcance): Promise<(Producto & { inventario: InventarioLocal[] })[]>` (solo filas de inventario dentro del alcance); `crearProducto`, `actualizarProducto`, `eliminarProducto`, `crearProductosLote`, `reemplazarCompatibilidadesLote`, `fijarMinimosLote(localId, filas)`, `asegurarEnLocal(localId, productoIds)`; `registrarTasa(env, sesion, { fecha, tasa, registrado_nombre })`, `obtenerUltimaTasa`.

- [ ] **Step 1: Pruebas:** vendedor no crea ni edita productos (403); encargado crea y edita pero **no elimina**; administrador/gerente eliminan; `listarProductosConInventario` para un encargado devuelve solo su local; para gerente todos; `codigo_barras` duplicado → `Ya existe un producto con el código de barras X.`; cualquier rol autenticado (menos contador) registra tasa; `fijarMinimosLote` no toca `stock_actual`; el contador recibe 403 en catálogo.
- [ ] **Step 2:** Implementar y pasar.

### Task 11: Movimientos y unidades con código único

**Files:**
- Create: `src/server/repos/{movimientos,unidades}.ts`, `src/server/servicios/movimientos.ts`, `src/pages/api/{movimientos,unidades}/…`, `tests/server/movimientos.test.ts`

**Interfaces:**
- Produces: `registrarMovimiento(env, sesion, input: { productoId: string; tipo: 'ENTRADA'|'SALIDA'; cantidad: number; motivo?: string; localId: string; unidadCodigos?: string[] }): Promise<{ movimiento: MovimientoInventario; unidadCodigos: string[] }>`; `registrarMovimientosLote(env, sesion, filas: input[])`; `listarMovimientos(env, alcance, limite)`; `listarUnidades(env, alcance, filtro: { productoId?: string; estado?: 'DISPONIBLE'|'VENDIDA'; sinImprimir?: boolean; codigos?: string[] })`; `marcarUnidadesImpresas(env, sesion, codigos: string[]): Promise<number>`. Los códigos nuevos usan `construirCodigoUnidad` de `src/utils/codigos.ts` con el contador `unidades`.

- [ ] **Step 1: Pruebas** (portar los de `probar33.mjs`): ENTRADA de N crea N unidades con 13 dígitos y prefijo `21`; SALIDA con una unidad indicada la marca VENDIDA y completa FIFO; unidad ya vendida, de otro local, de otro producto, códigos repetidos o más códigos que cantidad → rechazo y **nada cambia**; cantidad mayor al stock → `Stock insuficiente…`; devolución (ENTRADA con códigos) reactiva esa unidad y crea el resto; `unidades DISPONIBLES = stock_actual` tras cada operación; vendedor puede SALIDA en su local pero no ENTRADA (403); encargado ENTRADA solo en su local; **dos `registrarMovimiento` simultáneos de la misma unidad: exactamente uno tiene éxito**; `marcarUnidadesImpresas` solo para administrador/gerente/encargado y solo de locales accesibles.
- [ ] **Step 2:** Implementar con un `db.batch` por movimiento; los triggers de la tarea 4 son la red de seguridad.

### Task 12: Ventas y devoluciones

**Files:**
- Create: `src/server/repos/{ventas,devoluciones}.ts`, `src/server/servicios/ventas.ts`, `src/pages/api/{ventas,devoluciones}/…`, `tests/server/ventas.test.ts`

**Interfaces:**
- Produces: `guardarVenta(env, sesion, venta: NuevaVenta): Promise<Venta>` (folio con el contador `ventas`; `vendedor_id = sesion.userId`); `listarVentas(env, sesion, alcance, { desde?, hasta?, limite })`; `guardarDevolucion(env, sesion, d: NuevaDevolucion): Promise<Devolucion>` (solo administrador/gerente/encargado); `listarDevoluciones(env, sesion, alcance, { ventaId?, limite })`.

- [ ] **Step 1: Pruebas:** folios correlativos sin repetirse; el vendedor solo lista **sus** ventas y el encargado todas las de su local; vendedor no puede guardar una venta en otro local (403); el vendedor no puede devolver (403); la devolución guarda `local_id` de la venta; `listarVentas` respeta `desde/hasta`; gerente/administrador ven todos los locales; sin sesión 401.

### Task 13: Órdenes de servicio

**Files:**
- Create: `src/server/repos/ordenes.ts`, `src/server/servicios/ordenes.ts`, `src/pages/api/ordenes/…`, `tests/server/ordenes.test.ts`

**Interfaces:**
- Produces: `crearOrden`, `actualizarOrden(id, cambios)`, `listarOrdenes(env, alcance, limite)`; los sellos `listo_en` y `entregada_en` los pone el trigger de la tarea 4.

- [ ] **Step 1: Pruebas:** solo en locales `servicio_tecnico`; `Entregado` es final (editar → error); el técnico crea y actualiza en su local, no en otro; `total_usd = repuestos + mano de obra`; el vendedor recibe 403.

### Task 14: Archivos privados/públicos y cuadre de caja

**Files:**
- Create: `src/server/repos/cuadres.ts`, `src/server/servicios/{cuadres,archivos}.ts`, `src/pages/api/archivos/[...ruta].ts`, `src/pages/api/cuadres/…`, `tests/server/cuadres.test.ts`

**Interfaces:**
- Produces: `guardarCuadre(env, sesion, datos: { localId; fecha; estado; esperado; contado; fotos; notas; cerradoPor? }): Promise<CuadreCaja>`; `reabrirCuadre(env, sesion, id)` (solo administrador/gerente); `listarCuadresDelDia(env, alcance, fecha)`; `obtenerCuadre(env, alcance, localId, fecha)`; `subirArchivoPrivado(env, sesion, ruta, blob, tipoMime)`; `leerArchivoPrivado(env, sesion, ruta): Promise<Response>`; `borrarArchivosPrivados(env, sesion, rutas)`; `subirFotoProducto(env, sesion, productoId, blob): Promise<string /* URL pública absoluta */>`.

- [ ] **Step 1: Pruebas:** un cuadre por local y día; cierre inmutable; encargado solo su local, administrador/gerente todos, vendedor/técnico/contador 403; reabrir solo global; **subir o borrar fotos en un cuadre CERRADO**: 403 salvo global; **leer un comprobante de otro local**: 403; tipo `.pdf` y archivos >5 MB rechazados; la foto de producto devuelve URL que empieza por `URL_FOTOS_PUBLICAS`; el contador lee comprobantes de nómina de cualquier local vigente pero no fotos de cuadre.

### Task 15: Nómina

**Files:**
- Create: `src/server/repos/nomina.ts`, `src/server/servicios/nomina.ts`, `src/pages/api/nomina/…`, `tests/server/nomina.test.ts`

**Interfaces:**
- Produces: `listarEmpleados`, `crearEmpleado`, `actualizarEmpleado`, `listarNominas(env, sesion, desde, hasta)`, `guardarPagoQuincenal(env, sesion, datos)`, `eliminarPagoPendiente`, `catalogoReventa(env, sesion, texto, limite): Promise<ProductoReventa[]>`, `guardarPagoIndependiente(env, sesion, datos): Promise<string /* nomina id */>`, `listarReventas(env, sesion, nominaIds)`.

- [ ] **Step 1: Pruebas:** solo administrador/gerente/contador (los demás 403, incluso con alcance de su local); pagado inmutable; `guardarPagoIndependiente` calcula `Σ cantidad × (vendido − lista)` y rechaza vender bajo el precio de lista; `catalogoReventa` no devuelve costos ni stock y no sirve con texto vacío; la cédula del empleado es única; el tipo de trabajador no cambia tras crearlo; no se paga un día ya pagado.

### Task 16: Consulta de cambios (tiempo real)

**Files:**
- Create: `src/server/servicios/cambios.ts`, `src/pages/api/cambios.ts`, `tests/server/cambios.test.ts`
- Modify: los servicios de las tareas 10–15 para llamar `registrarCambio(db, tablas, localId)` dentro de su `batch`

**Interfaces:**
- Produces: `sentenciaCambio(db: D1Database, tabla: string, localId: string | null): D1PreparedStatement`; `versionesVisibles(env, sesion): Promise<{ tabla: string; local_id: string | null; version: number }[]>`.

- [ ] **Step 1: Pruebas:** una venta sube la versión de `ventas`, `movimientos_inventario`, `inventario_local` y `unidades_producto` de **ese** local; el vendedor no ve versiones de `nominas`, `empleados` ni `cuadres_caja`; el encargado solo las de su local; el contador solo las de nómina y locales.

**Checkpoint de fase 3:** `npx vitest run` completo en verde; pedir autorización de commit.

---

## FASE 4 — Cliente

### Task 17: Cliente de API, modo servidor y autenticación

**Files:**
- Create: `src/lib/api.ts`, `src/lib/modo.ts`, `tests/cliente/api.test.ts`
- Modify: `src/lib/auth.ts` (725 líneas: reemplazar los 18 usos de Supabase Auth conservando cada función exportada), `src/pages/login.astro`, y el renombrado `supabaseConfigurado` → `modoServidor` en `inventoryService.ts`, `auth.ts`, `realtime.ts`, `login.astro`
- Delete: `src/lib/supabase.ts`

**Interfaces:**
- Produces: `export const modoServidor: boolean` (`import.meta.env.PUBLIC_USAR_API === 'true'`); `api.get<T>(ruta, query?)`, `api.post<T>(ruta, cuerpo)`, `api.put<T>`, `api.delete<T>`, `api.subir(ruta, blob, tipoMime): Promise<string>` — todas con `credentials: 'include'`, errores como `Error` con el mensaje en español del servidor; un fallo de red lanza un error cuyo mensaje coincide con `esErrorDeRed` de `inventoryService.ts`.

- [ ] **Step 1: Pruebas** (`api.test.ts`, con `fetch` simulado): una respuesta `{error: 'X'}` con 403 lanza `Error('X')`; un `TypeError('Failed to fetch')` produce un error que `esErrorDeRed` reconoce; `api.get` serializa el query.
- [ ] **Step 2:** Implementar y reescribir `auth.ts` (el guardia `protegerPagina`, `obtenerEstadoCuenta` y `iniciarVigilanciaCuenta` siguen igual hacia afuera). El modo demo se mantiene intacto (verificar en la tarea 20).

### Task 18: Módulos `db/*` hacia la API (tres lotes)

**Files:**
- Modify: `src/lib/db/{productos,modelos,tasas,locales,movimientos,unidades,ventas,devoluciones,ordenes,nomina,cuadres}.ts`, `src/lib/db/index.ts`

- [ ] **Step 1 (catálogo, movimientos, unidades):** mismas firmas exportadas, ahora con `api.*`; las fotos de producto usan `api.subir` y guardan la URL pública. Verificar con `npx astro check` y probar en el navegador (modo servidor contra `wrangler dev`): listar productos, importar un CSV de 3 filas con stock, ver las unidades.
- [ ] **Step 2 (ventas, devoluciones, órdenes, tasas, locales):** igual; verificar una venta con unidad escaneada, una devolución y una orden de servicio.
- [ ] **Step 3 (nómina, cuadres):** igual (`urlComprobanteNomina` y `urlFotoCuadre` devuelven la URL de la API); verificar un pago con comprobante y un cuadre con foto y cierre.

### Task 19: Tiempo real por consulta periódica

**Files:**
- Modify: `src/lib/realtime.ts` (conserva `alCambiarDatos`, `iniciarTiempoReal`, `TABLAS_TIEMPO_REAL` y el evento `easystem:datos-cambiaron`)
- Create: `tests/cliente/realtime.test.ts`

- [ ] **Step 1: Pruebas** (reloj falso): `consulta cada 5 s con la pestaña visible`; `no consulta con la pestaña oculta ni tras 3 minutos sin actividad`; `emite el evento solo para las tablas cuya versión cambió`; `al volver a verse consulta de inmediato`; la primera consulta fija la línea base y **no** emite.
- [ ] **Step 2:** Implementar; en modo demo se conserva el mecanismo del evento `storage`.

### Task 20: Modo demo con 4 locales

**Files:**
- Modify: `src/lib/mock-data.ts`, `src/lib/inventoryService.ts` (migración de LocalStorage que agrega el cuarto local a navegadores existentes), `src/components/layout/LocalSwitcher.astro`, `src/lib/navLinks.ts` si hiciera falta

- [ ] **Step 1:** Con `PUBLIC_USAR_API` ausente: iniciar sesión con las cuentas demo, ver los 4 locales (el cuarto vacío), vender en Accesorios y cuadrar caja; `npx astro check` y `npx astro build` sin errores. Pedir autorización de commit de la fase 4.

---

## FASE 5 — Scripts operativos

### Task 21: Crear el administrador del dueño

**Files:**
- Create: `scripts/crear-admin.mjs`, `tests/scripts/crear-admin.test.ts`

**Interfaces:**
- Produces: `node scripts/crear-admin.mjs --db local|remote` pide **por consola** correo y nombre, genera una clave aleatoria de 16 caracteres, la muestra una sola vez y ejecuta el alta con `wrangler d1 execute` (hash PBKDF2 calculado con `hashearClave`).

- [ ] **Step 1: Pruebas:** la clave generada tiene 16 caracteres y se produce con `crypto.getRandomValues`; el SQL generado inserta `user`, `account` y `perfiles` (rol `administrador`, `local_id` nulo) y **no contiene la clave en claro**; rechaza correos inválidos.
- [ ] **Step 2:** Implementar y probar contra la base local con `npm run db:local`.

### Task 22: Carga inicial del Local de controles

**Files:**
- Create: `scripts/cargar-controles.mjs`, `scripts/lib/leer-inventario.mjs`, `tests/scripts/cargar-controles.test.ts`, `tests/scripts/fixtures/` (CSV y 3 imágenes falsas)

**Interfaces:**
- Produces: `leerInventario(carpeta: string): Promise<{ filas: FilaControl[]; problemas: string[] }>` con `FilaControl = { nombre: string; precio_venta: number; cantidad: number; foto: string; codigo_fabrica?: string; precio_compra?: number; stock_minimo?: number }`; el script `node scripts/cargar-controles.mjs --api <url> --email <correo>` (la clave se pide por consola).

- [ ] **Step 1: Pruebas** (con fixtures): `lee un CSV válido`; `detecta foto faltante`; `detecta precio no numérico o negativo`; `detecta cantidad no entera`; `detecta nombres repetidos`; `no escribe nada si hay problemas` (el cliente de API simulado no recibe llamadas); `con datos válidos` crea los productos con `importarProductos`-equivalente, sube las fotos reducidas a ≤720 px y deja el stock como movimiento `Carga inicial (importación)` en el Local de controles (id `…0004`).
- [ ] **Step 2:** Implementar: valida, imprime el **resumen** (productos, unidades, problemas) y pide confirmación antes de escribir; usa la API como administrador (mismo camino que el importador y las fotos). Probar con los fixtures contra `wrangler dev`.

---

## FASE 6 — Verificación completa y retiro de Supabase/Vercel

### Task 23: Matriz de rutas y roles

**Files:**
- Create: `tests/server/matriz-roles.test.ts`, `tests/server/rutas-protegidas.test.ts`

- [ ] **Step 1: Prueba `rutas-protegidas`:** recorre `src/pages/api/**`; cada archivo debe usar `conSesion` salvo la lista blanca `salud`, `auth/*` y `archivos/publico/*`.
- [ ] **Step 2: Prueba `matriz-roles`:** una tabla `{ ruta, método, permitidos: Rol[] }` por endpoint; para cada rol y para "sin sesión" verifica 200 (o 2xx) frente a 401/403 según corresponda, incluyendo las reglas de suscripción vigente y de usuario inactivo (Review Focus 1, 2 y 5).

### Task 24: Prueba manual completa y recorrido por rol

**Files:**
- Create: `docs/superpowers/plans/2026-11-03-recorrido-manual.md` (lista de verificación con el resultado de cada paso)

- [ ] **Step 1:** Con `wrangler dev` y `PUBLIC_USAR_API=true`: login del administrador creado; crear gerente, encargado, vendedor, técnico y contador; para cada uno comprobar menú y acceso; venta con unidad escaneada (cámara simulada), devolución, ingreso con etiquetas, órdenes de servicio, cuadre con fotos y cierre, reabrir, nómina fija e independiente, suscripción suspendida, sesión forzada, actualización en vivo entre dos pestañas (≤5 s). Registrar cada resultado. Corregir y volver a probar lo que falle.

### Task 25: Documentación y limpieza

**Files:**
- Modify: `AGENTS.md` (arquitectura nueva; quitar lo específico de Supabase), `README.md`, `package.json` (script `backup` → `wrangler d1 export`)
- Delete: `vercel.json`, `netlify.toml`, `scripts/backup.mjs`
- Keep archivada: `supabase/` hasta que el dueño apruebe borrarla

- [ ] **Step 1:** Actualizar la documentación (capa de datos, autorización, auth, archivos, tiempo real, scripts, despliegue) y comprobar `npx astro check`, `npx vitest run` y `npx astro build` en verde. Pedir autorización de commit de las fases 5 y 6.

---

## FASE 7 — Despliegue (con el dueño)

### Task 26: Cuenta de Cloudflare, datos y despliegue

**Files:**
- Modify: `wrangler.jsonc` (`database_id` real, `URL_FOTOS_PUBLICAS`), variables de entorno en la plataforma

- [ ] **Step 1:** El dueño ejecuta `npx wrangler login`. **Avisar y esperar su visto bueno** antes de crear recursos: `npx wrangler d1 create easystem`, `npx wrangler r2 bucket create easystem-fotos-publicas` y `easystem-fotos-privadas` (confirmar con él si R2 pide tarjeta), y la clave pública de R2 (r2.dev o dominio propio).
- [ ] **Step 2:** `npx wrangler d1 migrations apply easystem --remote`; `npx wrangler secret put BETTER_AUTH_SECRET`; `node scripts/crear-admin.mjs --db remote` (el dueño da su correo y nombre; la clave se muestra una vez); `npx wrangler deploy`.
- [ ] **Step 3:** Con los archivos de `datos-controles/` entregados: `node scripts/cargar-controles.mjs` primero contra la API local (resumen y confirmación) y, con su visto bueno, contra la de producción. Repetir el recorrido de la tarea 24 sobre producción con el administrador.
- [ ] **Step 4:** Conectar el repositorio de GitHub para despliegue automático; con el visto bueno del dueño apagar Vercel y Supabase y, solo si él lo aprueba, borrar `supabase/` del repositorio. Pedir autorización de commit/push final.

---

## Autorrevisión

- **Cobertura del spec:** §2–3 restricciones → Global Constraints y tareas 1–3; §6 esquema y semilla → tareas 4–6; §7 autorización → 8; §8 triggers/RPC → 9–16 (mapeo uno a uno: movimientos 11, nómina 15, cuadre 14, usuarios 9); §9 auth → 7, 9, 21; §10 archivos → 14; §11 tiempo real → 16 y 19; §12 cliente → 17–20; §13 pruebas → en cada tarea y 23–24; §14 fases → fases 0–7; carga de controles → 22 y 26.
- **Consistencia de tipos:** `Entorno`, `Sesion`, `Alcance`, `ErrorApi`, `conSesion`, `registrarMovimiento`, `guardarCuadre` y `sentenciaContador` se usan con las mismas firmas en las tareas que los consumen.
- **Dimensión:** el plan nombra interfaces y pruebas y deja los cuerpos al implementador.
