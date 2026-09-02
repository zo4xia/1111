'use strict';
// 只读数据详查：判断“之前的数据是否还在”——明细、时间范围、软删除字段、备份表、当前库身份
const fs = require('fs');
const path = require('path');
const pg = require('pg');
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1114, (v) => v);
const conn = fs.readFileSync(path.join(__dirname, 'neon.env'), 'utf-8').match(/^DATABASE_URL\s*=\s*(.+)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });

async function colsOf(table) {
  const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
  return r.rows;
}
async function show(title, sql, p = []) {
  console.log(`\n===== ${title} =====`);
  try { const r = await pool.query(sql, p); console.log(JSON.stringify(r.rows, null, 1)); }
  catch (e) { console.log('查询失败:', e.message); }
}

(async () => {
  const id = await pool.query(`SELECT current_database() db, current_user usr, now() now, version() ver`);
  console.log('当前库身份:', JSON.stringify(id.rows[0], null, 1));
  const dbList = await pool.query(`SELECT datname FROM pg_database WHERE datistemplate=false`);
  console.log('可见 databases:', dbList.rows.map((r) => r.datname).join(', '));

  await show('elections 全部明细', `SELECT * FROM elections ORDER BY 1`);
  await show('proposals 全部明细(id/标题/状态/选举日/时间)', `SELECT prop_id, prop_title, prop_status, prop_election_date, created_at FROM proposals ORDER BY created_at`);
  // 每张关键表时间范围
  for (const t of ['elections','proposals','positions','announcements','candidates','materials','election_stages','roster','voters','archives','notifications']) {
    const c = await colsOf(t);
    const timeCol = c.map((x) => x.column_name).find((n) => /created|create_time|ctime/i.test(n));
    if (timeCol) await show(`${t} 时间范围(列 ${timeCol})`, `SELECT min(${timeCol})::text mn, max(${timeCol})::text mx, count(*) n FROM ${t}`);
    const softDel = c.map((x) => x.column_name).find((n) => /delete|is_del|removed/i.test(n));
    if (softDel) console.log(`  [${t}] 存在软删除列: ${softDel}`);
  }
  // 备份表：可能旧数据在此
  const bc = await colsOf('data_fix_backup');
  console.log('\n===== data_fix_backup 列 =====', bc.map((x) => x.column_name).join(','));
  await show('data_fix_backup 按来源表分组', `SELECT * FROM (SELECT count(*) n FROM data_fix_backup) x`);
  // 找它的“源表”分类列
  const tagCol = bc.map((x) => x.column_name).find((n) => /table|source|type|entity/i.test(n));
  if (tagCol) await show(`data_fix_backup 按 ${tagCol} 分组`, `SELECT ${tagCol}, count(*) n FROM data_fix_backup GROUP BY 1 ORDER BY 2 DESC`);
  await show('data_fix_backup 样本3行', `SELECT * FROM data_fix_backup LIMIT 3`);
  // 现有业务数据归属
  await show('positions 按选举分组', `SELECT election_id, count(*) n FROM positions GROUP BY 1`);
  await show('announcements 按选举分组', `SELECT election_id, ann_status, count(*) n FROM announcements GROUP BY 1,2 ORDER BY 1`);
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
