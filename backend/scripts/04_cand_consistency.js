// 只读：复刻 api.js deriveStatus，全量扫描 candidates 轮次列/状态一致性（仅 el-11/el-15）
const { loadPool } = require('./_db');
const pool = loadPool();
function deriveStatus(r1, r2, r3, r4, votes) {
  if (r1 === '不通过') return '初审退出';
  if (r2 === '不通过') return '预选未入围';
  if (r3 === '不通过') return '联审不通过';
  if (r4 === '不通过') return '考察不通过';
  if (r4 === '通过') return votes != null ? (votes > 0 ? '当选' : '落选') : '正式候选人';
  if (r3 === '通过') return '待第4轮考察';
  if (r2 === '通过') return '待第3轮';
  if (r1 === '通过') return '待第2轮';
  return '待初审';
}
const LEGAL_ROUND = ['通过', '不通过', '待审', null];
(async () => {
  try {
    const rows = (await pool.query(`
      SELECT id, election_id, cand_name, cand_position_id pos, cand_r1 r1, cand_r2 r2, cand_r3 r3, cand_r4 r4,
             cand_status st, cand_votes votes
      FROM candidates WHERE election_id IN ('el-11','el-15') ORDER BY election_id, created_at`)).rows;
    console.log('election | name | r1 | r2 | r3 | r4 | stored_status | derived | votes | issues');
    for (const c of rows) {
      const derived = deriveStatus(c.r1, c.r2, c.r3, c.r4, c.votes);
      const issues = [];
      for (const k of ['r1','r2','r3','r4']) if (!LEGAL_ROUND.includes(c[k])) issues.push(`${k}非法值「${c[k]}」`);
      if (derived !== c.st) issues.push(`状态≠派生(${derived})`);
      if (issues.length) console.log([c.election_id,c.cand_name,c.r1,c.r2,c.r3,c.r4,c.st,derived,c.votes,'⚠ '+issues.join('；')].join(' | '));
    }
    console.log('\n-- 全部扫描完毕，仅列出有问题行 --');
  } catch (e) { console.error('FATAL:', e); process.exitCode = 1; }
  finally { await pool.end(); }
})();
