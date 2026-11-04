-- Clientes que ya compraron: se guardan (o actualizan) con cada venta para rellenar sus datos la próxima vez que se escriba su cédula.
-- Una fila por cédula (compartida entre los locales: un cliente puede comprar en varios).
CREATE TABLE clientes (
  cedula     TEXT PRIMARY KEY CHECK (length(cedula) BETWEEN 5 AND 20),
  nombre     TEXT NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 120),
  apellido   TEXT NOT NULL DEFAULT '' CHECK (length(apellido) <= 120),
  telefono   TEXT NOT NULL CHECK (length(telefono) BETWEEN 7 AND 25),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
