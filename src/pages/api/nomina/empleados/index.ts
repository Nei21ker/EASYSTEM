import { z } from 'zod';
import { conSesion, leerJson } from '../../../../server/http';
import { crearEmpleado, listarEmpleados } from '../../../../server/servicios/nomina';

export const prerender = false;

const esquema = z.object({
  local_id: z.string(),
  nombre: z.string(),
  apellido: z.string(),
  cedula: z.string(),
  cargo: z.string(),
  salario_base: z.number(),
  tipo: z.enum(['FIJO', 'INDEPENDIENTE']).optional(),
  estado: z.enum(['ACTIVO', 'INACTIVO']).optional(),
  fecha_ingreso: z.string().optional(),
});

/** Personal dentro del alcance de nómina del usuario. */
export const GET = conSesion(({ env, sesion }) => listarEmpleados(env, sesion));

/** Registra un empleado fijo o un trabajador independiente. */
export const POST = conSesion(async ({ env, sesion, request }) => crearEmpleado(env, sesion, (await leerJson(request, esquema)) as never));
