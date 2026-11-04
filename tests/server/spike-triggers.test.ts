// Fase 0 (spike): ¿un trigger de SQLite con RAISE(ABORT) revierte TODO el lote de D1 y el mensaje llega al código?
// Si esto falla, las tareas 4 y 11 del plan cambian a "verificar meta.changes y compensar".
import { beforeEach, describe, expect, it } from 'vitest';
import { crearEntornoDePrueba } from './ayudas';

const { DB } = crearEntornoDePrueba();

beforeEach(async () => {
  // D1.exec trata cada LÍNEA como una sentencia: una sentencia por línea.
  await DB.exec('DROP TABLE IF EXISTS espia_mov');
  await DB.exec('DROP TABLE IF EXISTS espia_inv');
  await DB.exec('DROP TABLE IF EXISTS espia_aud');
  await DB.exec('CREATE TABLE espia_inv (id TEXT PRIMARY KEY, stock INTEGER NOT NULL)');
  await DB.exec('CREATE TABLE espia_aud (id INTEGER PRIMARY KEY AUTOINCREMENT, nota TEXT)');
  await DB.exec('CREATE TABLE espia_mov (id INTEGER PRIMARY KEY AUTOINCREMENT, inv_id TEXT NOT NULL, cant INTEGER NOT NULL)');
  await DB.exec(
    "CREATE TRIGGER espia_trg BEFORE INSERT ON espia_mov BEGIN SELECT RAISE(ABORT, 'Stock insuficiente para el producto en este local') WHERE (SELECT stock FROM espia_inv WHERE id = NEW.inv_id) < NEW.cant; END"
  );
  await DB.exec("INSERT INTO espia_inv (id, stock) VALUES ('p1', 2)");
});

describe('D1: trigger con RAISE(ABORT) dentro de db.batch', () => {
  it('rechaza el lote, devuelve el mensaje y deja la primera sentencia sin efecto', async () => {
    const lote = [
      DB.prepare("INSERT INTO espia_aud (nota) VALUES ('antes del movimiento')"),
      DB.prepare("INSERT INTO espia_mov (inv_id, cant) VALUES ('p1', 5)"),
      DB.prepare("INSERT INTO espia_aud (nota) VALUES ('despues del movimiento')"),
    ];
    await expect(DB.batch(lote)).rejects.toThrow(/Stock insuficiente para el producto en este local/);

    const auditorias = await DB.prepare('SELECT count(*) AS n FROM espia_aud').first<{ n: number }>();
    const movimientos = await DB.prepare('SELECT count(*) AS n FROM espia_mov').first<{ n: number }>();
    expect(auditorias?.n).toBe(0);
    expect(movimientos?.n).toBe(0);
  });

  it('confirma el lote completo cuando el trigger no se activa', async () => {
    await DB.batch([
      DB.prepare("INSERT INTO espia_aud (nota) VALUES ('ok')"),
      DB.prepare("INSERT INTO espia_mov (inv_id, cant) VALUES ('p1', 2)"),
    ]);
    const movimientos = await DB.prepare('SELECT count(*) AS n FROM espia_mov').first<{ n: number }>();
    const auditorias = await DB.prepare('SELECT count(*) AS n FROM espia_aud').first<{ n: number }>();
    expect(movimientos?.n).toBe(1);
    expect(auditorias?.n).toBe(1);
  });
});
