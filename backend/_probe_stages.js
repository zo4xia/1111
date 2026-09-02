'use strict';
// 只读核查：D 日口径。D=选举日；st_day_offset 负数=D 之前(提早)，正数=D 之后。
// 同时复算 shiftDate 与库里已生成的 election_stages 实际日期比对，确认符号没写反。
const fs = require('fs');
const path = require('path');
const pg = require('pg');
const m = fs.readFileSync(path.join(__dirname, 'neon.env'), 'utf-8').match(/^DATABASE_URL\s*=\s*(.+)$/m);
pg.types.setTypeParser(1082, (v) => v);
const pool = new pg.Pool({ connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } });

function shiftDate(dateStr, offset) {
  const [y, mo, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, (mo || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + Number(offset || 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

(async () => {
  const tpl = await pool.query(`SELECT st_key, st_name, st_day_offset off, st_duration_days dur, st_order ord FROM stage_templates ORDER BY st_order`);
  console.log('=== stage_templates 模板（共' + tpl.rows.length + '阶段）===');
  let badSign = [];
  for (const r of tpl.rows) {
    const isBefore = String(r.st_key).startsWith('D-') || (Number(r.off) < 0);
    const signOk = !(String(r.st_key).match(/^D-(\d+)/) && Number(r.off) >= 0); // D-xx 必须 offset<0
    if (!signOk) badSign.push(r.st_key);
    console.log(`${String(r.ord).padStart(2)} ${String(r.st_key).padEnd(9)} off=${String(r.off).padStart(4)} dur=${String(r.dur).padStart(2)} ${r.st_name}`);
  }
  console.log('\nD- 阶段但 offset 非负（符号写反）:', badSign.length ? badSign : '无');

  // 取最近一次 E2E 选举 D=2027-03-15 实算比对
  const el = await pool.query(`SELECT el_id, el_election_date d FROM elections WHERE el_id='el-mtjbnbh1'`);
  if (el.rows[0]) {
    const D = el.rows[0].d;
    console.log('\n=== 实测选举 el-mtjbnbh1 D=' + D + ' ===');
    const st = await pool.query(`SELECT stage_key, stage_start s, stage_end e FROM election_stages WHERE election_id=$1 ORDER BY stage_order`, [el.rows[0].el_id]);
    let mismatch = 0;
    for (const x of st.rows) {
      const t = tpl.rows.find((z) => z.st_key === x.stage_key);
      if (!t) continue;
      const expectS = shiftDate(D, t.off);
      const expectE = shiftDate(expectS, Math.max(1, Number(t.dur || 1)) - 1);
      const ok = expectS === x.s && expectE === x.e;
      if (!ok) mismatch++;
      console.log(`${x.stage_key.padEnd(9)} 库:${x.s}~${x.e}  算:${expectS}~${expectE}  ${ok ? 'OK' : '!!不一致'}`);
    }
    console.log('\n实算与库不一致阶段数:', mismatch);
    console.log('D-34 应 = D 往前34天 =', shiftDate(D, -34), '；D0 应 =', shiftDate(D, 0));
  }
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
