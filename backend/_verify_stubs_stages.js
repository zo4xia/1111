'use strict';
// 综合验证：①16阶段区间日期正确(跨天阶段 end≠start) ②每份公告/岗位带独立附件 ③附件 URL 真能下载 200
const fs = require('fs');
const path = require('path');
const pg = require('pg');
const env = fs.readFileSync(path.join(__dirname, 'neon.env'), 'utf-8').match(/^DATABASE_URL\s*=\s*(.+)$/m);
pg.types.setTypeParser(1082, (v) => v);
const pool = new pg.Pool({ connectionString: env[1].trim(), ssl: { rejectUnauthorized: false } });
const BASE = 'http://localhost:8080';

(async () => {
  // ① 阶段日期：取一个有完整16阶段的选举
  const els = await pool.query(
    `SELECT e.el_id, e.el_election_date d, count(s.*) n
     FROM elections e JOIN election_stages s ON s.election_id=e.el_id
     WHERE e.el_election_date IS NOT NULL GROUP BY e.el_id,e.el_election_date HAVING count(s.*)>=16 ORDER BY e.el_id LIMIT 1`);
  if (els.rows[0]) {
    const e = els.rows[0];
    console.log(`=== 日程区间核验 ${e.el_id}  D=${e.d}（${e.n}阶段）===`);
    const st = await pool.query(
      `SELECT stage_key k, stage_start_date s, stage_end_date en, stage_status st FROM election_stages WHERE election_id=$1 ORDER BY stage_order`, [e.el_id]);
    let bad = 0;
    for (const r of st.rows) {
      const cross = String(r.k).includes('~');
      const wrongCross = cross && r.s === r.en; // 跨天阶段被压成一天即错
      if (wrongCross) bad += 1;
      console.log(`${String(r.k).padEnd(9)} ${r.s} ~ ${r.en}  [${String(r.st).padEnd(3)}]${cross ? ' 区间' : ''}${wrongCross ? '  !!跨天被压成一天' : ''}`);
    }
    console.log(bad ? `!! 有 ${bad} 个跨天阶段仍错误` : '✓ 跨天阶段区间全部正确（结束日晚于开始日）');
  } else console.log('（无完整16阶段选举可验）');

  // ② HTTP 登录
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '13800000001', password: '123456' }),
  }).then((r) => r.json());
  const token = login.data && login.data.token;
  const H = { Authorization: 'Bearer ' + token };
  console.log('\n=== 附件核验（登录' + (token ? '成功' : '失败') + '）===');

  const ann = await fetch(`${BASE}/api/announcements`, { headers: H }).then((r) => r.json());
  const anns = ann.data || [];
  const withFile = anns.filter((a) => a.annFiles && a.annFiles.length);
  console.log(`公告 ${anns.length} 份，带独立附件 ${withFile.length} 份`);

  const pos = await fetch(`${BASE}/api/positions`, { headers: H }).then((r) => r.json());
  const poss = pos.data || [];
  const posWith = poss.filter((p) => p.posFiles && p.posFiles.length);
  console.log(`岗位 ${poss.length} 个，带附件 ${posWith.length} 个`);

  // ③ 真实下载 3 个样本：两份不同公告（验证各自独立、不写死）+ 一个岗位
  const samples = [withFile[0], withFile[Math.floor(withFile.length / 2)]]
    .filter(Boolean).map((a) => ({ tag: `公告${a.annCode}`, url: a.annFiles[0].url }));
  if (posWith[0]) samples.push({ tag: `岗位${posWith[0].posType || ''}`, url: posWith[0].posFiles[0].url });
  for (const s of samples) {
    const rr = await fetch(`${BASE}${s.url}`);
    const txt = rr.ok ? await rr.text() : '';
    console.log(`下载 [${s.tag}] HTTP ${rr.status} ${rr.headers.get('content-type') || ''} 首行:${txt.split('\n')[0].slice(0, 30)}`);
  }
  await pool.end();
})().catch(async (e) => { console.error('ERR', e.message); try { await pool.end(); } catch {} process.exit(1); });
