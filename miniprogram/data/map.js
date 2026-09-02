// data/map.js — 服务端 API 响应 → 小程序 db.js 行（字段名 + 取值口径归一）
// 这是「PC 端设置 → 小程序可见」数据一致性的唯一翻译层。
//
// ⚠️ 关键契约（2026-09-02 实测修正，勿再改回下划线）：
//   后端 backend/api.js 所有 SELECT 均用 `AS "camelCase"` 别名输出驼峰字段
//   （如 el_id AS "elId"、cand_name AS "candName"、stage_start_date AS "stageStartDate"）。
//   因此本文件 from 一律写驼峰。改前先核对 backend/api.js 对应路由的 SELECT。
//
// 模板化：映射由下方 SCHEMA 声明式配置驱动，适配新系统只改 SCHEMA，不新增函数。
const { parseDate } = require('../utils/dates')

/* ── 标量归一（转换器，供 SCHEMA.fn 引用） ── */
// 时间戳归一：'2026-07-20 10:00:00+00' / '2026-07-20T10:00:00.000Z' → '2026-07-20 10:00'
const ts = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '')
const day = (v) => (v ? String(v).slice(0, 10) : '')
const s = (v) => (v === null || v === undefined ? '' : v)
// 偏移天数：相对 D 日（b - a），把服务端真实日期还原成 D 偏移量
function offsetFrom(dDay, dateStr) {
  const a = parseDate(day(dDay))
  const b = parseDate(day(dateStr))
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}
// 阶段状态归一：后端存中文「未开始/进行中/已完成」，小程序全站口径是「未开始/办理中/已完成」，
// 仅「进行中」需改写成「办理中」（其余同名直传）。历史英文值（pending/ongoing/completed）一并兼容。
const STAGE_STATUS_CN = {
  pending: '未开始', ongoing: '办理中', completed: '已完成',
  '进行中': '办理中', '未开始': '未开始', '已完成': '已完成',
}
const FNS = { ts, day, s, offsetFrom, statusCn: (v) => STAGE_STATUS_CN[v] || s(v) || '未开始' }

/* ── 声明式映射 SCHEMA（from = 后端 API 驼峰字段名） ── */
const SCHEMA = {
  organizations: [
    { to: 'slug', from: 'orgId' }, { to: 'name', from: 'name' }, { to: 'town', from: 'town' },
    { to: 'type', from: 'type' }, { to: 'status', from: 'status' },
    { to: 'org_phone', from: 'orgPhone', fn: 's' }, { to: 'org_person', from: 'orgPerson', fn: 's' },
    { to: 'org_note', const: '' },
  ],
  elections: [
    { to: 'el_org_id', from: 'orgId' }, { to: 'el_id', from: 'elId' }, { to: 'el_term', from: 'elTerm', fn: 's' },
    { to: 'el_name', from: 'elName', fn: 's' }, { to: 'el_status', from: 'elStatus', fn: 's' },
    { to: 'el_election_date', from: 'elElectionDate', fn: 'day' }, { to: 'el_method', from: 'elMethod', fn: 's' },
    { to: 'el_proposal_id', from: 'elProposalId', fn: 's' }, { to: 'el_note', from: 'elNote', fn: 's' },
  ],
  announcements: [
    { to: 'ann_org_id', from: 'orgId' }, { to: 'ann_election_id', from: 'elId', fn: 's' },
    { to: 'ann_code', from: 'annCode', fn: 's' }, { to: 'ann_title', from: 'annTitle', fn: 's' },
    { to: 'ann_stage_key', from: 'annStageKey', fn: 's' }, { to: 'ann_status', from: 'annStatus', fn: 's' },
    { to: 'ann_version', from: 'annVersion', def: 1 }, { to: 'ann_editor', from: 'annEditor', fn: 's' },
    { to: 'ann_edit_time', from: 'annEditTime', fn: 'ts' }, { to: 'ann_reviewer', from: 'annReviewer', fn: 's' },
    { to: 'ann_review_time', from: 'annReviewTime', fn: 'ts' }, { to: 'ann_publish_time', from: 'annPublishTime', fn: 'ts' },
    { to: 'ann_publicity_deadline', from: 'annPublicityDeadline', fn: 'day' },
    { to: 'ann_pin', const: false }, { to: 'ann_type', const: '公告' }, { to: 'ann_content', from: 'annContent', fn: 's' },
  ],
  positions: [
    { to: 'pos_org_id', from: 'orgId' }, { to: 'pos_election_id', from: 'elId', fn: 's' },
    { to: 'pos_type', from: 'posType', fn: 's' }, { to: 'pos_quota', from: 'posQuota' },
    { to: 'pos_status', from: 'posStatus', fn: 's' }, { to: 'pos_desc', from: 'posDesc', fn: 's' },
  ],
  materials: [
    { to: 'mat_org_id', ctx: 'orgId' }, { to: 'mat_election_id', from: 'elId', fn: 's' },
    { to: 'mat_applicant_id', ctx: 'phone' }, { to: 'mat_position_id', from: 'matPositionId', fn: 's' },
    { to: 'mat_type', from: 'matType', fn: 's' }, { to: 'mat_status', from: 'matStatus', fn: 's' },
    { to: 'mat_submitter', from: 'matSubmitter', fn: 's' }, { to: 'mat_stage', from: 'matStage', fn: 's' },
    { to: 'mat_submitter_phone', ctx: 'phone' }, { to: 'mat_candidate_id', from: 'matCandidateId', fn: 's' },
    { to: 'mat_submit_time', from: 'matSubmitTime', fn: 'ts' }, { to: 'mat_review_time', from: 'matReviewTime', fn: 'ts' },
    { to: 'mat_reviewer', from: 'matReviewer', fn: 's' }, { to: 'mat_review_comment', from: 'matReviewComment', fn: 's' },
  ],
  candidates: [
    { to: 'cand_org_id', from: 'orgId' }, { to: 'cand_election_id', from: 'elId', fn: 's' },
    { to: 'cand_acc_id', from: 'candAccId', fn: 's', fallbackFrom: 'candPhone' },
    { to: 'cand_name', from: 'candName', fn: 's' }, { to: 'cand_position_id', from: 'candPositionId', fn: 's' },
    { to: 'cand_source', from: 'candSource', fn: 's' }, { to: 'cand_gender', from: 'candGender', fn: 's' },
    { to: 'cand_age', from: 'candAge' }, { to: 'cand_phone', from: 'candPhone', fn: 's' },
    { to: 'cand_status', from: 'candStatus', fn: 's' }, { to: 'cand_votes', from: 'candVotes' },
    { to: 'cand_note', from: 'candNote', fn: 's' },
  ],
  roster: [
    { to: 'ros_org_id', from: 'orgId', fallbackCtx: 'orgId' }, { to: 'ros_position', from: 'rosPosition', fn: 's' },
    { to: 'ros_name', from: 'rosName', fn: 's' }, { to: 'ros_phone', from: 'rosPhone', fn: 's' },
    { to: 'ros_term', from: 'rosTerm', fn: 's' }, { to: 'ros_year_start', from: 'rosYearStart' },
    { to: 'ros_year_end', from: 'rosYearEnd' }, { to: 'ros_status', from: 'rosStatus', fn: 's' },
    { to: 'ros_is_active', from: 'rosIsActive', fn: 's' }, { to: 'ros_session_no', from: 'rosSessionNo', fn: 's' },
    { to: 'ros_note', from: 'rosNote', fn: 's' },
  ],
  election_results: [
    { to: 'er_org_id', from: 'orgId', fallbackCtx: 'orgId' }, { to: 'er_org_name', from: 'orgName', fn: 's' },
    { to: 'er_election_id', from: 'elId', fn: 's' }, { to: 'er_election_date', from: 'erElectionDate', fn: 'day' },
    { to: 'er_position', from: 'erPosition', fn: 's' }, { to: 'er_winner_name', from: 'erWinnerName', fn: 's' },
    { to: 'er_votes', from: 'erVotes' }, { to: 'er_eligible_voters', from: 'erEligibleVoters' },
    { to: 'er_actual_voters', from: 'erActualVoters' }, { to: 'er_valid_votes', from: 'erValidVotes' },
    { to: 'er_invalid_votes', from: 'erInvalidVotes' }, { to: 'er_turnout', from: 'erTurnout', fn: 's' },
    { to: 'er_result_ann_code', from: 'erResultAnnCode', fn: 's' }, { to: 'er_filing_status', from: 'erFilingStatus', fn: 's' },
    { to: 'er_filing_time', from: 'erFilingTime', fn: 'ts' }, { to: 'er_handover_status', from: 'erHandoverStatus', fn: 's' },
    { to: 'er_note', from: 'erNote', fn: 's' },
  ],
}

// 自定义批量字段（无法纯声明式表达的批量/结构转换）
const BUILDERS = {
  // candidates 四轮审核：后端 candR1/candR1Reviewer/candR1Time/candR1Comment × r1~r4
  candidatesRound: (r) => {
    const out = {}
    const cap = (k) => 'cand' + k.toUpperCase()
    for (const k of ['r1', 'r2', 'r3', 'r4']) {
      const C = cap(k)
      out['cand_' + k] = s(r[C])
      out['cand_' + k + '_time'] = ts(r[C + 'Time'])
      out['cand_' + k + '_reviewer'] = s(r[C + 'Reviewer'])
      out['cand_' + k + '_comment'] = s(r[C + 'Comment'])
    }
    return out
  },
}

/* ── 通用驱动 ── */
function applyRule(rule, row, ctx) {
  if (rule.const !== undefined) return rule.const
  let v = row[rule.from]
  if ((v === null || v === undefined || v === '') && rule.fallbackFrom) v = row[rule.fallbackFrom]
  if ((v === null || v === undefined || v === '') && rule.fallbackCtx && ctx) v = ctx[rule.fallbackCtx]
  if ((v === null || v === undefined || v === '') && rule.ctx && ctx) v = ctx[rule.ctx]
  if (rule.fn && FNS[rule.fn]) v = FNS[rule.fn](v)
  return v === undefined ? (rule.def !== undefined ? rule.def : '') : v
}

function projectRow(table, row, ctx) {
  const defs = SCHEMA[table]
  if (!defs) return row
  const out = {}
  for (const rule of defs) out[rule.to] = applyRule(rule, row, ctx)
  if (table === 'candidates') Object.assign(out, BUILDERS.candidatesRound(row))
  if (table === 'materials') {
    // 附件：后端 attachFiles() 挂在 files 字段（[{name,url}]），历史字段 matFiles 一并兼容
    const files = Array.isArray(row.files) ? row.files : (Array.isArray(row.matFiles) ? row.matFiles : [])
    out.mat_attachments = files.filter((x) => x && x.name && x.url)
  }
  return out
}

function projectRows(table, rows, ctx) {
  return (rows || []).map((r) => projectRow(table, r, ctx))
}

/* ── 导出（签名保持，http.js / cloud.js 零改动） ── */
function mapOrgs(rows) { return projectRows('organizations', rows) }
function mapElections(rows) { return projectRows('elections', rows) }
function mapAnnouncements(rows) { return projectRows('announcements', rows) }
function mapPositions(rows) { return projectRows('positions', rows) }
function mapCandidates(rows) { return projectRows('candidates', rows) }
function mapMaterials(rows, ctx) { return projectRows('materials', rows, ctx) }
function mapRoster(rows, orgId) { return projectRows('roster', rows, { orgId }) }
function mapResults(rows, orgId) { return projectRows('election_results', rows, { orgId }) }

/** GET /api/elections/:id/stages → election_stages
 *  后端直接返回数组（无 {election,stages} 包裹），字段为 stageKey/stageName/stageStatus/
 *  stageStartDate/stageEndDate/stageOrder；D 日由调用方从 elections 取到后以 dDay 传入。
 *  偏移量 = 真实日期相对 D 日的天数差（负=D- 提早，正=D+ 延后）。 */
function mapStages(rows, dDay, orgId, elId) {
  return (rows || []).map((x) => ({
    es_org_id: s(orgId),
    es_election_id: s(elId),
    es_stage_key: s(x.stageKey),
    es_stage_name: s(x.stageName),
    es_offset_start: offsetFrom(dDay, day(x.stageStartDate)),
    es_offset_end: offsetFrom(dDay, day(x.stageEndDate)),
    es_status: FNS.statusCn(x.stageStatus),
    es_biz_module: '',
    es_note: s(x.stageDescription || x.stDescription),
  }))
}

/** GET /api/notifications → { notifications, notification_reads }
 *  后端返回 id/orgId/elId/notifType/notifContent/notifStatus/notifScheduledAt/notifToPhones。
 *  收件箱语义：notifToPhones 命中本人手机号（或为空=全员）即算收到；已读落 notification_reads。 */
function mapMyNotifications(rows, orgId, phone) {
  const mine = (rows || []).filter((r) => {
    const to = s(r.notifToPhones)
    return !to || String(to).split(/[,;，；\s]+/).map((x) => x.trim()).filter(Boolean).includes(String(phone))
  })
  const notifications = mine.map((r) => ({
    notif_id: r.id, notif_org_id: s(r.orgId) || orgId, notif_election_id: s(r.elId),
    notif_type: s(r.notifType), notif_content: s(r.notifContent), notif_status: s(r.notifStatus),
    notif_to_role_filter: '', notif_to_phones: s(r.notifToPhones) || phone,
    notif_scheduled_at: ts(r.notifScheduledAt), notif_source_type: '', notif_source_key: '',
  }))
  const notification_reads = mine.filter((r) => r.i_read).map((r) => ({
    nr_notif_id: r.id, nr_acc_id: phone, nr_org_id: orgId, nr_read_at: '', nr_status: 'read',
  }))
  return { notifications, notification_reads }
}

module.exports = {
  ts, day, offsetFrom, SCHEMA, projectRow, projectRows,
  mapOrgs, mapElections, mapStages, mapAnnouncements, mapPositions,
  mapCandidates, mapMaterials, mapMyNotifications, mapRoster, mapResults,
}
