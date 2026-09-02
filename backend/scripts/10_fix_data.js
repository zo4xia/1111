/**
 * 10_fix_data.js — 城厢区换届选举系统 数据自洽修复（幂等）
 * ------------------------------------------------------------------
 * 原则：
 *  1) 只订正数据，不物理删除；只碰 el-11/el-15 及种子账号，显式排除主线端到端自测数据（如 el-mtiyny8g）。
 *  2) 所有改动前把原值整行写入 data_fix_backup（批次 BATCH），配套 99_rollback.js 可整批回滚。
 *  3) 幂等：每条 UPDATE/INSERT 都带"仅当不符合目标态"的守卫，重复执行 0 改动、不报错。
 *  4) DRY 模式：$env:DRY=1; node scripts/10_fix_data.js  —— 只统计将改动的行，不写库。
 * 用法：
 *   node scripts/10_fix_data.js             # 执行修复
 *   $env:DRY=1; node scripts/10_fix_data.js # 演练
 *   node scripts/99_rollback.js             # 整批回滚
 */
const { loadPool } = require('./_db');
const pool = loadPool();
const BATCH = 'B20260902';
const DRY = !!process.env.DRY;

const NOTE_EL11 = '已于2026-07-16完成投票选举，选举结果已备案（第17号公告）；新旧班子交接尚未完成，待跟进（2026-09-02数据订正）';
const NOTE_EL15 = '已于2026-07-30完成投票选举；结果仅补录主任岗位（黄志明28票），其余岗位结果及选民汇总数据待业务补录（2026-09-02数据订正）';
const ORG_MARK = '占位组织（2026-09-02数据订正标记：待业务核实后补全或清理，本次不删除）';
const RESULT_NOTE = '2026-09-02数据订正补录：依据 candidates 中黄志明「当选」状态与 cand_votes=28；应有选民/实投/有效/无效票等汇总数据缺失，待业务补录';
const CAND_NOTE = '；2026-09-02数据订正：依据已录入的「当选」状态与得票28，补齐R3/R4=通过';

const log = (...a) => console.log(...a);
const summary = [];

/**
 * 通用"备份+更新"：备份 SELECT 与 UPDATE 使用完全相同的 WHERE（别名 t）。
 * backupWhere / updateWhere 一致，保证只备份真正会改的行，重复执行不再备份。
 */
async function fixRows(client, tbl, whereSql, updateSql, params = []) {
  // 备份语句：$1=BATCH、$2=tbl，用户参数从 $3 起（把 whereSql 中的 $n 平移为 $(n+2)）
  const backupWhere = whereSql.replace(/\$(\d+)/g, (m, n) => '$' + (Number(n) + 2));
  // 备份 WHERE 只引用部分用户参数时，按最大占位符编号裁剪绑定（避免 bind 参数数不符）
  const refs = [...backupWhere.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
  const maxRef = Math.max(2, ...refs);
  const backupParams = [BATCH, tbl];
  for (let i = 3; i <= maxRef; i += 1) backupParams.push(params[i - 3]);
  const b = await client.query(
    `INSERT INTO data_fix_backup(batch,op,tbl,pk,old)
     SELECT $1,'U',$2,t.id::text,to_jsonb(t) FROM ${tbl} t WHERE ${backupWhere}
       AND NOT EXISTS (SELECT 1 FROM data_fix_backup b WHERE b.batch=$1 AND b.tbl=$2 AND b.pk=t.id::text AND b.op='U')`,
    backupParams);
  const u = await client.query(updateSql, params);
  return { backedUp: b.rowCount, changed: u.rowCount };
}

async function section(client, name, fn) {
  log(`\n----- ${name} -----`);
  const r = await fn(client);
  summary.push({ name, ...r });
  log(`  备份 ${r.backedUp} 行；改动 ${r.changed} 行${DRY ? '（DRY 演练，最终 ROLLBACK）' : ''}`);
  return r;
}

(async () => {
  const client = await pool.connect();
  try {
    log(`=== 数据自洽修复开始  BATCH=${BATCH}  MODE=${DRY ? 'DRY-RUN' : 'APPLY'} ===`);
    await client.query(`CREATE TABLE IF NOT EXISTS data_fix_backup (
      id bigserial PRIMARY KEY,
      batch text NOT NULL,
      op char(1) NOT NULL,           -- U=更新前镜像  I=新增行镜像（回滚时删除）
      tbl text NOT NULL,
      pk text NOT NULL,
      old jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    log('备份表 data_fix_backup 就绪');

    // 安全闸：只允许 el-11/el-15；自测选举不触碰
    const scope = await client.query(`SELECT el_id FROM elections WHERE el_id IN ('el-11','el-15') ORDER BY el_id`);
    if (scope.rows.length !== 2) throw new Error('目标选举 el-11/el-15 不齐全，中止：' + JSON.stringify(scope.rows));
    const test = await client.query(`SELECT el_id, el_name FROM elections WHERE el_name LIKE '%测试%' OR el_name LIKE '%自测%'`);
    log('修复范围：el-11, el-15 | 明确排除的自测选举：', test.rows.map(r => `${r.el_id}(${r.el_name})`).join('；') || '无');

    await client.query('BEGIN');

    // A. P0-3 accounts.roles：NO.00x → 该账号唯一 active 的 account_roles.role_key
    await section(client, 'A. accounts.roles 非法值 NO.00x → 合法角色', async (c) => {
      const w = `t.roles ~ '^NO\\.'
        AND (SELECT count(*) FROM account_roles ar WHERE ar.acc_id=t.id AND ar.ar_status='active')=1
        AND t.roles <> (SELECT ar.role_key FROM account_roles ar WHERE ar.acc_id=t.id AND ar.ar_status='active')`;
      const r1 = await fixRows(c, 'accounts', w,
        `UPDATE accounts t SET roles=(SELECT ar.role_key FROM account_roles ar WHERE ar.acc_id=t.id AND ar.ar_status='active'),
           updated_at=now() WHERE ${w}`);
      // 系统超管：无 account_roles 行，按其名称 → platform_admin（脱敏手机号/密码不变，仍不可登录，备注已说明）
      const w2 = `t.acc_name='系统超管' AND t.roles ~ '^NO\\.'`;
      const r2 = await fixRows(c, 'accounts', w2,
        `UPDATE accounts t SET roles='platform_admin', updated_at=now() WHERE ${w2}`);
      return { backedUp: r1.backedUp + r2.backedUp, changed: r1.changed + r2.changed };
    });

    // B. P0-2 el-11/el-15：in_progress→finished + 修正滞后备注
    await section(client, 'B. elections 状态/备注订正（→ finished）', async (c) => {
      let backedUp = 0, changed = 0;
      for (const [elId, note] of [['el-11', NOTE_EL11], ['el-15', NOTE_EL15]]) {
        const w = `t.el_id=$1 AND t.el_status='in_progress'`;
        const r = await fixRows(c, 'elections', w,
          `UPDATE elections t SET el_status='finished', el_note=$2, updated_at=now() WHERE ${w}`,
          [elId, note]);
        backedUp += r.backedUp; changed += r.changed;
      }
      return { backedUp, changed };
    });

    // C. el-15 阶段整体早 1 天 → 按 stage_templates 偏移与选举日对齐（start/end 同步平移）
    await section(client, 'C. el-15 阶段日期对齐选举日（+1天）', async (c) => {
      // 备份：仅备份"开始日 ≠ D+offset"的阶段
      const b = await c.query(
        `INSERT INTO data_fix_backup(batch,op,tbl,pk,old)
         SELECT $1,'U','election_stages',s.id::text,to_jsonb(s) FROM election_stages s, elections e, stage_templates t
         WHERE s.election_id='el-15' AND e.el_id='el-15' AND t.st_key=s.stage_key
           AND s.stage_start_date <> (e.el_election_date + t.st_day_offset)
           AND NOT EXISTS (SELECT 1 FROM data_fix_backup b WHERE b.batch=$1 AND b.tbl='election_stages' AND b.pk=s.id::text AND b.op='U')`,
        [BATCH]);
      const u = await c.query(
        `UPDATE election_stages s
         SET stage_start_date = e.el_election_date + t.st_day_offset,
             stage_end_date   = s.stage_end_date + (e.el_election_date + t.st_day_offset - s.stage_start_date),
             updated_at=now()
         FROM elections e, stage_templates t
         WHERE s.election_id='el-15' AND e.el_id='el-15' AND t.st_key=s.stage_key
           AND s.stage_start_date <> (e.el_election_date + t.st_day_offset)`);
      return { backedUp: b.rowCount, changed: u.rowCount };
    });

    // D. el-11 D+1~+10：办理中（前端不识别）→ 进行中（交接确未完成，如实呈现为逾期进行中）
    await section(client, 'D. el-11 收尾阶段 办理中→进行中', async (c) => {
      const w = `t.election_id='el-11' AND t.stage_key='D+1~+10' AND t.stage_status='办理中'`;
      return await fixRows(c, 'election_stages', w,
        `UPDATE election_stages t SET stage_status='进行中', updated_at=now() WHERE ${w}`);
    });

    // E. P1-2 候选人轮次/状态自洽（仅 4 名确定性异常；"落选"为多席位选举业务真值，不动）
    await section(client, 'E. candidates 轮次/状态自洽（4人）', async (c) => {
      let backedUp = 0, changed = 0;
      const tasks = [
        { // 郑阿土/许金坤：r3 误存状态值 → r2=不通过、r3=NULL，状态保持「预选未入围」
          where: `t.election_id='el-11' AND t.cand_name=$1 AND t.cand_r3='预选未入围' AND t.cand_status='预选未入围'`,
          sql: `UPDATE candidates t SET cand_r2='不通过', cand_r3=NULL, cand_status='预选未入围', updated_at=now() WHERE `,
          params: ['郑阿土'],
        },
        { where: `t.election_id='el-11' AND t.cand_name=$1 AND t.cand_r3='预选未入围' AND t.cand_status='预选未入围'`,
          sql: `UPDATE candidates t SET cand_r2='不通过', cand_r3=NULL, cand_status='预选未入围', updated_at=now() WHERE `,
          params: ['许金坤'] },
        { // 林强：r2=不通过 却记「初审退出」→ 派生应为「预选未入围」
          where: `t.election_id='el-15' AND t.cand_name=$1 AND t.cand_r2='不通过' AND t.cand_status='初审退出'`,
          sql: `UPDATE candidates t SET cand_status='预选未入围', updated_at=now() WHERE `,
          params: ['林强'] },
        { // 黄志明：已记当选+28票，但 R3 待审/R4 空 → 补齐通过并追加订正备注
          where: `t.election_id='el-15' AND t.cand_name=$1 AND t.cand_status='当选' AND t.cand_votes=28
                  AND (t.cand_r3='待审' OR t.cand_r4 IS NULL) AND COALESCE(t.cand_note,'') NOT LIKE '%2026-09-02数据订正%'`,
          sql: `UPDATE candidates t SET cand_r3='通过', cand_r4='通过', cand_status='当选',
                  cand_note=CASE WHEN t.cand_note IS NULL THEN $2 ELSE t.cand_note||$2 END, updated_at=now() WHERE `,
          params: ['黄志明', CAND_NOTE] },
      ];
      for (const task of tasks) {
        const r = await fixRows(c, 'candidates', task.where, task.sql + task.where, task.params);
        backedUp += r.backedUp; changed += r.changed;
      }
      return { backedUp, changed };
    });

    // F. el-15 岗位已随选举结束：open→closed（对齐 el-11 已结束届）
    await section(client, 'F. el-15 positions open→closed', async (c) => {
      const w = `t.election_id='el-15' AND t.pos_status='open'`;
      return await fixRows(c, 'positions', w,
        `UPDATE positions t SET pos_status='closed', updated_at=now() WHERE ${w}`);
    });

    // G. P2-2 materials.mat_candidate_id 姓名→候选人 UUID（应用同款键：同选举+同手机号，且唯一匹配；已是 UUID 不动）
    await section(client, 'G. materials.mat_candidate_id 姓名→UUID', async (c) => {
      const w = `t.election_id IN ('el-11','el-15')
        AND COALESCE(t.mat_candidate_id,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (SELECT count(*) FROM candidates c2 WHERE c2.election_id=t.election_id AND c2.cand_phone=t.mat_submitter_phone)=1`;
      const r = await fixRows(c, 'materials', w,
        `UPDATE materials t SET mat_candidate_id=(SELECT c2.id::text FROM candidates c2 WHERE c2.election_id=t.election_id AND c2.cand_phone=t.mat_submitter_phone),
           updated_at=now() WHERE ${w}`);
      return r;
    });

    // H. P2-3 elections.el_proposal_id 回填（恰好 1 个 approved 提案时）
    await section(client, 'H. elections.el_proposal_id 回填', async (c) => {
      const w = `t.el_id IN ('el-11','el-15') AND t.el_proposal_id IS NULL
        AND (SELECT count(*) FROM proposals p WHERE p.election_id=t.el_id AND p.prop_status='approved')=1`;
      return await fixRows(c, 'elections', w,
        `UPDATE elections t SET el_proposal_id=(SELECT p.id FROM proposals p WHERE p.election_id=t.el_id AND p.prop_status='approved' LIMIT 1),
           updated_at=now() WHERE ${w}`);
    });

    // I. P1-3 el-15 补结果：仅有证据的主任岗位（黄志明28票）；汇总数字不臆造
    await section(client, 'I. el-15 补录主任结果（黄志明28票）', async (c) => {
      const existed = (await c.query(`SELECT count(*)::int n FROM election_results WHERE election_id='el-15' AND er_position='主任'`)).rows[0].n;
      if (existed) return { backedUp: 0, changed: 0 };
      const ins = await c.query(
        `INSERT INTO election_results (org_id, org_name, election_id, er_election_date, er_position, er_winner_name, er_votes, er_note)
         VALUES ('s-jiankou','涧口居委会','el-15',DATE '2026-07-30','主任','黄志明',28,$1) RETURNING id`, [RESULT_NOTE]);
      await c.query(
        `INSERT INTO data_fix_backup(batch,op,tbl,pk,old)
         SELECT $1,'I','election_results',id::text,to_jsonb(election_results) FROM election_results WHERE id=$2`,
        [BATCH, ins.rows[0].id]);
      return { backedUp: 0, changed: ins.rowCount };
    });

    // J. P1-1 占位组织：不删除、不改 status（避免影响登录下拉等），仅 org_note 打标
    await section(client, 'J. organizations 占位数据打标（不删除）', async (c) => {
      const w = `t.name LIKE '%占位%' AND t.org_note IS DISTINCT FROM $1`;
      return await fixRows(c, 'organizations', w,
        `UPDATE organizations t SET org_note=$1, updated_at=now() WHERE ${w}`, [ORG_MARK]);
    });

    if (DRY) {
      await client.query('ROLLBACK');
      log('\n=== DRY 演练结束：已 ROLLBACK，未写入 ===');
    } else {
      await client.query('COMMIT');
      log('\n=== 已 COMMIT，修复完成 ===');
    }
    log('\n各节汇总：');
    for (const r of summary) log(`  ${r.name} —— 备份 ${r.backedUp} / 改动 ${r.changed}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('修复中止，已 ROLLBACK。错误信息 100% 保留：', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
