// 修复后回读验证（只读）：逐项核对目标态
const { loadPool } = require('./_db');
const pool = loadPool();
function sec(t){ console.log('\n== ' + t + ' =='); }
async function t(sql,p=[]){ const r=await pool.query(sql,p); console.log(JSON.stringify(r.rows)); return r.rows; }
let fail = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fail += 1;
}

(async () => {
  try {
    sec('A 账号角色：不应再有 NO.%；roles 与 account_roles.role_key 一致');
    const bad = await t(`SELECT acc_name, roles FROM accounts WHERE roles ~ '^NO\\.' ORDER BY acc_name`);
    check('accounts.roles 无 NO.% 残留', bad.length === 0, `残留 ${bad.length}`);
    const mism = await t(`
      SELECT a.acc_name, a.roles, ar.role_key FROM accounts a
      JOIN account_roles ar ON ar.acc_id=a.id AND ar.ar_status='active'
      WHERE a.roles <> ar.role_key`);
    check('accounts.roles 与 account_roles.role_key 全部一致', mism.length === 0, `不一致 ${mism.length}`);
    await t(`SELECT acc_name, acc_phone, roles FROM accounts ORDER BY org_id, acc_phone`);

    sec('B 选举状态');
    await t(`SELECT el_id, el_status, el_election_date, el_proposal_id, left(el_note,60) note FROM elections ORDER BY el_id`);
    const el = await t(`SELECT el_id, el_status FROM elections WHERE el_id IN ('el-11','el-15')`);
    check('el-11/el-15 均为 finished', el.length===2 && el.every(r=>r.el_status==='finished'));
    const testUntouched = await t(`SELECT el_id, el_status FROM elections WHERE el_id='el-mtiyny8g'`);
    check('自测选举 el-mtiyny8g 未被改动（仍 in_progress）', testUntouched.length===1 && testUntouched[0].el_status==='in_progress');

    sec('C el-15 阶段对齐（diff 应全为 0）');
    const c15 = await t(`
      SELECT count(*)::int total,
        count(*) FILTER (WHERE s.stage_start_date = e.el_election_date + t.st_day_offset)::int aligned
      FROM election_stages s, elections e, stage_templates t
      WHERE s.election_id='el-15' AND e.el_id='el-15' AND t.st_key=s.stage_key`);
    check('el-15 16 阶段全部与 D 日偏移对齐', c15[0].total===16 && c15[0].aligned===16, JSON.stringify(c15[0]));
    const c11 = await t(`
      SELECT count(*)::int total,
        count(*) FILTER (WHERE s.stage_start_date = e.el_election_date + t.st_day_offset)::int aligned
      FROM election_stages s, elections e, stage_templates t
      WHERE s.election_id='el-11' AND e.el_id='el-11' AND t.st_key=s.stage_key`);
    check('el-11 16 阶段仍全部对齐（未被误伤）', c11[0].total===16 && c11[0].aligned===16, JSON.stringify(c11[0]));
    await t(`SELECT stage_key, stage_start_date, stage_end_date, stage_status FROM election_stages WHERE election_id='el-15' AND stage_key IN ('D0','D+1~+10','D-35') ORDER BY stage_order`);

    sec('D el-11 收尾阶段状态');
    const d = await t(`SELECT stage_status FROM election_stages WHERE election_id='el-11' AND stage_key='D+1~+10'`);
    check('el-11 D+1~+10 = 进行中', d.length===1 && d[0].stage_status==='进行中', JSON.stringify(d));

    sec('E 4 名候选人');
    await t(`SELECT election_id, cand_name, cand_r1, cand_r2, cand_r3, cand_r4, cand_status, cand_votes FROM candidates WHERE (election_id='el-11' AND cand_name IN ('郑阿土','许金坤')) OR (election_id='el-15' AND cand_name IN ('林强','黄志明')) ORDER BY 1,2`);

    sec('F el-15 positions');
    const f = await t(`SELECT pos_type, pos_status FROM positions WHERE election_id='el-15' ORDER BY pos_type`);
    check('el-15 岗位全部 closed', f.length===3 && f.every(r=>r.pos_status==='closed'));

    sec('G materials 关联');
    const g = await t(`SELECT m.election_id, count(*)::int total, count(*) FILTER (WHERE m.mat_candidate_id ~ '^[0-9a-f]{8}-')::int uuid_cnt, count(c.id)::int joined
      FROM materials m LEFT JOIN candidates c ON c.id::text=m.mat_candidate_id
      WHERE m.election_id IN ('el-11','el-15') GROUP BY 1 ORDER BY 1`);
    check('materials：el-11 12/12、el-15 11/11 已挂候选人UUID（张桂香无候选人保持空）',
      g.length===2 && g.every(r => r.election_id==='el-11' ? r.total===12&&r.uuid_cnt===12&&r.joined===12 : r.total===12&&r.uuid_cnt===11&&r.joined===11),
      JSON.stringify(g));
    await t(`SELECT id, mat_submitter, mat_candidate_id FROM materials WHERE election_id='el-15' AND mat_submitter='张桂香'`);

    sec('H 提案关联');
    const h = await t(`SELECT el_id, el_proposal_id FROM elections WHERE el_id IN ('el-11','el-15') ORDER BY 1`);
    check('el-11/el-15 均已关联 approved 提案', h.length===2 && h.every(r=>r.el_proposal_id));

    sec('I el-15 结果');
    const ii = await t(`SELECT election_id, er_position, er_winner_name, er_votes, er_election_date, left(er_note,40) note FROM election_results WHERE election_id='el-15'`);
    check('el-15 已补主任结果（黄志明28票，选举日2026-07-30）',
      ii.length===1 && ii[0].er_winner_name==='黄志明' && ii[0].er_votes===28, JSON.stringify(ii));

    sec('J 占位组织标记');
    const j = await t(`SELECT count(*)::int total, count(*) FILTER (WHERE org_note LIKE '%2026-09-02数据订正标记%')::int marked, count(*) FILTER (WHERE status='active')::int still_active FROM organizations WHERE name LIKE '%占位%'`);
    check('84 个占位组织全部打标且 status 未改', j[0].total===84 && j[0].marked===84 && j[0].still_active===84, JSON.stringify(j[0]));

    sec('备份表统计');
    await t(`SELECT tbl, op, count(*)::int n FROM data_fix_backup WHERE batch='B20260902' GROUP BY 1,2 ORDER BY 1,2`);

    sec('结论');
    if (fail) { console.log(`❌ ${fail} 项校验未通过`); process.exitCode = 1; }
    else console.log('✅ 全部硬性校验通过');
  } catch (e) { console.error('FATAL:', e); process.exitCode = 1; }
  finally { await pool.end(); }
})();
