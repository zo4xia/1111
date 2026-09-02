// 快速抽查（只读）：命令行参数传 SQL 片段不方便，固定输出回滚后/修复后关键指标
const { loadPool } = require('./_db');
(async () => {
  const p = loadPool();
  const r = await p.query(`
    SELECT
      (SELECT string_agg(acc_name||':'||roles, ',') FROM accounts WHERE roles ~ '^NO\\.') AS no_roles,
      (SELECT string_agg(el_id||':'||el_status, ',') FROM elections WHERE el_id IN ('el-11','el-15')) AS els,
      (SELECT count(*) FROM election_results WHERE election_id='el-15') AS er15,
      (SELECT count(*) FROM materials WHERE mat_candidate_id ~ '^[0-9a-f]{8}-' AND election_id IN ('el-11','el-15')) AS m_uuid,
      (SELECT count(*) FROM organizations WHERE org_note LIKE '%2026-09-02数据订正标记%') AS org_marked,
      (SELECT stage_status FROM election_stages WHERE election_id='el-11' AND stage_key='D+1~+10') AS el11_tail,
      (SELECT string_agg(cand_name||':'||cand_status, ',') FROM candidates WHERE (election_id='el-15' AND cand_name IN ('林强','黄志明')) OR (election_id='el-11' AND cand_name IN ('郑阿土','许金坤'))) AS cands`);
  console.log(JSON.stringify(r.rows[0], null, 1));
  await p.end();
})();
