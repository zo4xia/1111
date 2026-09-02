// 只读排查脚本（01）：连 Neon 全量复查数据自洽问题，不做任何写操作
// 用法: node scripts/01_inspect.js
const { loadPool } = require('./_db');

const pool = loadPool();

function section(t) { console.log('\n===== ' + t + ' ====='); }
function show(label, rows) {
  console.log(`-- ${label}（${rows.length} 行）`);
  console.log(JSON.stringify(rows, null, 1));
}

(async () => {
  try {
    section('数据库当前日期');
    show('now', (await pool.query(`SELECT now()::timestamptz(0) now_ts, now()::date today`)).rows);

    section('全部表与行数');
    const tbls = (await pool.query(`
      SELECT relname AS table_name, n_live_tup AS approx_rows
      FROM pg_stat_user_tables ORDER BY relname`)).rows;
    show('pg_stat_user_tables', tbls);

    section('P0-3 accounts 全量');
    show('accounts', (await pool.query(`
      SELECT id, org_id, acc_name, acc_phone, acc_password_hint, roles, acc_status, acc_note, created_at
      FROM accounts ORDER BY org_id, acc_phone`)).rows);

    section('account_roles 表（业务角色明细）');
    try {
      show('account_roles', (await pool.query(`SELECT * FROM account_roles ORDER BY acc_id`)).rows);
    } catch (e) { console.log('account_roles 查询失败：', e.message); }

    section('P0-2 elections 全量');
    show('elections', (await pool.query(`
      SELECT id, org_id, el_id, el_term, el_name, el_status, el_election_date, el_method, el_proposal_id, el_note, created_at, updated_at
      FROM elections ORDER BY el_election_date`)).rows);

    section('P2-4 stage_templates 模板');
    show('stage_templates', (await pool.query(`
      SELECT st_key, st_name, st_day_offset, st_duration_days, st_order FROM stage_templates ORDER BY st_order`)).rows);

    section('election_stages 按选举分组');
    show('stages', (await pool.query(`
      SELECT election_id, stage_key, stage_name, stage_status, stage_start_date, stage_end_date, stage_order
      FROM election_stages ORDER BY election_id, stage_order`)).rows);

    section('P1-3 election_results 全量');
    show('election_results', (await pool.query(`SELECT * FROM election_results ORDER BY election_id`)).rows);

    section('positions 全量');
    show('positions', (await pool.query(`
      SELECT id, org_id, election_id, pos_type, pos_quota, pos_status, pos_desc FROM positions ORDER BY election_id, pos_type`)).rows);

    section('P1-2 candidates 全量');
    show('candidates', (await pool.query(`
      SELECT id, org_id, election_id, cand_name, cand_position_id, cand_source, cand_gender, cand_age, cand_phone,
             cand_r1, cand_r2, cand_r3, cand_r4, cand_status, cand_votes, created_at
      FROM candidates ORDER BY election_id, created_at`)).rows);

    section('P1-4 voters 按选举统计');
    show('voters_count', (await pool.query(`
      SELECT election_id, count(*)::int n FROM voters GROUP BY election_id ORDER BY election_id`)).rows);
    show('voters_sample', (await pool.query(`SELECT * FROM voters LIMIT 5`)).rows);

    section('P1-1 organizations 占位统计');
    show('orgs_total', (await pool.query(`SELECT count(*)::int total, count(*) FILTER (WHERE name LIKE '%占位%')::int placeholder,
      count(*) FILTER (WHERE org_phone IS NULL)::int phone_null,
      count(*) FILTER (WHERE org_person IS NULL)::int person_null FROM organizations`)).rows);
    show('orgs_type_town', (await pool.query(`SELECT type, town, count(*)::int n, count(*) FILTER (WHERE name LIKE '%占位%')::int ph FROM organizations GROUP BY type,town ORDER BY type,town`)).rows);
    show('orgs_real', (await pool.query(`SELECT slug, name, town, type, status, org_phone, org_person FROM organizations WHERE name NOT LIKE '%占位%' ORDER BY type,town,name`)).rows);

    section('P2-1 announcements ann_code 分布');
    show('announcements', (await pool.query(`
      SELECT id, election_id, ann_code, ann_title, ann_stage_key, ann_status, ann_publicity_deadline, ann_publish_time
      FROM announcements ORDER BY election_id, ann_code, id`)).rows);

    section('P2-2 materials 全量');
    show('materials', (await pool.query(`
      SELECT id, org_id, election_id, mat_type, mat_status, mat_position_id, mat_candidate_id,
             mat_submitter, mat_submitter_phone, mat_stage, mat_note, created_at
      FROM materials ORDER BY election_id, id`)).rows);

    section('P2-3 proposals 全量');
    show('proposals', (await pool.query(`
      SELECT id, org_id, election_id, prop_title, prop_method, prop_status, prop_creator_id, prop_reviewer_id,
             prop_submit_time, prop_review_time, prop_election_date FROM proposals ORDER BY prop_submit_time`)).rows);

    section('roster / archives / notifications / operation_logs 计数');
    for (const t of ['roster','archives','notifications','operation_logs']) {
      try { show(t, (await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows); }
      catch (e) { console.log(t + ' 查询失败：' + e.message); }
    }

  } catch (e) {
    console.error('FATAL:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
