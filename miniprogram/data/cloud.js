// data/cloud.js
// 微信云开发数据源：小程序端直连云数据库，分页拉取全量集合，原位覆盖 DB（applyCfg/enabled/read 接口）。
// 设计原则：
//   1) 未开通 / 未初始化时整体停用，调用方回退本地 db.js，保证小程序零风险可跑
//   2) 集合名 = db.js 表名（organizations / elections / ...），云数据库权限需在控制台设为「所有用户可读」
//      （自定义安全规则 {"read": true, "write": false}），否则客户端读不到数据
//   3) 拉取结果剔除云数据库自动生成的 _id，保持与本地 db.js 结构完全一致（单一真相）
const COLLECTIONS = [
  // 新认知：无选民（voters 表已废弃，参选人一律走 candidates）
  'organizations', 'elections', 'election_stages', 'stage_templates', 'announcement_templates',
  'roles', 'role_quotas', 'accounts', 'account_roles', 'positions', 'proposals',   'materials', 'candidates', 'announcements', 'notifications', 'notification_reads',
  'election_results', 'roster', 'archives', 'design_notes', 'project_memory'
]
const PAGE_SIZE = 20   // 小程序端单次 get 上限 20 条
const CONCURRENCY = 6  // 集合级并发上限，避免瞬时请求过多

let CFG = { envId: '' }
let inited = false

// envId 留空 = 使用云开发默认环境；多环境时填环境 ID（云开发控制台 → 设置 → 环境 ID）
function applyCfg(envId) { CFG = { envId: envId || '' } }

// 云开发是否可用：基础库 >= 2.2.3（本项目 3.17.1 满足）
function available() { return typeof wx !== 'undefined' && !!wx.cloud }

// wx.cloud.init 只能调用一次，幂等保护
function init() {
  if (inited || !available()) return false
  wx.cloud.init(CFG.envId ? { env: CFG.envId, traceUser: true } : { traceUser: true })
  inited = true
  return true
}

function enabled() { return init() }

// 拉取单个集合：分页取全量，剔除 _id
async function fetchCollection(name) {
  const db = wx.cloud.database()
  const col = db.collection(name)
  const { total } = await col.count()
  if (!total) return []
  const pages = Math.ceil(total / PAGE_SIZE)
  const tasks = []
  for (let i = 0; i < pages; i++) {
    tasks.push(col.skip(i * PAGE_SIZE).limit(PAGE_SIZE).get().then(res => res.data))
  }
  const rows = (await Promise.all(tasks)).flat()
  return rows.map(r => {
    const { _id, ...rest } = r
    return rest
  })
}

// 并发受限地拉取全部集合 → { 表名: [...] }，结构与 db.js 的 DB 一致
async function read() {
  if (!enabled()) throw new Error('云开发未开通或未初始化')
  const result = {}
  for (let cursor = 0; cursor < COLLECTIONS.length; cursor += CONCURRENCY) {
    const batch = COLLECTIONS.slice(cursor, cursor + CONCURRENCY)
    const entries = await Promise.all(batch.map(async name => [name, await fetchCollection(name)]))
    entries.forEach(([name, rows]) => { result[name] = rows })
  }
  return result
}

// 小程序端只读；写库请走 cloudfunctions/initDB（云函数管理员权限）或云开发控制台
async function write() { throw new Error('小程序端禁止写库，请使用 initDB 云函数或云开发控制台') }

/* ── 字段口径诊断 + 同构归一 ──
 * 云库约定字段应与 db.js 同构（蛇形前缀 el_/es_/cand_…）。但若云库存的是 PG 口径
 * （org_id/election_id 等无前缀字段），直接 Object.assign 覆盖会让页面按 el_org_id 取到 undefined。
 * 这里检测首行：若命中 PG 风格字段而无对应前缀字段，则回落 map.* 同构归一（与 HTTP 通道同一真相源），
 * 否则原样覆盖。任何口径偏差都在开发期 console.warn，便于发现「不同源」。 */
const map = require('./map')
const PG_STYLE_DETECT = ['org_id', 'election_id', 'stage_key', 'cand_phone', 'mat_type']
const NORMALIZERS = {
  organizations: map.mapOrgs,
  elections: map.mapElections,
  // 云库若存 PG 原列名（stage_key/stage_start_date/...）则走 API 同构：
  // mapStages(rows, dDay, orgId, elId)；云库无 D 日时传 ''，偏移按 0 处理（页面仍显示阶段名）
  election_stages: (rows, orgId) => map.mapStages(rows, '', orgId, ''),
  announcements: map.mapAnnouncements,
  positions: map.mapPositions,
  candidates: map.mapCandidates,
  materials: (rows, orgId) => map.mapMaterials(rows, { orgId }),
  roster: (rows, orgId) => map.mapRoster(rows, orgId),
  election_results: (rows, orgId) => map.mapResults(rows, orgId),
}
function looksPgStyle(sample) {
  if (!sample || typeof sample !== 'object') return false
  return PG_STYLE_DETECT.some((k) => k in sample)
}
function normalizeRemote(remote, orgId) {
  const out = {}
  for (const name of Object.keys(remote)) {
    const rows = remote[name]
    const sample = Array.isArray(rows) && rows[0] ? rows[0] : null
    if (sample && looksPgStyle(sample) && NORMALIZERS[name]) {
      if (typeof wx !== 'undefined') {
        console.warn('[cloud] 集合', name, '检测到 PG 口径字段，已走 map 同构归一（避免不同源）')
      }
      try { out[name] = NORMALIZERS[name](rows, orgId) }
      catch (e) { out[name] = rows } // 归一失败不丢数据，原样回退
    } else {
      out[name] = rows
    }
  }
  return out
}

module.exports = { applyCfg, enabled, read, write, normalizeRemote, COLLECTIONS }
