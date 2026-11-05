-- Datos: da prefijo a los productos que ya existen y renumera sus unidades con el formato nuevo (INF000001...).
-- Es idempotente: solo toca lo que aun tiene el prefijo de partida (GEN) y las unidades con el codigo viejo (EAN-13 numerico).
-- Los registros historicos (movimientos, ventas, devoluciones) conservan los codigos viejos de las piezas: son solo historia.

-- 1. Prefijo de cada producto: iPhone, luego la marca que aparece en el nombre, luego la marca de sus modelos, luego la categoria
UPDATE productos SET prefijo_codigo = 'IPH' WHERE prefijo_codigo = 'GEN' AND instr(lower(nombre), 'iphone') > 0;

UPDATE productos SET prefijo_codigo = (
  SELECT upper(substr(m.marca, 1, 3)) FROM modelos_telefono m
  WHERE instr(lower(productos.nombre), lower(m.marca)) > 0 AND length(m.marca) >= 2 AND m.marca NOT GLOB '*[^A-Za-z]*'
  ORDER BY length(m.marca) DESC, m.marca LIMIT 1
)
WHERE prefijo_codigo = 'GEN' AND EXISTS (
  SELECT 1 FROM modelos_telefono m
  WHERE instr(lower(productos.nombre), lower(m.marca)) > 0 AND length(m.marca) >= 2 AND m.marca NOT GLOB '*[^A-Za-z]*'
);

UPDATE productos SET prefijo_codigo = (
  SELECT upper(substr(m.marca, 1, 3)) FROM compatibilidades c JOIN modelos_telefono m ON m.id = c.modelo_id
  WHERE c.producto_id = productos.id AND length(m.marca) >= 2 AND m.marca NOT GLOB '*[^A-Za-z]*'
  ORDER BY m.marca LIMIT 1
)
WHERE prefijo_codigo = 'GEN' AND EXISTS (
  SELECT 1 FROM compatibilidades c JOIN modelos_telefono m ON m.id = c.modelo_id
  WHERE c.producto_id = productos.id AND length(m.marca) >= 2 AND m.marca NOT GLOB '*[^A-Za-z]*'
);

UPDATE productos SET prefijo_codigo = upper(substr(replace(categoria, ' ', ''), 1, 3))
WHERE prefijo_codigo = 'GEN' AND length(replace(categoria, ' ', '')) >= 3 AND substr(replace(categoria, ' ', ''), 1, 3) NOT GLOB '*[^A-Za-z]*';

-- 2. Codigo nuevo de cada unidad con codigo viejo: prefijo de su producto + numero consecutivo por prefijo (por orden de llegada)
CREATE TABLE _mapa_codigos AS
SELECT u.codigo AS viejo, p.prefijo_codigo || printf('%06d', ROW_NUMBER() OVER (PARTITION BY p.prefijo_codigo ORDER BY u.created_at, u.rowid)) AS nuevo
FROM unidades_producto u JOIN productos p ON p.id = u.producto_id
WHERE u.codigo NOT GLOB '[A-Z][A-Z]*';

UPDATE unidades_producto SET codigo = (SELECT nuevo FROM _mapa_codigos WHERE viejo = unidades_producto.codigo)
WHERE codigo IN (SELECT viejo FROM _mapa_codigos);

UPDATE traslado_unidades SET codigo = (SELECT nuevo FROM _mapa_codigos WHERE viejo = traslado_unidades.codigo)
WHERE codigo IN (SELECT viejo FROM _mapa_codigos);

-- 3. El contador de cada prefijo sigue desde el ultimo numero usado
INSERT INTO contadores (nombre, valor)
SELECT 'unidad:' || p.prefijo_codigo, max(cast(substr(u.codigo, length(p.prefijo_codigo) + 1) AS INTEGER))
FROM unidades_producto u JOIN productos p ON p.id = u.producto_id
WHERE u.codigo GLOB '[A-Z][A-Z]*' AND substr(u.codigo, 1, length(p.prefijo_codigo)) = p.prefijo_codigo
GROUP BY p.prefijo_codigo
ON CONFLICT (nombre) DO UPDATE SET valor = max(valor, excluded.valor);

DROP TABLE _mapa_codigos;
