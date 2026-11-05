-- Datos: da referencia (INF-001...) a los productos que aun no la tienen, por prefijo y por orden de creacion.
-- Idempotente: solo toca los productos sin referencia y continua desde el contador de cada prefijo ('producto:<PREFIJO>').
CREATE TABLE _mapa_referencias AS
SELECT p.id AS id,
       p.prefijo_codigo || '-' || printf('%03d',
         COALESCE((SELECT c.valor FROM contadores c WHERE c.nombre = 'producto:' || p.prefijo_codigo), 0)
         + ROW_NUMBER() OVER (PARTITION BY p.prefijo_codigo ORDER BY p.created_at, p.rowid)) AS ref
FROM productos p
WHERE p.referencia IS NULL;

UPDATE productos SET referencia = (SELECT ref FROM _mapa_referencias WHERE id = productos.id)
WHERE referencia IS NULL AND id IN (SELECT id FROM _mapa_referencias);

INSERT INTO contadores (nombre, valor)
SELECT 'producto:' || substr(referencia, 1, instr(referencia, '-') - 1), max(cast(substr(referencia, instr(referencia, '-') + 1) AS INTEGER))
FROM productos
WHERE referencia IS NOT NULL
GROUP BY substr(referencia, 1, instr(referencia, '-') - 1)
ON CONFLICT (nombre) DO UPDATE SET valor = max(valor, excluded.valor);

DROP TABLE _mapa_referencias;
