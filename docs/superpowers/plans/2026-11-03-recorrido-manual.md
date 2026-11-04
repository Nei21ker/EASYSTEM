# Recorrido manual — EASYSTEM sobre Cloudflare (modo servidor)

Entorno: `PUBLIC_USAR_API=true astro build` + `npx wrangler dev` (Worker, D1 local y R2 local), navegador real, base vacía con las migraciones 0001 y 0002. Fecha: 2026-11-04.
Usuarios de prueba (solo en la base local): administrador creado con `scripts/crear-admin.mjs`; los demás, desde la API de usuarios con clave de prueba.

| # | Paso | Resultado |
|---|------|-----------|
| 1 | Crear el administrador con `crear-admin.mjs --db local` (clave aleatoria de 16 caracteres, mostrada una vez) | OK. Rechaza correo repetido y correo inválido |
| 2 | Iniciar sesión en `/login` (cookie de Better-Auth) | OK |
| 3 | Registrar la tasa del día desde el diálogo | OK (queda guardada en el servidor) |
| 4 | Crear gerente, encargado, vendedor, técnico, contador y un segundo vendedor | OK (6 altas) |
| 5 | Carga de controles con `cargar-controles.mjs` (3 productos, 20 unidades, 3 fotos) | OK: productos, stock como movimiento "Carga inicial (importación)", unidades con código EAN-13 prefijo 21, fotos públicas servidas por el Worker con caché de 1 año |
| 6 | Pantalla Productos con fotos, precios en $ y Bs. | OK |
| 7 | POS: escribir el código de una unidad en el lector, cobrar en dólares efectivo | OK: folio 1, la unidad pasa a VENDIDA, el stock baja, se muestra el ticket |
| 8 | Devolución de esa venta (Ventas realizadas → Devolución / cambio) | OK: la MISMA unidad vuelve a DISPONIBLE, stock restituido, reembolso guardado |
| 9 | Ingreso de mercancía desde `/ingreso` (3 unidades) | OK: 3 unidades nuevas con códigos distintos, "sin etiqueta" |
| 10 | Cuadre de caja: lo esperado lo calcula el servidor; contado, nota y foto de efectivo; guardar borrador | OK. La foto se sube a R2 privado y se lee con sesión |
| 11 | Cerrar cuadre (doble clic de confirmación) | OK, queda CERRADO |
| 12 | Reabrir cuadre (administrador) | OK, vuelve a ABIERTO |
| 13 | Nómina: crear empleado fijo e independiente; ver la quincena | OK: la página muestra la quincena ($150 de un salario de $300) |
| 14 | Contador: inicia sesión, cae en `/payroll`, el menú solo muestra Nómina; productos y ventas responden 403; el catálogo de reventa solo entrega id, código, nombre, categoría y precio | OK |
| 15 | Vendedor: menú Dashboard, POS, Productos, Modelos; usuarios y nómina responden 403; pedir ventas de otro local responde 403 | OK |
| 16 | Suspender el Local Accesorios mientras el vendedor trabaja | OK: en segundos pasa a `/subscription-suspended` |
| 17 | Reactivar el local | OK: la pantalla vuelve sola al sistema |
| 18 | Cierre de sesión forzado del vendedor | OK: la cookie deja de servir y va al login ("Tu sesión expiró") |
| 19 | Tiempo real: otro cliente registra una entrada de 5 unidades | OK: la pantalla de Productos pasó de 8 a 13 unidades en 2 s (meta: ≤ 5 s) |

## Observaciones
- Tras un cierre forzado el login muestra "Tu sesión expiró" y no "cerrada por el administrador": el servidor borra las sesiones, así que la cookie simplemente deja de existir. Es correcto y seguro; el mensaje es más genérico que el de Supabase.
- Con la sesión vencida, el tablero lanza algunas peticiones que responden 401 antes de que el guardia redirija al login (ruido en la consola, sin efecto visible).
- Cubierto por las pruebas automáticas pero NO recorrido a mano en la interfaz: órdenes de servicio técnico, pagos de nómina (fija e independiente) con comprobante, impresión de etiquetas, importador CSV de Productos. Conviene repasarlos en el despliegue real (Tarea 26).
