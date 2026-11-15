// Lógica pura de scripts/crear-tecnico.mjs: las tres sentencias del alta de un técnico de un local (user + cuenta con hash PBKDF2 +
// perfil con rol «tecnico»), las mismas que ejecuta crearUsuarioInterno del servidor. NUNCA incluyen la clave en claro: solo su hash.
// El perfil queda marcado con debe_cambiar_clave = 1: en su primer ingreso el técnico está obligado a elegir una clave propia.
import { hashearClave } from '../../src/server/password.ts';
import { validarCorreo } from './admin.mjs';

const literal = (texto) => `'${String(texto).replaceAll("'", "''")}'`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sentenciasAltaTecnico({ correo, nombre, clave, localId, id = crypto.randomUUID(), ahora = Date.now() }) {
  const email = String(correo ?? '').trim().toLowerCase();
  const limpio = String(nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!validarCorreo(email)) throw new Error('Escribe un correo válido.');
  if (limpio.length < 2) throw new Error('Escribe el nombre del técnico.');
  if (typeof clave !== 'string' || clave.length < 8) throw new Error('La clave debe tener al menos 8 caracteres.');
  if (!UUID.test(String(localId ?? ''))) throw new Error('Indica el id del local del técnico.');
  const hash = await hashearClave(clave);
  return [
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (${literal(id)}, ${literal(limpio)}, ${literal(email)}, 1, ${ahora}, ${ahora})`,
    `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (${literal(crypto.randomUUID())}, ${literal(id)}, 'credential', ${literal(id)}, ${literal(hash)}, ${ahora}, ${ahora})`,
    `INSERT INTO perfiles (id, email, nombre, rol, local_id, status, created_at, debe_cambiar_clave) VALUES (${literal(id)}, ${literal(email)}, ${literal(limpio)}, 'tecnico', ${literal(localId)}, 'active', ${literal(new Date(ahora).toISOString())}, 1)`,
  ];
}
