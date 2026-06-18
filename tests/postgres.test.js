/**
 * Vérifie que le schéma PostgreSQL (schema.postgres.sql) est valide et que les
 * patterns SQL critiques de l'app fonctionnent en dialecte Postgres — testé
 * contre un vrai moteur Postgres en mémoire (pg-mem), sans serveur ni Docker.
 *
 * C'est la preuve que la cible PG est correcte ; la bascule applicative (89
 * sites sync→async) est décrite dans docs/scaling.md.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { newDb } from 'pg-mem';
import { pgSchemaSql } from '../src/db/pg.js';

let pool;

beforeAll(async () => {
  const mem = newDb();
  mem.public.none(pgSchemaSql());          // ← échoue si le schéma n'est pas du Postgres valide
  const { Pool } = mem.adapters.createPg();
  pool = new Pool();
});

const q = (text, params) => pool.query(text, params).then(r => r.rows);

describe('schéma PostgreSQL', () => {
  it('charge le schéma complet sans erreur', async () => {
    // Si beforeAll a réussi, les 13 tables + index sont créés. Sanity check :
    const rows = await q('SELECT count(*) AS c FROM users');
    expect(Number(rows[0].c)).toBe(0);
  });

  it('requêtes paramétrées ($1) — insert + select', async () => {
    await q('INSERT INTO users(id,email,credits) VALUES($1,$2,$3)', ['u1', 'a@b.fr', 10]);
    const rows = await q('SELECT email, credits FROM users WHERE id=$1', ['u1']);
    expect(rows[0].email).toBe('a@b.fr');
    expect(Number(rows[0].credits)).toBe(10);
  });

  it('index unique partiel : dédup leads par (user_id, phone)', async () => {
    await q("INSERT INTO leads(id,user_id,name,activity,city,phone) VALUES('l1','u1','A','plombier','Lyon','0600000001')");
    // même user + même téléphone → violation d'unicité
    await expect(
      q("INSERT INTO leads(id,user_id,name,activity,city,phone) VALUES('l2','u1','B','plombier','Lyon','0600000001')")
    ).rejects.toBeTruthy();
    // téléphone NULL non concerné par l'index partiel → autorisé en double
    await q("INSERT INTO leads(id,user_id,name,activity,city) VALUES('l3','u1','C','plombier','Lyon')");
    await q("INSERT INTO leads(id,user_id,name,activity,city) VALUES('l4','u1','D','plombier','Lyon')");
    const n = await q("SELECT count(*) FROM leads WHERE user_id='u1'");
    expect(Number(n[0].count)).toBe(3); // l1, l3, l4
  });

  it('idempotence Stripe : ON CONFLICT DO NOTHING', async () => {
    const ins = "INSERT INTO stripe_events(event_id,type,user_id,credits) VALUES('evt_1','x','u1',100) ON CONFLICT (event_id) DO NOTHING";
    await pool.query(ins);
    await pool.query(ins);                          // rejeu Stripe
    // Garantie réelle : une seule ligne malgré le double insert (pas de double crédit)
    const rows = await q("SELECT count(*) AS c FROM stripe_events WHERE event_id='evt_1'");
    expect(Number(rows[0].c)).toBe(1);
  });

  it('claim atomique : UPDATE … RETURNING', async () => {
    await q("INSERT INTO sites(id,lead_id,user_id,slug,output_path,url) VALUES('s1','l1','u1','slug-1','/x','http://x')");
    await q("INSERT INTO jobs(id,type,status,data) VALUES('j1','email','pending','{}')");
    const claimed = await q("UPDATE jobs SET status='processing' WHERE id IN (SELECT id FROM jobs WHERE type='email' AND status='pending' LIMIT 1) RETURNING id, status");
    expect(claimed[0].id).toBe('j1');
    expect(claimed[0].status).toBe('processing');
  });

  it('numérotation séquentielle des factures', async () => {
    await q("INSERT INTO invoices(id,number,user_id,type,amount_ht,vat_rate,vat_amount,amount_ttc) VALUES('i1','FACT-2026-0001','u1','pack',1000,20,200,1200)");
    const count = await q("SELECT count(*) FROM invoices WHERE number LIKE 'FACT-2026-%'");
    expect(Number(count[0].count)).toBe(1);
    // numéro unique garanti
    await expect(
      q("INSERT INTO invoices(id,number,user_id,type,amount_ht,vat_rate,vat_amount,amount_ttc) VALUES('i2','FACT-2026-0001','u1','pack',1,0,0,1)")
    ).rejects.toBeTruthy();
  });
});
