/**
 * D日锚点日程引擎（与管理端日期规则保持一致）
 * 唯一输入 = elections.el_election_date，16阶段日期全部由偏移量推算
 */
function parseDate(str) {
  if (!str) return null
  const parts = str.slice(0, 10).split('-').map(Number)
  return new Date(parts[0], parts[1] - 1, parts[2])
}

function fmtDate(dt) {
  if (!dt) return ''
  const p = n => (n < 10 ? '0' + n : '' + n)
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate())
}

// 内部辅助：偏移天数（仅 computeStageDates 使用）
function addDays(baseStr, offset) {
  const dt = parseDate(baseStr)
  if (!dt) return ''
  dt.setDate(dt.getDate() + Number(offset))
  return fmtDate(dt)
}

/** 计算一届选举的16阶段计划日期 */
function computeStageDates(electionDate, stages) {
  return stages.map(s => Object.assign({}, s, {
    plan_start: electionDate ? addDays(electionDate, s.es_offset_start) : '',
    plan_end: electionDate ? addDays(electionDate, s.es_offset_end) : ''
  }))
}

function daysBetween(fromStr, toStr) {
  const a = parseDate(fromStr), b = parseDate(toStr)
  if (!a || !b) return null
  return Math.round((b - a) / 86400000)
}

// 内部辅助：完整日期 → 短日期 MM-DD（仅 shortRange 使用）
function shortDate(str) {
  if (!str) return ''
  const s = String(str).slice(0, 10)
  return s.length >= 10 ? s.slice(5) : s
}

/** 起止日期 → 短区间标签：'MM-DD' 或 'MM-DD~MM-DD'（无空格，适配窄格） */
function shortRange(start, end) {
  if (!start) return ''
  const s = shortDate(start)
  if (!end || String(end) === String(start)) return s
  return s + '~' + shortDate(end)
}

/** 起止日期 → 完整区间标签：'YYYY-MM-DD' 或 'YYYY-MM-DD ~ YYYY-MM-DD' */
function fullRange(start, end) {
  if (!start) return ''
  if (!end || String(end) === String(start)) return String(start).slice(0, 10)
  return String(start).slice(0, 10) + ' ~ ' + String(end).slice(0, 10)
}

/**
 * 材料上报窗口：D-15 当天起 ~ D-13 当天止（首尾三天都算，闭区间）
 *
 * 为什么上界取 plan_end 而不是 plan_start：
 *   「截止」指的是阶段结束日，而 es_offset_end 才是结束日。当前数据里 D-13 的
 *   es_offset_start 与 es_offset_end 同为 -13，两者等价、行为不变；
 *   一旦某届把 D-13 配成区间（如 -13 ~ -12），用 plan_start 当上界就会在 D-13 当天
 *   零点提前截止，把区间内的合法提交误判为逾期。此处按语义取 plan_end 是防御性修正。
 *
 * 返回 { open, state, start, end, days }
 *   state: 'before' 未开放 / 'open' 开放中 / 'after' 已截止 / 'none' 日程缺失
 *   days : before=距开放天数，open=剩余天数，after=已截止天数，none=null
 *   —— 页面据此给出「可行动」文案，而不是让用户点了没反应。
 */
function materialWindow(stagesWithDates, dayStr) {
  const s = stagesWithDates.find(x => x.es_stage_key === 'D-15')
  const e = stagesWithDates.find(x => x.es_stage_key === 'D-13')
  if (!s || !e) return { open: false, state: 'none', start: '', end: '', days: null }
  const start = s.plan_start || ''
  const end = e.plan_end || e.plan_start || ''
  if (!start || !end || !dayStr) return { open: false, state: 'none', start, end, days: null }
  if (dayStr < start) return { open: false, state: 'before', start, end, days: daysBetween(dayStr, start) }
  if (dayStr > end) return { open: false, state: 'after', start, end, days: daysBetween(end, dayStr) }
  return { open: true, state: 'open', start, end, days: daysBetween(dayStr, end) }
}

/** 窗口是否开放（布尔快捷方式，等价于 materialWindow(...).open） */
function materialWindowOpen(stagesWithDates, dayStr) {
  return materialWindow(stagesWithDates, dayStr).open
}

module.exports = { parseDate, fmtDate, computeStageDates, daysBetween, materialWindow, materialWindowOpen, shortRange, fullRange }
