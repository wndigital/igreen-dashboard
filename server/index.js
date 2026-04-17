require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ═══════════════════════════════════════
//  INIT DATABASE
// ═══════════════════════════════════════
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        cargo TEXT NOT NULL DEFAULT 'Cadastro',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS attendants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'cadastro',
        active BOOLEAN DEFAULT true,
        created_at DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        date DATE NOT NULL,
        invested NUMERIC(12,2) DEFAULT 0,
        leads INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS entry_cadastros (
        id SERIAL PRIMARY KEY,
        entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
        att_id TEXT NOT NULL,
        qty INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS entry_assinaturas (
        id SERIAL PRIMARY KEY,
        entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
        att_id TEXT NOT NULL,
        qty INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS comm_paid (
        id TEXT PRIMARY KEY,
        att_id TEXT NOT NULL,
        att_name TEXT NOT NULL,
        role TEXT NOT NULL,
        qty INTEGER DEFAULT 0,
        above20 INTEGER DEFAULT 0,
        amount NUMERIC(12,2) DEFAULT 0,
        period_label TEXT,
        paid_date DATE DEFAULT CURRENT_DATE,
        paid_dates TEXT[] DEFAULT '{}'
      );
    `);

    // Create default admin if no users exist
    const { rows } = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(rows[0].count) === 0) {
      const hash = await bcrypt.hash('admin', 10);
      await client.query(
        `INSERT INTO users (id, name, email, password, cargo) VALUES ($1, $2, $3, $4, $5)`,
        ['adm0', 'Wallace', 'admin@igreen.com', hash, 'ADM']
      );
      // Demo users
      const hashM = await bcrypt.hash('maria123', 10);
      await client.query(
        `INSERT INTO users (id, name, email, password, cargo) VALUES ($1, $2, $3, $4, $5)`,
        ['cad1', 'Maria', 'maria@igreen.com', hashM, 'Cadastro']
      );
      const hashE = await bcrypt.hash('eduarda123', 10);
      await client.query(
        `INSERT INTO users (id, name, email, password, cargo) VALUES ($1, $2, $3, $4, $5)`,
        ['ass1', 'Eduarda', 'eduarda@igreen.com', hashE, 'Assinatura']
      );
      console.log('Default users created');
    }

    console.log('Database initialized');
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND active = true', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Email ou senha incorretos.' });
    const valid = await bcrypt.compare(password, rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Email ou senha incorretos.' });
    const u = rows[0];
    res.json({ id: u.id, name: u.name, email: u.email, cargo: u.cargo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
//  USERS ROUTES
// ═══════════════════════════════════════
app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email, cargo, active FROM users ORDER BY created_at');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { id, name, email, password, cargo } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (id, name, email, password, cargo) VALUES ($1,$2,$3,$4,$5)',
      [id, name, email, hash, cargo]
    );
    res.json({ id, name, email, cargo, active: true });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Email já cadastrado.' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND id != $2', [req.params.id, 'adm0']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════
//  ATTENDANTS ROUTES
// ═══════════════════════════════════════
app.get('/api/attendants', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM attendants ORDER BY created_at');
    res.json(rows.map(r => ({ ...r, createdAt: r.created_at })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attendants', async (req, res) => {
  try {
    const { id, name, role, createdAt } = req.body;
    await pool.query(
      'INSERT INTO attendants (id, name, role, created_at) VALUES ($1,$2,$3,$4)',
      [id, name, role, createdAt]
    );
    res.json({ id, name, role, active: true, createdAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/attendants/:id/toggle', async (req, res) => {
  try {
    await pool.query('UPDATE attendants SET active = NOT active WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════
//  ENTRIES ROUTES
// ═══════════════════════════════════════
app.get('/api/entries', async (req, res) => {
  try {
    const { rows: entries } = await pool.query('SELECT * FROM entries ORDER BY date DESC');
    const { rows: cads } = await pool.query('SELECT * FROM entry_cadastros');
    const { rows: asss } = await pool.query('SELECT * FROM entry_assinaturas');

    const result = entries.map(e => ({
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      invested: parseFloat(e.invested),
      leads: e.leads,
      cadastros: cads.filter(c => c.entry_id === e.id).map(c => ({ attId: c.att_id, qty: c.qty.toString() })),
      assinaturas: asss.filter(a => a.entry_id === e.id).map(a => ({ attId: a.att_id, qty: a.qty.toString() })),
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/entries', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id, date, invested, leads, cadastros, assinaturas } = req.body;

    await client.query(
      'INSERT INTO entries (id, date, invested, leads) VALUES ($1,$2,$3,$4)',
      [id, date, parseFloat(invested) || 0, parseInt(leads) || 0]
    );

    for (const c of (cadastros || [])) {
      await client.query(
        'INSERT INTO entry_cadastros (entry_id, att_id, qty) VALUES ($1,$2,$3)',
        [id, c.attId, parseInt(c.qty) || 0]
      );
    }
    for (const a of (assinaturas || [])) {
      await client.query(
        'INSERT INTO entry_assinaturas (entry_id, att_id, qty) VALUES ($1,$2,$3)',
        [id, a.attId, parseInt(a.qty) || 0]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.put('/api/entries/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { date, invested, leads, cadastros, assinaturas } = req.body;
    const eid = req.params.id;

    await client.query(
      'UPDATE entries SET date=$1, invested=$2, leads=$3 WHERE id=$4',
      [date, parseFloat(invested) || 0, parseInt(leads) || 0, eid]
    );

    await client.query('DELETE FROM entry_cadastros WHERE entry_id=$1', [eid]);
    await client.query('DELETE FROM entry_assinaturas WHERE entry_id=$1', [eid]);

    for (const c of (cadastros || [])) {
      await client.query(
        'INSERT INTO entry_cadastros (entry_id, att_id, qty) VALUES ($1,$2,$3)',
        [eid, c.attId, parseInt(c.qty) || 0]
      );
    }
    for (const a of (assinaturas || [])) {
      await client.query(
        'INSERT INTO entry_assinaturas (entry_id, att_id, qty) VALUES ($1,$2,$3)',
        [eid, a.attId, parseInt(a.qty) || 0]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM entries WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════
//  COMMISSIONS PAID ROUTES
// ═══════════════════════════════════════
app.get('/api/comm-paid', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM comm_paid ORDER BY paid_date DESC');
    res.json(rows.map(r => ({
      id: r.id,
      attId: r.att_id,
      attName: r.att_name,
      role: r.role,
      qty: r.qty,
      above20: r.above20,
      amount: parseFloat(r.amount),
      periodLabel: r.period_label,
      paidDate: r.paid_date.toISOString().slice(0, 10),
      paidDates: r.paid_dates || [],
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/comm-paid', async (req, res) => {
  try {
    const records = req.body;
    for (const r of records) {
      await pool.query(
        `INSERT INTO comm_paid (id, att_id, att_name, role, qty, above20, amount, period_label, paid_date, paid_dates)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [r.id, r.attId, r.attName, r.role, r.qty, r.above20, r.amount, r.periodLabel, r.paidDate, r.paidDates]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`iGreen Dashboard running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
