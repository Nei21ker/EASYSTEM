-- Local de pantallas: un local nuevo, solo para la gerencia (administrador, gerente y supervisor), con TODAS las pantallas
-- (categorías «Pantalla» y «Pantallas») que estaban en el Local Servicio Técnico.
--
-- La mercancía se pasa como un traslado normal ya recibido (Traslado #NNNN en Descargo y en Movimientos): las piezas conservan
-- su código y su etiqueta, el stock sale del origen y entra al destino por los mismos movimientos TRASLADO_SALIDA / TRASLADO_ENTRADA
-- que dispara el stock de siempre (trg_mov_aplicar). No cuenta como venta ni como compra en los reportes.
--
-- El tipo del local es «accesorios» (el CHECK de `locales` no admite un tipo nuevo sin reconstruir la tabla que referencian casi
-- todas las demás): muestra los módulos generales (POS, Productos, Mercancía, Modelos), sin Servicio técnico.
-- Ningún empleado se asigna a este local (el servidor lo impide: LOCALES_SOLO_GERENCIA).
--
-- Idempotente: si ya no quedan pantallas DISPONIBLES en el origen no mueve nada, y el local se crea una sola vez.
-- Ids fijos: origen …0003 (Local Servicio Técnico), destino …0005 (Local de pantallas).
-- (Este archivo no lleva punto y coma dentro de textos ni comentarios: las pruebas lo parten por sentencias.)

INSERT OR IGNORE INTO locales (id, nombre, tipo, sede) VALUES ('00000000-0000-4000-8000-000000000005', 'Local de pantallas', 'accesorios', 'Cosmos');

-- Los productos de pantalla que el Local Servicio Técnico maneja pasan a ser manejados por el Local de pantallas
-- (también los que hoy tienen 0 unidades: así no se pierde su stock mínimo)
INSERT OR IGNORE INTO inventario_local (local_id, producto_id, stock_actual, stock_minimo)
  SELECT '00000000-0000-4000-8000-000000000005', o.producto_id, 0, o.stock_minimo
  FROM inventario_local o JOIN productos p ON p.id = o.producto_id
  WHERE o.local_id = '00000000-0000-4000-8000-000000000003' AND p.categoria IN ('Pantalla', 'Pantallas')
    AND EXISTS (SELECT 1 FROM locales WHERE id = '00000000-0000-4000-8000-000000000005');

-- Folio del traslado (solo si hay piezas que pasar)
INSERT INTO contadores (nombre, valor)
  SELECT 'traslados', 1
  WHERE EXISTS (SELECT 1 FROM unidades_producto u JOIN productos p ON p.id = u.producto_id
                WHERE u.local_id = '00000000-0000-4000-8000-000000000003' AND u.estado = 'DISPONIBLE' AND p.categoria IN ('Pantalla', 'Pantallas'))
  ON CONFLICT (nombre) DO UPDATE SET valor = valor + 1;

INSERT INTO traslados (id, folio, origen_local_id, destino_local_id, estado, creado_en, enviado_por, recibido_en, recibido_por, cerrado_en, notas)
  SELECT 'migracion-pantallas-0031', (SELECT valor FROM contadores WHERE nombre = 'traslados'),
         '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', 'RECIBIDO',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'Migración del sistema', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'Migración del sistema',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'Todas las pantallas del Local Servicio Técnico pasan al Local de pantallas'
  WHERE EXISTS (SELECT 1 FROM unidades_producto u JOIN productos p ON p.id = u.producto_id
                WHERE u.local_id = '00000000-0000-4000-8000-000000000003' AND u.estado = 'DISPONIBLE' AND p.categoria IN ('Pantalla', 'Pantallas'))
    AND NOT EXISTS (SELECT 1 FROM traslados WHERE id = 'migracion-pantallas-0031');

INSERT INTO traslado_unidades (traslado_id, codigo, producto_id, producto_nombre, recibida_en)
  SELECT 'migracion-pantallas-0031', u.codigo, u.producto_id, p.nombre, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM unidades_producto u JOIN productos p ON p.id = u.producto_id
  WHERE u.local_id = '00000000-0000-4000-8000-000000000003' AND u.estado = 'DISPONIBLE' AND p.categoria IN ('Pantalla', 'Pantallas')
    AND EXISTS (SELECT 1 FROM traslados WHERE id = 'migracion-pantallas-0031');

-- Un movimiento por producto en cada local (las piezas con sus códigos)
INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, fecha, motivo, local_id, unidad_codigos)
  SELECT lower(hex(randomblob(16))), u.producto_id, 'TRASLADO_SALIDA', count(*), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         'Traslado #' || printf('%04d', (SELECT folio FROM traslados WHERE id = 'migracion-pantallas-0031')) || ' → Local de pantallas',
         '00000000-0000-4000-8000-000000000003', json_group_array(u.codigo)
  FROM unidades_producto u JOIN productos p ON p.id = u.producto_id
  WHERE u.local_id = '00000000-0000-4000-8000-000000000003' AND u.estado = 'DISPONIBLE' AND p.categoria IN ('Pantalla', 'Pantallas')
    AND EXISTS (SELECT 1 FROM traslados WHERE id = 'migracion-pantallas-0031')
  GROUP BY u.producto_id;

INSERT INTO movimientos_inventario (id, producto_id, tipo, cantidad, fecha, motivo, local_id, unidad_codigos)
  SELECT lower(hex(randomblob(16))), u.producto_id, 'TRASLADO_ENTRADA', count(*), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         'Traslado #' || printf('%04d', (SELECT folio FROM traslados WHERE id = 'migracion-pantallas-0031')) || ' desde Local Servicio Técnico',
         '00000000-0000-4000-8000-000000000005', json_group_array(u.codigo)
  FROM unidades_producto u JOIN productos p ON p.id = u.producto_id
  WHERE u.local_id = '00000000-0000-4000-8000-000000000003' AND u.estado = 'DISPONIBLE' AND p.categoria IN ('Pantalla', 'Pantallas')
    AND EXISTS (SELECT 1 FROM traslados WHERE id = 'migracion-pantallas-0031')
  GROUP BY u.producto_id;

-- Las piezas cambian de local (mismo código, misma etiqueta)
UPDATE unidades_producto SET local_id = '00000000-0000-4000-8000-000000000005'
  WHERE local_id = '00000000-0000-4000-8000-000000000003' AND estado = 'DISPONIBLE'
    AND producto_id IN (SELECT id FROM productos WHERE categoria IN ('Pantalla', 'Pantallas'))
    AND EXISTS (SELECT 1 FROM traslados WHERE id = 'migracion-pantallas-0031');

-- El Local Servicio Técnico deja de manejar las pantallas (las que quedaron en 0 unidades)
DELETE FROM inventario_local
  WHERE local_id = '00000000-0000-4000-8000-000000000003' AND stock_actual = 0
    AND producto_id IN (SELECT id FROM productos WHERE categoria IN ('Pantalla', 'Pantallas'))
    AND EXISTS (SELECT 1 FROM inventario_local WHERE local_id = '00000000-0000-4000-8000-000000000005');

-- Avisa a las pantallas abiertas (actualización en vivo)
INSERT INTO cambios (tabla, local_id, version) VALUES ('locales', '', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
INSERT INTO cambios (tabla, local_id, version) VALUES ('productos', '', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
INSERT INTO cambios (tabla, local_id, version) VALUES ('inventario_local', '00000000-0000-4000-8000-000000000003', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
INSERT INTO cambios (tabla, local_id, version) VALUES ('unidades_producto', '00000000-0000-4000-8000-000000000003', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
INSERT INTO cambios (tabla, local_id, version) VALUES ('movimientos_inventario', '00000000-0000-4000-8000-000000000003', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
INSERT INTO cambios (tabla, local_id, version) VALUES ('traslados', '00000000-0000-4000-8000-000000000003', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
INSERT INTO cambios (tabla, local_id, version) VALUES ('inventario_local', '00000000-0000-4000-8000-000000000005', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
INSERT INTO cambios (tabla, local_id, version) VALUES ('unidades_producto', '00000000-0000-4000-8000-000000000005', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
INSERT INTO cambios (tabla, local_id, version) VALUES ('movimientos_inventario', '00000000-0000-4000-8000-000000000005', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
INSERT INTO cambios (tabla, local_id, version) VALUES ('traslados', '00000000-0000-4000-8000-000000000005', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
