// 公共：读取 backend/neon.env 的 DATABASE_URL，返回 pg Pool（与 api.js 同参数：ssl rejectUnauthorized:false）
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadPool() {
  const envPath = path.join(__dirname, '..', 'neon.env');
  const txt = fs.readFileSync(envPath, 'utf8');
  const m = txt.match(/^DATABASE_URL\s*=\s*(.+)$/m);
  if (!m) throw new Error('neon.env 中未找到 DATABASE_URL');
  const connectionString = m[1].trim();
  return new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
}

module.exports = { loadPool };
