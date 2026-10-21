-- ============================================================================
-- Nómina: 3 empleados de EJEMPLO (uno por local) para no ver el módulo vacío.
--
-- Requiere 0027_nomina.sql.
--
-- Son personas ficticias con cédulas que empiezan por "V-9000" (fáciles de reconocer) y sueldos mensuales
-- elegidos al azar. Cuando cargues al personal real puedes pasarlos a INACTIVO con "Editar" en /payroll
-- (los empleados no se borran). Es idempotente: si ya existen (por cédula) no se repiten.
-- ============================================================================

insert into public.empleados (local_id, nombre, apellido, cedula, cargo, salario_base, fecha_ingreso)
values
  ('00000000-0000-4000-8000-000000000001', 'Sofía',   'Mendoza',    'V-90004398', 'Cajera',                  366.00, '2025-03-15'),
  ('00000000-0000-4000-8000-000000000002', 'Gabriel', 'Villalobos', 'V-90001602', 'Vendedor',                494.50, '2025-08-23'),
  ('00000000-0000-4000-8000-000000000003', 'Mateo',   'Ramírez',    'V-90005163', 'Recepcionista de equipos', 368.50, '2025-04-27')
on conflict (cedula) do nothing;
