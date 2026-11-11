-- Una sola lista de promotores: el directorio `promotores` (Pendientes) es TAMBIÉN la lista de la pestaña «Promotores · pago diario» de
-- la Nómina. Para pagarle un día, el pago necesita una fila en `empleados` (tipo INDEPENDIENTE, con local); esa fila es solo la "sombra"
-- de nómina del promotor y se crea sola la primera vez que se le arma una lista (`empleados.promotor_id` la liga con el directorio).
-- Los datos (nombre, apellido, cédula) se escriben una vez, en el directorio.
ALTER TABLE empleados ADD COLUMN promotor_id TEXT REFERENCES promotores (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX empleados_promotor_idx ON empleados (promotor_id) WHERE promotor_id IS NOT NULL;

-- Los trabajadores independientes que ya existían pasan al directorio (si su cédula aún no estaba) y quedan ligados a él.
INSERT INTO promotores (id, cedula, nombre, apellido, creado_por_nombre)
SELECT lower(hex(randomblob(16))), e.cedula, e.nombre, e.apellido, 'Nómina'
FROM empleados e
WHERE e.tipo = 'INDEPENDIENTE' AND NOT EXISTS (SELECT 1 FROM promotores p WHERE p.cedula = e.cedula);

UPDATE empleados
SET promotor_id = (SELECT p.id FROM promotores p WHERE p.cedula = empleados.cedula)
WHERE tipo = 'INDEPENDIENTE' AND promotor_id IS NULL;
