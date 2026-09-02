// 只读：遗留问题精确数字汇总（供报告）
const { loadPool } = require('./_db');
(async () => {
  const p = loadPool();
  const q = async (label, sql) => { const r = await p.query(sql); console.log(`\n[${label}]`); console.log(JSON.stringify(r.rows)); };
  await q('voters vs results', `
    SELECT v.election_id, v.n AS voters_rows, er.elig FROM (SELECT election_id,count(*)::int n FROM voters GROUP BY 1) v
    LEFT JOIN (SELECT election_id, max(er_eligible_voters) elig FROM election_results GROUP BY 1) er ON er.election_id=v.election_id ORDER BY 1`);
  await q('el-15 候选人状态分布（修复后）', `SELECT cand_status, count(*)::int n FROM candidates WHERE election_id='el-15' GROUP BY 1 ORDER BY 1`);
  await q('el-11 交接状态', `SELECT er_handover_status, count(*)::int n FROM election_results WHERE election_id='el-11' GROUP BY 1`);
  await q('el-14 结果公告编号为空', `SELECT count(*)::int n FROM election_results WHERE election_id='el-14' AND er_result_ann_code IS NULL`);
  await q('非规范公告编号（el-11/el-15）', `SELECT election_id, ann_code, count(*)::int n FROM announcements WHERE election_id IN ('el-11','el-15') AND ann_code !~ '^第[0-9]+(-[0-9]+)?号$' GROUP BY 1,2 ORDER BY 1,2`);
  await q('orgs 联系信息空缺', `SELECT count(*)::int total, count(*) FILTER (WHERE org_phone IS NULL)::int phone_null, count(*) FILTER (WHERE org_person IS NULL)::int person_null, count(*) FILTER (WHERE name LIKE '%占位%')::int placeholder FROM organizations`);
  await q('proposal submitted 滞留', `SELECT id, prop_title, prop_status FROM proposals WHERE prop_status NOT IN ('approved','rejected')`);
  await q('proposal 创建/审核人存手机号情况', `SELECT count(*)::int total, count(*) FILTER (WHERE prop_creator_id ~ '^1[0-9]{10}$')::int creator_phone, count(*) FILTER (WHERE prop_reviewer_id ~ '^1[0-9]{10}$')::int reviewer_phone FROM proposals`);
  await q('备份表按表统计', `SELECT tbl, op, count(*)::int n FROM data_fix_backup WHERE batch='B20260902' GROUP BY 1,2 ORDER BY 1,2`);
  await q('当前各业务表行数', `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE relname IN ('accounts','elections','election_stages','candidates','positions','materials','election_results','announcements','organizations','voters','proposals','data_fix_backup') ORDER BY 1`);
  await p.end();
})();
