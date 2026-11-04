import { z } from 'zod';
import { conSesion, leerJson } from '../../../../../server/http';
import { actualizarEmpleado } from '../../../../../server/servicios/nomina';

export const prerender = false;

const esquema = z.object({
  local_id: z.string().optional(),
  nombre: z.string().optional(),
  apellido: z.string().optional(),
  cedula: z.string().optional(),
  cargo: z.string().optional(),
  salario_base: z.number().optional(),
  estado: z.enum(['ACTIVO', 'INACTIVO']).optional(),
  fecha_ingreso: z.string().optional(),
});

/** Edita un empleado (el tipo fijo/independiente no cambia). */
export const PATCH = conSesion(async ({ env, sesion, request, params }) =>
  actualizarEmpleado(env, sesion, params.id as string, (await leerJson(request, esquema)) as never)
);
