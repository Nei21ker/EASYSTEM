-- Servicio técnico: cobro de la reparación con reparto entre la tienda y el técnico, y pago posterior al técnico.
--   · La encargada cobra al cliente (`pagos`, `vuelto`, `tasa_cambio`, `total_bs`, `cobrado_*`); la orden queda ENTREGADA al cobrarla.
--   · Ganancia = total cobrado − repuestos (a precio de catálogo, se los queda la tienda). La tienda toma `porcentaje_local` de esa
--     ganancia (`comision_local_usd`) y el resto es del técnico (`pago_tecnico_usd`), que se le paga después (`tecnico_pagado_*`).
-- Todas las columnas son opcionales: las órdenes anteriores se quedan como están (sin cobro registrado).
ALTER TABLE ordenes_servicio ADD COLUMN porcentaje_local REAL CHECK (porcentaje_local IS NULL OR (porcentaje_local >= 0 AND porcentaje_local <= 100));
ALTER TABLE ordenes_servicio ADD COLUMN comision_local_usd REAL CHECK (comision_local_usd IS NULL OR comision_local_usd >= 0);
ALTER TABLE ordenes_servicio ADD COLUMN pago_tecnico_usd REAL CHECK (pago_tecnico_usd IS NULL OR pago_tecnico_usd >= 0);
ALTER TABLE ordenes_servicio ADD COLUMN pagos TEXT CHECK (pagos IS NULL OR (json_valid(pagos) AND json_type(pagos) = 'array'));
ALTER TABLE ordenes_servicio ADD COLUMN vuelto TEXT CHECK (vuelto IS NULL OR json_valid(vuelto));
ALTER TABLE ordenes_servicio ADD COLUMN tasa_cambio REAL;
ALTER TABLE ordenes_servicio ADD COLUMN total_bs REAL;
ALTER TABLE ordenes_servicio ADD COLUMN cobrado_en TEXT;
ALTER TABLE ordenes_servicio ADD COLUMN cobrado_por TEXT REFERENCES user (id) ON DELETE SET NULL;
ALTER TABLE ordenes_servicio ADD COLUMN cobrado_nombre TEXT;
ALTER TABLE ordenes_servicio ADD COLUMN tecnico_pagado_en TEXT;
ALTER TABLE ordenes_servicio ADD COLUMN tecnico_pagado_por TEXT REFERENCES user (id) ON DELETE SET NULL;
ALTER TABLE ordenes_servicio ADD COLUMN tecnico_pagado_nombre TEXT;

CREATE INDEX ordenes_tecnico_idx ON ordenes_servicio (tecnico_id, recibida_en DESC);
