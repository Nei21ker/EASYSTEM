-- Cada persona puede cambiar su propia contraseña. Cuando un administrador o gerente crea una cuenta o le restablece la
-- clave a otra persona, esa clave es temporal: `debe_cambiar_clave = 1` obliga a cambiarla en el primer ingreso (el servidor
-- rechaza el resto de la API hasta que lo haga). Las cuentas que ya existen quedan en 0: no se bloquea a nadie de golpe.
ALTER TABLE perfiles ADD COLUMN debe_cambiar_clave INTEGER NOT NULL DEFAULT 0;
