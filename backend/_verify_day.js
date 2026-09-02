'use strict';
// 离线验证 D 日区间算法（只读模板 + 内存复算，不写库）：start=D+offset, end=D+结束offset
const fs = require('fs');
const path = require('path');
const pg = require('pg');
pg.types.setTypeParser(1082, (v) => v);
const conn = fs.readFileSync(path.join(__dirname, 'neon.env'), 'utf-8').match(/^DATABASE_URL\s*=\s*(.+)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });
function shiftDate(s, o) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + Number(o || 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
(async () => {
  const D = '2027-03-15'; // 虚拟选举日，仅内存计算
  const r = await pool.query(`SELECT st_key k, st_name n, st_day_offset o, st_duration_days e, st_order ord FROM stage_templates ORDER BY st_order`);
  console.log(`虚拟 D=${D}，新算法 start=D+offset, end=D+结束offset（旧算法会把负向区间压成1天）\n`);
  let fail = 0;
  for (const t of r.rows) {
    const s = shiftDate(D, t.o), e = shiftDate(D, Number(t.e));
    const days = (new Date(e) - new Date(s)) / 86400000 + 1;
    const expectSingle = Number(t.o) === Number(t.e);
    const ok = expectSingle ? days === 1 : days >= 2 && e >= s;
    if (!ok) fail++;
    console.log(`${String(t.ord).padStart(2)} ${t.k.padEnd(10)} ${s} ~ ${e}  共${days}天  ${t.n} ${ok ? '' : '!!错'}`);
  }
  // 重点断言
  const ck = (k, es, ee) => { const t = r.rows.find((x) => x.k === k); const s = shiftDate(D, t.o), e = shiftDate(D, Number(t.e)); console.log(`断言 ${k}: ${s}~${e} 期望 ${es}~${ee}  ${s === es && e === ee ? 'PASS' : 'FAIL'}`); return (s === es && e === ee) ? 0 : 1; };
  fail += ck('D-33~-29', '2027-02-10', '2027-02-14'); // 3/15 往前33=2/10，往前29=2/14，5天
  fail += ck('D-20~-16', '2027-02-23', '2027-02-27');
  fail += ck('D0', '2027-03-15', '2027-03-15');
  fail += ck('D+1~+10', '2027-03-16', '2027-03-25');
  console.log('\n' + (fail === 0 ? 'ALL PASS ✅' : `FAIL x${fail}`));
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
