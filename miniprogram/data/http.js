// data/http.js — 服务端数据同步编排：登录后拉全量可见表 → map 归一 → 原位覆盖 DB
// 与 data/source.js（云开发/本地兜底）共用一套合并策略：Object.assign(db.DB, 表) 顶层引用不变，
// 全部页面 require('../../data/db').DB 零改动即可看到 PC 端设置的最新数据。
// 数据流：PC 管理端写库 → 小程序 syncAll 拉取 → 映射 → DB 覆盖 → 当前页 rerender()。
const api = require('../utils/api')
const map = require('./map')
const dbm = require('./db')
const CACHE_KEY = 'electionRemoteCache' // 与 source.js 同键：启动秒开上次同步结果

let syncing = false

/** 当前页面刷新钩子：同步完成后调用栈顶页面的 refresh()（7 个业务页都有），
 *  保证用户停在页面上也能看到刚拉下来的新数据，不必等下一次 onShow。 */
function rerender() {
  if (typeof getCurrentPages !== 'function') return
  const pages = getCurrentPages()
  const top = pages && pages[pages.length - 1]
  if (top && typeof top.refresh === 'function') {
    try { top.refresh() } catch (e) { /* 页面刷新异常不影响数据同步结果 */ }
  }
}

/** 登录归属地（优先全局会话，兜底存储的服务端会话） */
function currentOrgId() {
  const g = (typeof getApp === 'function' && getApp() && getApp().globalData) || {}
  if (g.orgId) return g.orgId
  const auth = (typeof wx !== 'undefined' && wx.getStorageSync('mpAuth')) || null
  return (auth && auth.orgId) || ''
}

/** 拉取并合并全部可见表。要求已登录（token 在位）。
 *  抛错：e.type='auth'（token 过期，已被 api 层清除）/ 'network'（后端不可达）/ 'http'。
 *  并发控制：wx.request 并发上限 10，取 6 一批分批放行，阶段表按届次逐个拉。 */
async function syncAll() {
  if (syncing) return false
  if (!api.getToken()) { const e = new Error('未登录（无 token）'); e.type = 'auth'; throw e }
  syncing = true
  try {
    const orgId = currentOrgId()
    const batch1 = await Promise.all([
      api.get('/api/orgs'), api.get('/api/elections'), api.get('/api/health'),
    ])
    const orgs = batch1[0]
    const elections = batch1[1]
    const health = batch1[2]

    const mapped = {
      organizations: map.mapOrgs(orgs),
      elections: map.mapElections(elections),
    }

    // 各届阶段逐届拉取（村级账号通常 2 届：进行中 + 历史）
    // 契约：/api/elections 返回驼峰，主键是 electionId（不是 id）；
    //       /api/elections/:id/stages 直接返回数组，需把该届 D 日(elElectionDate)一起传给 mapStages 反推偏移
    const phone = (typeof wx !== 'undefined' && wx.getStorageSync('mpAuth') || {}).phone || ''
    const stageRows = []
    for (const el of (elections || [])) {
      const rows = await api.get('/api/elections/' + encodeURIComponent(el.electionId || el.id) + '/stages')
      stageRows.push.apply(stageRows, map.mapStages(rows, el.elElectionDate, el.orgId, el.elId))
    }
    mapped.election_stages = stageRows

    const batch2 = await Promise.all([
      api.get('/api/announcements'), api.get('/api/positions'), api.get('/api/candidates'),
      api.get('/api/mp/materials/mine'), api.get('/api/notifications'),
      api.get('/api/roster'), api.get('/api/results'),
    ])
    mapped.announcements = map.mapAnnouncements(batch2[0])
    mapped.positions = map.mapPositions(batch2[1])
    mapped.candidates = map.mapCandidates(batch2[2])
    mapped.materials = map.mapMaterials(batch2[3], { orgId, phone })
    Object.assign(mapped, map.mapMyNotifications(batch2[4], orgId, phone))
    mapped.roster = map.mapRoster(batch2[5], orgId)
    mapped.election_results = map.mapResults(batch2[6], orgId)

    // 原位覆盖（单一 DB 引用，页面零改动生效）+ 落缓存（下次启动秒开）
    Object.assign(dbm.DB, mapped)
    if (typeof wx !== 'undefined') wx.setStorageSync(CACHE_KEY, mapped)

    // 在线模式「今日」= 服务端今日：倒计时 / 阶段状态 / 材料窗口与 PC 端同一时钟
    const app = typeof getApp === 'function' ? getApp() : null
    if (app && app.globalData) {
      app.globalData.serverMode = true
      if (health && health.today) app.globalData.snapshotDate = health.today
    }
    rerender()
    return true
  } finally {
    syncing = false
  }
}

module.exports = { syncAll, rerender }
