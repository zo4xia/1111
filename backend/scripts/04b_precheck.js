// 只读：修复前最后预检（主键列、手机号唯一性、NO账号角色行数、测试数据排查）
const { loadPool } = require('./_db');
const pool = loadPool();
function sec(t){ console.log('\n== ' + t + ' =='); }
async function show(sql,p=[]){ const r = await pool.query(sql,p); console.log(JSON.stringify(r.rows)); }
(async () => {
  try {
    sec('相关表主键列');
    await show(`SELECT t.relname tbl, a.attname pkcol FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(c.conkey)
      WHERE c.contype='p' AND t.relname IN ('accounts','account_roles','elections','election_stages','candidates','positions','materials','proposals','election_results','organizations') ORDER BY 1`);
    sec('NO.% 账号的 active 角色行数（必须都=1）');
    await show(`SELECT a.acc_name, a.roles, count(ar.id)::int n FROM accounts a LEFT JOIN account_roles ar ON ar.acc_id=a.id AND ar.ar_status='active'
      WHERE a.roles ~ '^NO\\.' GROUP BY 1,2 ORDER BY 1`);
    sec('候选人同(选举,手机号)是否唯一');
    await show(`SELECT election_id, cand_phone, count(*)::int n FROM candidates GROUP BY 1,2 HAVING count(*)>1`);
    sec('每选举 approved 提案数（el-11/el-15 必须=1）');
    await show(`SELECT election_id, count(*)::int n FROM proposals WHERE prop_status='approved' AND election_id IN ('el-11','el-15') GROUP BY 1 ORDER BY 1`);
    sec('测试/自测字样记录排查（elections/proposals）');
    await show(`SELECT el_id, el_name, el_status FROM elections WHERE el_name LIKE '%测试%' OR el_name LIKE '%自测%'`);
    await show(`SELECT id, election_id, prop_title, prop_status FROM proposals WHERE prop_title LIKE '%测试%' OR prop_title LIKE '%自测%'`);
    sec('当前所有 elections 概览（确认修复范围）');
    await show(`SELECT el_id, org_id, el_status, el_election_date FROM elections ORDER BY el_id`);
  } catch (e) { console.error('FATAL:', e); process.exitCode = 1; }
  finally { await pool.end(); }
})();
