'use strict';
// 只读盘点（绝不写库）：1) 确认连接目标 2) 列全库表与行数，识别是否混入其他团队数据
// 3) dry-run 预览 election_stages 结束日修正影响面（不执行 UPDATE）
const fs = require('fs');
const path = require('path');
const pg = require('pg');
pg.types.setTypeParser(1082, (v) => v);

const envRaw = fs.readFileSync(path.join(__dirname, 'neon.env'), 'utf-8').match(/^DATABASE_URL\s*=\s*(.+)$/m)[1].trim();
const userGiven = 'postgresql://neondb_owner:npg_TRZmFov5AHb8@ep-cold-dawn-b34i2tms-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
function mask(u) { try { const x = new URL(u); return `${x.username}@${x.host}/${x.pathname.slice(1)}`; } catch { return 'parse-fail'; } }
console.log('neon.env 目标 :', mask(envRaw));
console.log('用户给串目标:', mask(userGiven));
console.log('同库(host+db):', mask(envRaw) === mask(userGiven) ? '是' : '否 !!');

const pool = new pg.Pool({ connectionString: envRaw, ssl: { rejectUnauthorized: false } });
function shiftDate(dateStr, offset) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + Number(offset || 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

(async () => {
  // 1) schema 与表清单
  const sch = await pool.query(`SELECT table_schema, count(*) n FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')
    GROUP BY table_schema ORDER BY table_schema`);
  console.log('\n=== 业务 schema ==='); sch.rows.forEach((r) => console.log(`  schema=${r.table_schema} 表数=${r.n}`));

  const tbls = await pool.query(`SELECT table_schema s, table_name t FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`);
  console.log('\n=== 各表行数（只读 count）===');
  for (const r of tbls.rows) {
    try { const c = await pool.query(`SELECT count(*)::int n FROM "${r.s}"."${r.t}"`); console.log(`  ${r.s}.${r.t} = ${c.rows[0].n}`); }
    catch (e) { console.log(`  ${r.s}.${r.t} count失败:${e.message.slice(0, 40)}`); }
  }

  // 2) elections 清单（本系统选举）
  const els = await pool.query(`SELECT el_id, org_id, el_election_date d, el_status FROM elections ORDER BY el_election_date`);
  console.log(`\n=== elections 共 ${els.rows.length} 届 ===`);
  els.rows.forEach((r) => console.log(`  ${r.el_id} | org=${r.org_id} | D=${r.d} | ${r.el_status || ''}`));

  // 3) dry-run：按新区间语义重算，找 stage_end_date 不一致行
  const tpl = await pool.query(`SELECT st_key, st_day_offset off, st_duration_days endoff FROM stage_templates`);
  const tmap = Object.fromEntries(tpl.rows.map((t) => [t.st_key, t]));
  let wrong = 0, total = 0; const byEl = {};
  const st = await pool.query(`SELECT election_id el, stage_key k, stage_start_date s, stage_end_date e FROM election_stages`);
  for (const x of st.rows) {
    const t = tmap[x.k]; if (!t) continue;
    const el = els.rows.find((z) => z.el_id === x.el); if (!el) continue;
    total++;
    const expectE = shiftDate(el.d, Number(t.endoff));
    if (expectE !== x.e) { wrong++; byEl[x.el] = (byEl[x.el] || 0) + 1; }
  }
  console.log(`\n=== stages 结束日 dry-run === 总行=${total} 结束日需修正=${wrong}`);
  Object.entries(byEl).forEach(([k, v]) => console.log(`  将修正选举 ${k}: ${v} 行`));
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
