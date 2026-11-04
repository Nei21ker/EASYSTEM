-- Reimpresión de etiquetas: la etiqueta de una unidad se puede volver a imprimir (se despegó, se perdió o salió mal) sin cambiar su
-- código. `impresa_en` sigue siendo la PRIMERA impresión; aquí se lleva la cuenta de las reimpresiones.
ALTER TABLE unidades_producto ADD COLUMN reimpresiones INTEGER NOT NULL DEFAULT 0;
ALTER TABLE unidades_producto ADD COLUMN ultima_reimpresion TEXT;
