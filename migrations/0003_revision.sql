-- Ajustes tras la revisión independiente de la rama.
--
-- 1) Eliminar un usuario que registró un pago PAGADO o cerró un cuadre fallaba con error 500: la clave foránea
--    ON DELETE SET NULL de `registrado_por` es un UPDATE y disparaba los triggers de inmutabilidad. Ahora esos triggers
--    dejan pasar SOLO ese caso (el único cambio es quitar el vínculo `registrado_por`); cualquier otro cambio sigue prohibido.
-- 2) Tabla del limitador de intentos de inicio de sesión (Better-Auth, almacenamiento en la base de datos).

DROP TRIGGER trg_nomina_pagada_inmutable;
CREATE TRIGGER trg_nomina_pagada_inmutable
BEFORE UPDATE ON nominas
WHEN OLD.estado_pago = 'PAGADO'
  AND NOT (
    NEW.registrado_por IS NULL AND OLD.registrado_por IS NOT NULL
    AND NEW.id = OLD.id AND NEW.empleado_id = OLD.empleado_id AND NEW.local_id = OLD.local_id
    AND NEW.periodo_inicio = OLD.periodo_inicio AND NEW.periodo_fin = OLD.periodo_fin
    AND NEW.pago_base = OLD.pago_base AND NEW.bonos = OLD.bonos AND NEW.deducciones = OLD.deducciones
    AND NEW.total_pagado = OLD.total_pagado AND NEW.estado_pago = OLD.estado_pago
    AND NEW.pagado_en IS OLD.pagado_en AND NEW.notas IS OLD.notas AND NEW.comprobante_path IS OLD.comprobante_path
  )
BEGIN
  SELECT RAISE(ABORT, 'Un pago ya registrado como PAGADO no se puede modificar');
END;

DROP TRIGGER trg_cuadre_cerrado;
CREATE TRIGGER trg_cuadre_cerrado
BEFORE UPDATE ON cuadres_caja
WHEN OLD.estado = 'CERRADO' AND NEW.estado = 'CERRADO'
  AND NOT (
    NEW.registrado_por IS NULL AND OLD.registrado_por IS NOT NULL
    AND NEW.id = OLD.id AND NEW.local_id = OLD.local_id AND NEW.fecha = OLD.fecha
    AND NEW.esperado = OLD.esperado AND NEW.contado = OLD.contado AND NEW.fotos = OLD.fotos
    AND NEW.notas IS OLD.notas AND NEW.registrado_nombre IS OLD.registrado_nombre
    AND NEW.cerrado_en IS OLD.cerrado_en AND NEW.cerrado_por IS OLD.cerrado_por
  )
BEGIN
  SELECT RAISE(ABORT, 'Este cuadre ya está cerrado y no se puede modificar.');
END;

CREATE TABLE rateLimit (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  count       INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);
