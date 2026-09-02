// 只读排查脚本（03）：表结构约束 + 异常公告明细 + el-15阶段偏移实测
const { loadPool } = require('./_db');
const pool = loadPool();
function sec(t){ console.log('\n===== ' + t + ' ====='); }
async function t(sql, p=[]){ const r = await pool.query(sql,p); console.log(JSON.stringify(r.rows,null,1)); return r.rows; }

(async () => {
  try {
    sec('organizations 全部列');
    await t(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='organizations' ORDER BY ordinal_position`);
    sec('占位组织样例（前10）');
    await t(`SELECT slug, name, town, type, status FROM organizations WHERE name LIKE '%占位%' ORDER BY town,name LIMIT 10`);

    sec('election_results 列约束');
    await t(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='election_results' ORDER BY ordinal_position`);
    sec('election_results 唯一约束/索引');
    await t(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='election_results'::regclass`);
    await t(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='election_results'`);

    sec('announcements 6 条非规范编号明细');
    await t(`SELECT id, election_id, ann_code, ann_title, ann_stage_key, ann_status, length(ann_content) content_len FROM announcements WHERE ann_code !~ '^第[0-9]+(-[0-9]+)?号$' ORDER BY election_id, ann_stage_key`);

    sec('el-15 阶段：实际日期 vs 以选举日2026-07-30为锚的应有日期');
    await t(`
      SELECT s.stage_key, s.stage_start_date AS actual_start, s.stage_end_date AS actual_end,
             t.st_day_offset,
             (DATE '2026-07-30' + t.st_day_offset) AS expect_start,
             (s.stage_start_date - (DATE '2026-07-30' + t.st_day_offset)) AS start_diff_days
      FROM election_stages s JOIN stage_templates t ON t.st_key=s.stage_key
      WHERE s.election_id='el-15' ORDER BY s.stage_order`);
    sec('el-11 阶段：同样校验（锚 2026-07-16）');
    await t(`
      SELECT s.stage_key, s.stage_start_date actual_start,
             (DATE '2026-07-16' + t.st_day_offset) expect_start,
             (s.stage_start_date - (DATE '2026-07-16' + t.st_day_offset)) start_diff_days
      FROM election_stages s JOIN stage_templates t ON t.st_key=s.stage_key
      WHERE s.election_id='el-11' ORDER BY s.stage_order`);

    sec('materials→candidates 按(选举,手机号)可匹配性实测');
    await t(`
      SELECT m.election_id el, count(*)::int materials,
        count(c.id)::int match_by_phone,
        count(*) FILTER (WHERE c.id IS NULL)::int unmatched
      FROM materials m LEFT JOIN candidates c ON c.election_id=m.election_id AND c.cand_phone=m.mat_submitter_phone
      GROUP BY 1 ORDER BY 1`);
    await t(`
      SELECT m.id, m.election_id, m.mat_submitter, m.mat_submitter_phone, m.mat_candidate_id, c.id cand_id, c.cand_name
      FROM materials m LEFT JOIN candidates c ON c.election_id=m.election_id AND c.cand_phone=m.mat_submitter_phone
      WHERE c.id IS NULL OR m.mat_candidate_id !~ '^[0-9a-f]{8}-' ORDER BY m.election_id`);

    sec('accounts 约束（roles 是否有 CHECK）');
    await t(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='accounts'::regclass`);
    sec('account_roles 约束');
    await t(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='account_roles'::regclass`);

    sec('positions 约束与 pos_status 取值');
    await t(`SELECT DISTINCT pos_status FROM positions`);
  } catch (e) { console.error('FATAL:', e); process.exitCode = 1; }
  finally { await pool.end(); }
})();
