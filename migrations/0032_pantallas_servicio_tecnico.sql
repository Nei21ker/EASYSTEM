-- El Local de pantallas (0031) tiene su propio servicio técnico, igual que el Local Servicio Técnico: pasa a ser de tipo
-- «servicio_tecnico» (módulo de órdenes, técnicos, cobro con reparto y repuestos del inventario del propio local, que ya tiene las pantallas).
-- Solo cambia el tipo: los productos, las piezas y el traslado de la 0031 no se tocan.
UPDATE locales SET tipo = 'servicio_tecnico' WHERE id = '00000000-0000-4000-8000-000000000005';

-- Avisa a las pantallas abiertas (actualización en vivo)
INSERT INTO cambios (tabla, local_id, version) VALUES ('locales', '', 1) ON CONFLICT (tabla, local_id) DO UPDATE SET version = version + 1;
