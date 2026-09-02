// 只读排查脚本（02·紧凑版）：单行/汇总输出，便于核对。不做任何写操作
const { loadPool } = require('./_db');
const pool = loadPool();
function sec(t){ console.log('\n===== ' + t + ' ====='); }
async function q(sql, params = []) { return (await pool.query(sql, params)).rows; }
function table(rows, cols) {
  if (!rows.length) { console.log('(0 行)'); return; }
  const ks = cols || Object.keys(rows[0]);
  console.log('| ' + ks.join(' | ') + ' |');
  for (const r of rows) console.log('| ' + ks.map(k => String(r[k] === null || r[k] === undefined ? '∅' : r[k])).join(' | ') + ' |');
}

(async () => {
  try {
    sec('关键列类型');
    table(await q(`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_name IN ('elections','election_stages','election_results','candidates','positions','materials','accounts','account_roles','announcements','voters')
        AND (column_name LIKE '%date%' OR column_name LIKE '%time%' OR column_name IN ('roles','role_key','cand_position_id','mat_candidate_id','mat_position_id','el_status','stage_status','ann_code'))
      ORDER BY table_name, ordinal_position`));

    sec('P0-2 北京时间对齐校验（选举日 vs D0阶段 vs 结果日）');
    table(await q(`
      SELECT e.el_id,
        (e.el_election_date AT TIME ZONE 'Asia/Shanghai')::date AS el_d_bj,
        (s.stage_start_date AT TIME ZONE 'Asia/Shanghai')::date AS d0_stage_bj,
        (r.er_d AT TIME ZONE 'Asia/Shanghai')::date AS result_d_bj,
        e.el_status
      FROM elections e
      LEFT JOIN election_stages s ON s.election_id=e.el_id AND s.stage_key='D0'
      LEFT JOIN (SELECT election_id, min(er_election_date) er_d FROM election_results GROUP BY election_id) r ON r.election_id=e.el_id
      ORDER BY e.el_id`));

    sec('P1-2 candidates 紧凑表');
    table(await q(`
      SELECT election_id AS el, cand_name AS name, cand_position_id AS pos, cand_source AS src,
             cand_r1 r1, cand_r2 r2, cand_r3 r3, cand_r4 r4, cand_status st, cand_votes votes
      FROM candidates ORDER BY election_id, created_at`));

    sec('候选人 cand_position_id 取值分布');
    table(await q(`SELECT election_id el, cand_position_id pos, count(*)::int n FROM candidates GROUP BY 1,2 ORDER BY 1,2`));
    sec('候选人 position_id 是否能匹配 positions（按选举+pos_type）');
    table(await q(`
      SELECT c.election_id el, c.cand_position_id pos, count(*)::int n,
             count(p.id)::int matched_positions
      FROM candidates c LEFT JOIN positions p ON p.election_id=c.election_id AND p.pos_type=c.cand_position_id
      GROUP BY 1,2 ORDER BY 1,2`));

    sec('P1-4 voters 结构与分布');
    table(await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='voters' ORDER BY ordinal_position`));
    table(await q(`SELECT election_id el, count(*)::int n FROM voters GROUP BY election_id ORDER BY election_id`));

    sec('P1-3 results 紧凑表');
    table(await q(`
      SELECT election_id el, er_position pos, er_winner_name winner, er_votes votes,
             er_eligible_voters elig, er_actual_voters actual, er_turnout turnout,
             er_result_ann_code ann, er_filing_status filing, er_handover_status handover
      FROM election_results ORDER BY election_id, er_position DESC`));

    sec('P1-1 organizations 汇总');
    table(await q(`SELECT count(*)::int total, count(*) FILTER (WHERE name LIKE '%占位%')::int placeholder,
      count(*) FILTER (WHERE org_phone IS NULL)::int phone_null,
      count(*) FILTER (WHERE org_person IS NULL)::int person_null,
      count(*) FILTER (WHERE status IS DISTINCT FROM 'active')::int status_not_active FROM organizations`));
    table(await q(`SELECT type, town, count(*)::int n, count(*) FILTER (WHERE name LIKE '%占位%')::int ph FROM organizations GROUP BY 1,2 ORDER BY 1,2`));
    table(await q(`SELECT slug, name, town, type, status FROM organizations WHERE name NOT LIKE '%占位%' ORDER BY type,town,name`));

    sec('P2-1 announcements ann_code 分布');
    table(await q(`SELECT election_id el, ann_code code, ann_stage_key stage, ann_status st, count(*)::int n FROM announcements GROUP BY 1,2,3,4 ORDER BY 1,3,2`));

    sec('P2-2 materials 紧凑表');
    table(await q(`
      SELECT id, election_id el, mat_type type, mat_status st, mat_position_id pos, mat_candidate_id cand,
             mat_submitter submitter, mat_submitter_phone phone, mat_stage stage
      FROM materials ORDER BY election_id, id`));
    sec('materials.mat_candidate_id 与 candidates.id 匹配情况（uuid 才可能匹配）');
    table(await q(`
      SELECT m.election_id el,
        count(*)::int total,
        count(*) FILTER (WHERE m.mat_candidate_id ~* '^[0-9a-f]{8}-')::int uuid_like,
        count(c.id)::int matched_cand
      FROM materials m LEFT JOIN candidates c ON c.id::text = m.mat_candidate_id::text
      GROUP BY 1 ORDER BY 1`));

    sec('P2-3 proposals 紧凑表');
    table(await q(`
      SELECT id, election_id el, prop_title title, prop_status st, prop_creator_id creator, prop_reviewer_id reviewer,
             prop_submit_time submit, prop_election_date dday FROM proposals ORDER BY prop_submit_time`));
    sec('elections.el_proposal_id 关联');
    table(await q(`SELECT el_id, el_status, el_proposal_id FROM elections ORDER BY el_id`));

    sec('roles 字典表（6行）');
    table(await q(`SELECT * FROM roles ORDER BY 1`));

    sec('阶段状态分布');
    table(await q(`SELECT election_id el, stage_status st, count(*)::int n, min(stage_order) mino, max(stage_order) maxo FROM election_stages GROUP BY 1,2 ORDER BY 1,2`));

    sec('roster/archives/notifications 概览');
    table(await q(`SELECT 'roster' t, count(*)::int n FROM roster UNION ALL SELECT 'archives', count(*) FROM archives UNION ALL SELECT 'notifications', count(*) FROM notifications UNION ALL SELECT 'notification_reads', count(*) FROM notification_reads`));
  } catch (e) {
    console.error('FATAL:', e);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
