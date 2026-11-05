-- Prefijo del código de cada unidad (2 a 4 letras, normalmente 3 de la marca: INF, TEC...).
-- Las unidades se codifican como PREFIJO + 6 digitos consecutivos por prefijo: INF000001, INF000002...
-- El valor GEN es el de partida: la migracion 0008 asigna el prefijo real a los productos que ya existen.
ALTER TABLE productos ADD COLUMN prefijo_codigo TEXT NOT NULL DEFAULT 'GEN' CHECK (length(prefijo_codigo) BETWEEN 2 AND 4 AND prefijo_codigo NOT GLOB '*[^A-Z]*');
