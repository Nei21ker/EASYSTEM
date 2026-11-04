// Se ejecuta antes de cada archivo de prueba: aplica las migraciones de D1 (el almacenamiento de cada prueba se aísla después).
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

const entorno = env as unknown as { DB: D1Database; MIGRACIONES: Parameters<typeof applyD1Migrations>[1] };
await applyD1Migrations(entorno.DB, entorno.MIGRACIONES);
