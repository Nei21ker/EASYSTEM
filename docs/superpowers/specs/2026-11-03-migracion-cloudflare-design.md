# Migración de EASYSTEM a Cloudflare — diseño

Fecha: 2026-11-03. Estado: **borrador para aprobación** (no se ha escrito código de la migración). Revisado el 2026-11-03 con las decisiones del dueño: sin migrar usuarios ni datos, sin productos de ejemplo en Cloudflare, 4 locales (los 3 actuales + Local de controles), actualización en vivo cada 5 s.

## 1. Intención

EASYSTEM (inventario, POS, nómina y cuadre de caja de Edward Accesorios) corre hoy en **Vercel (hosting estático) + Supabase (Postgres, Auth, Storage, Realtime)**. Se migra todo a **Cloudflare** para pagar **un solo plan** el día que el sistema supere el nivel gratuito, en vez de dos proveedores.

La migración se hace ahora porque el sistema **no está en producción**: no hay clientes ni dinero real que proteger, así que se puede construir con calma en una rama y cambiar de golpe al final.

## 2. Objetivos, no-objetivos y anti-objetivos

**Objetivos**
- Todas las funciones actuales siguen existiendo y comportándose igual para el usuario: multi-local, POS con códigos únicos por unidad, pagos mixtos, vuelto, devoluciones, servicio técnico, nómina (fijos e independientes), cuadre de caja con fotos, suscripciones por local, jerarquía de roles, actualización en vivo, modo offline del POS, etiquetas.
- Quedarse dentro de los límites gratuitos de Cloudflare con el uso previsto (uno a pocos locales).
- Mantener el **modo demo con LocalStorage** (se usa en `astro dev` sin servidor).
- Al terminar existe **un usuario administrador** para el dueño; los demás los crea él desde `/usuarios`.
- El sistema arranca con **4 locales**: Local Accesorios, Local Vidrios, Local Servicio Técnico y el nuevo **Local de controles** (controles de TV, aires acondicionados y smart TV, más cargadores). El primer uso real es el Local de controles, con el conteo real de sus cargadores (foto, cantidad, modelo y precio). **El dueño entrega los datos y las fotos y Claude los carga** (§6, “Carga inicial del Local de controles”). Los otros locales empiezan vacíos.

**No-objetivos**
- No se migra **ningún dato de Supabase**: ni productos, stock, ventas, devoluciones, órdenes, nómina, cuadres, ni usuarios ni contraseñas. **Se empieza desde cero** (decisión del dueño). Lo único que se siembra es lo que define el sistema: los 4 locales y el catálogo de modelos de teléfono (§6). **Ningún producto, ni real ni de ejemplo**: los de ejemplo se quedan en el modo demo.
- No se cambia la interfaz ni el flujo de ninguna pantalla.
- No hay multi-empresa (sigue siendo un solo cliente).

**Anti-objetivos (sería un fracaso aunque “funcione”)**
- Que un usuario vea o modifique datos de un local que no le corresponde: hoy lo impide la base de datos (RLS), y esa garantía **no puede perderse** en el cambio.
- Que se exceda el nivel gratuito por diseño (p. ej. una petición al Worker por cada imagen de producto).
- Que se rompa el modo demo.

## 3. Restricciones

- Planes gratuitos a respetar (cifras de memoria, **verificar en la fase 0**): Workers 100 mil peticiones/día y ~10 ms de CPU por petición; D1 5 GB, 5 M lecturas y 100 mil escrituras por día; R2 10 GB (puede exigir tarjeta registrada para activarse).
- Las páginas actuales se sirven como **archivos estáticos**; en Workers los archivos estáticos no consumen peticiones del Worker. Por eso **el sitio sigue siendo estático** y solo `/api/*` corre código de servidor.
- D1 **no** tiene transacciones interactivas: solo lotes atómicos (`db.batch`). Sí admite triggers de SQLite.
- Astro 7.3 + `@astrojs/cloudflare`: compatibilidad **por confirmar**.

## 4. Decisiones

**Del dueño**: migración completa; costo es el motivo; conservar modo demo; arrancar todo de cero en Cloudflare (sin traer datos ni usuarios); al final se crea un usuario administrador para él y él crea los demás; **no hay productos de ejemplo en Cloudflare** (solo datos reales, que carga él; el stock real inicial es el de los cargadores del Local de controles); **4 locales por ahora** (los 3 actuales + Local de controles); actualización en vivo con **~5 s** de retraso (no 10); el corte de servicio no importa; ya tiene cuenta de Cloudflare.

**Mías (el dueño puede cambiarlas)**:
1. **Workers con archivos estáticos**, no Pages (Cloudflare parece empujar Workers para proyectos nuevos; se confirma en la fase 0).
2. **Sitio estático + API en `/api/*`** (rutas con `prerender = false`).
3. **Better-Auth** con adaptador Drizzle/D1 (Lucia está descontinuado). Registro público **deshabilitado**; solo el administrador/gerente crean usuarios, como hoy.
4. **Contraseñas con PBKDF2 (WebCrypto)**, no bcrypt/scrypt en JS, por el límite de CPU del plan gratuito.
5. **Drizzle ORM** para consultas (`drizzle-orm/d1`) y **migraciones SQL escritas a mano** en `migrations/` (drizzle-kit no genera triggers).
6. **Invariantes críticas como triggers/CHECK de SQLite** (stock no negativo, unidad disponible, cuadre cerrado inmutable, nómina pagada inmutable) + orquestación en TypeScript. Así un error de la API no puede corromper datos.
7. **Tiempo real por consulta periódica** cada **5 s** con la pestaña visible (no Durable Objects): ver §11. `realtime.ts` conserva su interfaz (`alCambiarDatos`) para poder pasar a Durable Objects (instantáneo) más adelante sin tocar las pantallas.
8. **Fotos de producto en un bucket R2 público**; **comprobantes de nómina y cuadres en R2 privado servido por el Worker** tras autorizar.
9. Validación de entradas en la API con **zod**.
10. El indicador `supabaseConfigurado` se renombra a `modoServidor` (verdadero cuando `PUBLIC_USAR_API=true` en el build; sin la variable = modo demo, igual que hoy).

## 5. Arquitectura destino

```
Navegador (páginas estáticas Astro + <script> cliente, igual que hoy)
   └─ inventoryService.ts / auth.ts  (mismas funciones públicas)
        ├─ modo demo ........ LocalStorage (sin cambios)
        └─ modo servidor .... src/lib/api.ts  ──fetch /api/*──►  Worker (Astro, rutas server)
                                                                  ├─ Better-Auth (sesión por cookie)
                                                                  ├─ authz (equivalente a RLS)
                                                                  ├─ servicios (equivalente a triggers/RPC)
                                                                  ├─ D1  (binding DB)
                                                                  └─ R2  (bindings FOTOS_PUBLICAS, FOTOS_PRIVADAS)
```

Las páginas y `inventoryService.ts` no cambian de contrato: los 12 archivos `src/lib/db/*.ts` mantienen sus funciones exportadas, pero por dentro llaman a la API en vez de a Supabase.

## 6. Esquema D1 (`migrations/0001_d1_schema.sql`)

**Conversión de tipos**
| Postgres | D1 / SQLite |
|---|---|
| `uuid` | `TEXT` (UUID generado en la API con `crypto.randomUUID()`) |
| `numeric(12,2)` | `REAL`, redondeado a 2 decimales en el código (igual que hoy en JS) |
| `timestamptz` | `TEXT` ISO-8601 UTC (`2026-11-03T12:00:00.000Z`) |
| `date` | `TEXT` `aaaa-mm-dd` |
| `jsonb` y `text[]` | `TEXT` con JSON, con `CHECK (json_valid(col))` |
| `enum` / `check in` | `TEXT` con `CHECK (col IN (...))` |
| `bigint identity` (folios) | tabla `contadores(nombre, valor)` incrementada dentro del lote |
| `boolean` | `INTEGER` 0/1 |
| `sequence` (códigos de unidad) | fila en `contadores` |

**Tablas (18 de negocio + las de Better-Auth)**: `locales`, `modelos_telefono`, `productos`, `compatibilidades`, `inventario_local`, `movimientos_inventario`, `unidades_producto`, `ventas`, `devoluciones`, `tasas_cambio`, `ordenes_servicio`, `empleados`, `nominas`, `nomina_reventas`, `cuadres_caja`, `suscripcion_eventos`, `perfiles`, y nuevas `contadores` y `cambios` (§11). Desaparece `usuarios_autorizados` (ya no hay registro público que filtrar). `perfiles` se conserva con `user_id` apuntando a la tabla `user` de Better-Auth (misma forma que hoy: rol, local_id, status, last_force_logout_at, nombre).

**Reglas que se conservan** (copiar de las migraciones 0001–0034): índices, UNIQUE (`cedula` de empleados, `local_id+fecha` de cuadres, `empleado_id+periodo` de nóminas), CHECK de nómina (`pago_base + bonos − deducciones = total_pagado`), CHECK de reventa (`precio_vendido >= precio_lista`), tipo/frecuencia de empleados, los cuatro ids fijos de local (`00000000-0000-4000-8000-00000000000{1,2,3,4}`).

**Triggers de SQLite** (con `RAISE(ABORT, 'mensaje')`, mensajes iguales a los actuales): no dejar stock negativo; salida/entrada de unidades solo en estados válidos; `preparar_cuadre_caja` (cerrado inmutable, solo reabre administrador/gerente → esto último se valida en la API; el trigger bloquea cualquier otra edición); `preparar_nomina` (pagado inmutable, `local_id` desde el empleado); `preparar_orden_servicio` (solo locales de servicio técnico; sellos de fecha).

**Semilla** (`migrations/0002_seed.sql`, generada por `scripts/generar-seed.mjs`):
- Los **4 locales** con suscripción ACTIVE y ids fijos: los tres actuales (`…0001` Accesorios, `…0002` Vidrios, `…0003` Servicio Técnico) y el nuevo **Local de controles** (`00000000-0000-4000-8000-000000000004`). El campo `tipo` admite un cuarto valor, `controles` (se comporta como los locales genéricos: solo `servicio_tecnico` tiene órdenes de servicio). Los ids viven hoy como constantes en `src/lib/constantes-locales.ts`; se agrega el cuarto y el resto del código lee los locales de la base de datos (no de una lista fija), de modo que sumar locales después sea solo agregar una fila (y, más adelante, una pantalla para crearlos).
- El catálogo de modelos de `src/lib/catalogo-modelos.ts` y los contadores en cero.
- **Ningún producto en la semilla**, ni de ejemplo ni real, y sin movimientos, unidades, tasa, ventas ni órdenes.
- **Carga inicial del Local de controles** (fase 7, después de que la API funcione): el dueño entrega el inventario real de cargadores (modelo/nombre, precio de venta, cantidad y foto de cada uno; opcionalmente código de fábrica, categoría, precio de compra y stock mínimo) en una carpeta `datos-controles/` **ignorada por git** (no se sube al repositorio). `scripts/cargar-controles.mjs` lee ese archivo y las fotos, **valida** (precios y cantidades numéricos, nombres sin repetir, cada foto con su producto, tamaños de imagen) y muestra un resumen para confirmar antes de escribir. La carga **usa la API como el administrador** (el mismo camino del importador y de las fotos de producto), no SQL directo, para que cada unidad reciba su código único, el stock entre como un movimiento "Carga inicial (importación)" y se respeten todas las reglas. Primero se prueba en la base local y, con el visto bueno del dueño, se repite en la remota. Después el dueño imprime las etiquetas desde Ingreso de mercancía. Como las fotos se suben al R2 público, el script las reduce a ≤720 px igual que lo hace el navegador.
- **Modo demo (LocalStorage)**: sigue con sus datos de ejemplo para los tres locales de siempre, y gana el cuarto local, vacío.

## 7. Autorización (reemplazo de RLS)

Hoy hay 135 políticas y 8 funciones de acceso. Se reemplazan por **un único módulo** `src/server/authz.ts`:

- `cargarSesion(request)` → `{ userId, rol, localId, status }` leyendo la cookie de Better-Auth **y** `perfiles` en cada petición. Equivale a `usuario_habilitado()`: rechaza usuario inactivo o sesión emitida antes de `last_force_logout_at`.
- Helpers que reproducen exactamente `es_administrador / es_global / es_gerencia / es_contador / nomina_accesible / local_vigente / local_accesible / catalogo_accesible` (incluida la regla: suscripción vigente, caducidad, y que si **todos** los locales están bloqueados el gerente y el contador también lo están; el administrador nunca).
- **Regla de diseño anti-olvidos:** los repositorios de datos (`src/server/repos/*`) **no se pueden llamar sin un objeto `Alcance`** (`{ locales: string[] | 'todos' }`) que produce `alcanceDe(sesion, localSolicitado)`. Cada consulta aplica ese alcance en su `WHERE`; no existe una forma de listar ventas, stock, nómina, etc. sin pasar por él. Así, “olvidar el filtro por local” no compila.
- Cada ruta declara el rol mínimo (`exigirRol(sesion, [...])`) además del alcance. Las reglas por tabla se portan literalmente de las políticas (p. ej. vendedor solo ve sus ventas; encargado todas las de su local; `ENTRADA` solo administrador/gerente/encargado; contador solo nómina y locales; cuadres solo `es_gerencia`).

## 8. Triggers y RPC → servicios del servidor

| Hoy (Postgres) | Después |
|---|---|
| `aplicar_movimiento_inventario` + `preparar_unidades_movimiento` | `servicios/movimientos.ts`: una operación calcula unidades (nuevas con `ean13_unidad`, o FIFO, o las indicadas) y ejecuta **un `db.batch`** (movimiento, stock del local, total del producto, unidades). Los triggers de SQLite abortan el lote si algo no cuadra. `ean13_unidad`/`ean13_interno` se usan desde `src/utils/codigos.ts` (ya existe). |
| `preparar_orden_servicio`, `preparar_nomina`, `preparar_cuadre_caja` | triggers SQLite + validación en servicio |
| `estado_cuenta` | `GET /api/cuenta/estado` |
| `cambiar_suscripcion_local`, `cerrar_sesion_forzada`, `cerrar_sesiones_local`, `usuarios_sistema` | rutas solo-administrador |
| `eliminar_usuario`, `cambiar_clave_usuario` | rutas con las mismas reglas de jerarquía (`puedeGestionarUsuario`) |
| `catalogo_reventa` | ruta con campos limitados (sin costos ni stock) para administrador/gerente/contador |
| `guardar_pago_independiente` | servicio en un `db.batch` con las mismas validaciones |
| `marcar_unidades_impresas` | ruta (administrador/gerente/encargado) |
| `proteger_perfil` (nadie cambia su propio rol/estado), `manejar_nuevo_usuario`, `verificar_registro_autorizado` | validación en las rutas de usuarios; el registro público no existe |

Las ventas siguen **no siendo transaccionales entre líneas** (mismo comportamiento y mismo `VentaIncompletaError`); no se intenta mejorarlo en esta migración.

## 9. Autenticación y usuarios

- Better-Auth + D1 + Drizzle; cookie de sesión del mismo origen; **registro público desactivado**; el hasher de contraseñas personalizado usa PBKDF2 (SHA-256, iteraciones a calibrar en la fase 0 con el límite de CPU).
- `src/lib/auth.ts` conserva su API pública (`iniciarSesion`, `cerrarSesion`, `obtenerSesionActual`, `registrarUsuario`, helpers de rol, vigilancia de cuenta…); por dentro usa `src/lib/api.ts`. El guardia `protegerPagina` sigue en el cliente y **la API vuelve a validar todo**.
- **No se importa ningún usuario.** Al final (fase 7) un script `scripts/crear-admin.mjs` crea **un único usuario administrador** para el dueño: pide por consola su correo y nombre, genera una contraseña temporal aleatoria que se **muestra una sola vez** (nunca se pide ni se pasa por el chat) y emite el SQL para D1. El dueño entra, cambia la contraseña y crea desde `/usuarios` a los demás (gerente, encargados, vendedores, técnicos, contador), con las mismas reglas de jerarquía de hoy.

## 10. Archivos (R2)

- `FOTOS_PUBLICAS`: fotos de producto (≤720 px, ya reducidas en el navegador). Se guardan con su URL absoluta pública (`imagen_url` ya guarda URLs completas) para que **no** pasen por el Worker.
- `FOTOS_PRIVADAS`: `comprobantes-nomina` y `cuadres-caja`, con las mismas rutas (`<local>/…`). `PUT /api/archivos/privado/*` y `GET …` autorizan con las reglas de `comprobante_accesible`, `cuadre_foto_accesible` y `cuadre_foto_editable` (cuadre cerrado: solo administrador/gerente), validan tipo (jpg/jpeg/png/webp) y tamaño máximo. `urlComprobanteNomina` / `urlFotoCuadre` devuelven la URL de la API (misma origen, con cookie) en lugar de un enlace firmado.

## 11. Tiempo real

Tabla `cambios(tabla, local_id, version)`. Cada escritura exitosa sube la versión de las tablas tocadas **dentro del mismo lote**. `GET /api/cambios` devuelve las versiones **solo de las tablas y locales que el usuario puede leer** (un vendedor no recibe nada de nómina, igual que hoy con RLS). El cliente compara versiones **cada 5 s** mientras la pestaña esté visible y el usuario haya tenido actividad en los últimos minutos (se pausa en pestañas ocultas o inactivas; al volver a verse y al recuperar conexión, la comprobación es inmediata; tras una acción propia, la pantalla se refresca al instante) y dispara el mismo evento `easystem:datos-cambiaron`. Las pantallas no cambian.

**Por qué hay retraso y qué cuesta.** Con consulta periódica, cada dispositivo *pregunta* si algo cambió; el retraso máximo es el intervalo (5 s). No es una ventaja de costo del retraso en sí: es lo que cuesta no mantener una conexión abierta. La alternativa instantánea (Durable Objects con WebSocket) es más compleja y tiene sus propios límites de uso. Cada consulta cuenta como una petición al Worker (100 mil/día gratis): 10 dispositivos × 8 h × 720 por hora ≈ 58 mil/día, que cabe en el plan gratuito con pocos dispositivos; si el uso crece, el único plan de pago de Workers (unos 5 USD/mes, con 10 millones de peticiones incluidas) lo cubre de sobra. Pasar a Durable Objects queda como mejora posterior si hiciera falta ver los cambios al instante.

## 12. Cliente

- `src/lib/api.ts`: envoltorio de `fetch` (credenciales, errores con mensaje en español, detección de red para que `esErrorDeRed` y las colas offline sigan funcionando).
- `src/lib/db/*.ts`: misma firma, ahora llaman a la API. `src/lib/supabase.ts` desaparece; `package.json` pierde `@supabase/supabase-js` y gana `@astrojs/cloudflare`, `better-auth`, `drizzle-orm`, `zod`, y como dev `wrangler`, `drizzle-kit` (solo si hace falta), `vitest`.
- Cola offline del POS, caché de lecturas, modo demo y todas las pantallas: sin cambios de comportamiento.
- Se eliminan `vercel.json`, `netlify.toml`, `scripts/backup.mjs` (se reemplaza por `wrangler d1 export`) y, al final, la carpeta `supabase/` (se archiva hasta entonces).

## 13. Pruebas

No hay pruebas automáticas hoy; esta migración las exige porque la seguridad pasa de la base de datos al código.

- `npm test` con Vitest sobre un D1 local (en memoria / `wrangler`), portando como pruebas los escenarios que hoy se validan en PGlite: roles y alcance por local para **cada** ruta de lectura y escritura, unidades (venta, FIFO, devolución, doble venta), stock insuficiente, cuadre (un cuadre por día, cierre inmutable, reabrir, fotos), nómina (pagado inmutable, reventa), suscripción suspendida/vencida, sesión forzada, usuario inactivo.
- Pruebas manuales en el navegador con `wrangler dev`: login, venta con unidad escaneada, devolución, ingreso con etiquetas, cuadre con fotos, nómina, actualización en vivo entre dos pestañas, modo demo.

## 14. Fases y criterios de aceptación

0. **Spike (go/no-go)** en la rama `cloudflare`: (a) Astro 7.3 + adaptador compila el sitio estático y una ruta `/api` con D1 y R2 locales; (b) un trigger con `RAISE(ABORT)` aborta un `db.batch` y el mensaje llega a la API; (c) Better-Auth sobre D1 con registro deshabilitado, creación de usuarios por el administrador y hasher PBKDF2; (d) verificación de los límites vigentes de los planes gratuitos y si R2 pide tarjeta. *Si (a) o (c) fallan, se vuelve al dueño con alternativas antes de seguir.*
1. Esquema D1, semilla y esquema Drizzle.
2. Autenticación + `authz` + `Alcance`.
3. API por módulo, en este orden: locales/tasas/modelos/catálogo → movimientos y unidades → ventas/devoluciones → órdenes de servicio → cuadre y archivos → nómina → suscripciones y usuarios. Cada módulo termina con sus pruebas verdes.
4. Cliente (`api.ts`, `db/*`, `auth.ts`, `realtime.ts`) y modo demo verificado.
5. Generador de semilla (locales, modelos y catálogo con stock 0), script `crear-admin.mjs` y `npm run` para migrar/probar en local.
6. Pruebas completas y repaso de seguridad (cada ruta, con cada rol).
7. **Despliegue** (necesita al dueño): `wrangler login`, crear D1 y R2, aplicar migraciones, secretos (`BETTER_AUTH_SECRET`), crear el usuario administrador del dueño (`scripts/crear-admin.mjs`), desplegar Workers, conectar el repositorio de GitHub para despliegue automático, probar en producción y apagar Vercel/Supabase.

**Criterio de terminado:** `npm test` en verde; `astro check` y `build` sin errores; el modo demo funciona igual; el recorrido manual completo pasa con cada rol; ningún rol alcanza datos de otro local; el uso previsto cabe en los límites gratuitos.

## 15. Riesgos

| Riesgo | Mitigación |
|---|---|
| Fuga entre locales por un filtro olvidado | `Alcance` obligatorio en los repositorios + pruebas por rol en cada ruta |
| Compatibilidad Astro 7 / adaptador | Fase 0 con alternativa decidida con el dueño |
| Límite de CPU del plan gratuito (hash de contraseñas, lotes grandes) | PBKDF2 nativo; medir en la fase 0 y en el despliegue |
| Más peticiones al Worker de las previstas (imágenes, consulta periódica cada 5 s) | Fotos de producto públicas fuera del Worker; la consulta solo corre con la pestaña visible y con actividad; si se excede el plan gratuito, el plan de pago único lo cubre |
| Trabajo largo | Rama aparte, fases con criterio de salida, producción actual intacta |

## 16. Lo que queda al implementador

Nombres de rutas y esquemas zod, organización interna de `src/server/`, estructura exacta de los lotes SQL, iteraciones de PBKDF2, tamaño máximo de archivos, y el detalle visual de mensajes de error (en español, como hoy).

## 17. Pendiente del dueño

Nada bloquea el plan. Para la fase 7 se necesita: el **correo y nombre** del usuario administrador (la contraseña la genera el script y se muestra una sola vez), que el dueño ejecute `wrangler login` en su terminal, y que **entregue el inventario de cargadores** (archivo con modelo, precio, cantidad y fotos) en `datos-controles/`. Se puede entregar en cualquier momento antes de la fase 7; mientras tanto el script se prueba con datos falsos.
