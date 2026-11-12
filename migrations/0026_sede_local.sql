-- Sede de cada local (centro comercial donde está): permite agrupar los locales al mandar mercancía de una sede a otra
-- y resumir lo enviado por destino. Los cuatro locales que ya existen están en el centro comercial Cosmos.
ALTER TABLE locales ADD COLUMN sede TEXT;

UPDATE locales SET sede = 'Cosmos'
  WHERE id IN (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004'
  );
