import { api } from '../api';

export interface ClienteRecordado {
  cedula: string;
  nombre: string;
  apellido: string;
  telefono: string;
}

/** Un cliente que ya compró, por su cédula con nacionalidad (V-12345678); null si es nuevo. */
export async function buscarCliente(cedula: string): Promise<ClienteRecordado | null> {
  return (await api.get<{ cliente: ClienteRecordado | null }>(`/api/clientes/${encodeURIComponent(cedula)}`)).cliente;
}
