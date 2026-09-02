// data/source.js
// 数据源抽象层：本地 db.js 兜底，远程按微信云开发异步覆盖，绝不阻塞启动。
// （已移除 jsonbin 第三方托管通道：外链数据面不可控，改为「云开发 → 本地」两层）
// 关键：保持 db.js 导出的 DB 对象引用不变（Object.assign 顶层表），所有页面 require('../../data/db').DB 同步可见，零改动生效。
const db = require('./db')
const cloud = require('./cloud')
const CACHE_KEY = 'electionRemoteCache'
const LEGACY_CACHE_KEY = 'electionJsonbinCache' // 兼容旧缓存键，避免升级后首启白屏

// 云开发：默认启用（开通后自动生效）；envId 留空=默认环境，多环境在此填写（云开发控制台 → 设置 → 环境 ID）
cloud.applyCfg('')

function getDB() { return db.DB }
function getSnapshotDate() { return db.SNAPSHOT_DATE }
function currentOrgId() {
  const g = (typeof getApp === 'function' && getApp() && getApp().globalData) || {}
  if (g.orgId) return g.orgId
  const auth = (typeof wx !== 'undefined' && wx.getStorageSync('mpAuth')) || null
  return (auth && auth.orgId) || ''
}

// 异步拉取远程数据并原位覆盖 DB；后端不可达保持本地。
// 启动先读上次成功缓存（秒开），随后后台刷远端，页面 onShow 时自然读到最新数据。
// 远端优先级：配套后端 HTTP（token 在位时）> 微信云开发 > 本地 db.js。
async function refreshRemote() {
  // 1) 本地缓存秒开：上次成功同步的远程快照直接生效（新 key 优先，兼容旧 key）
  let cache = wx.getStorageSync(CACHE_KEY)
  if (!cache || typeof cache !== 'object') cache = wx.getStorageSync(LEGACY_CACHE_KEY)
  if (cache && typeof cache === 'object') Object.assign(db.DB, cache)

  // 1.5) 配套后端 HTTP（数据一致性主通道）：已登录（token 在位）即拉 PC 端设置的最新数据
  const api = require('../utils/api')
  if (api.getToken()) {
    try {
      await require('./http').syncAll()
      return true
    } catch (e) { /* 后端不可达 / token 过期（api 层已清）→ 回落云开发或本地 */ }
  }

  // 2) 云开发（官方云数据库，零第三方依赖）
  if (cloud.enabled()) {
    try {
      const remote = await cloud.read()
      if (remote && typeof remote === 'object') {
        const orgId = currentOrgId()
        const normalized = cloud.normalizeRemote(remote, orgId)
        Object.assign(db.DB, normalized)
        wx.setStorageSync(CACHE_KEY, normalized)
        return true
      }
    } catch (e) { /* 云不可用 → 保持本地 */ }
  }
  return false
}

module.exports = { getDB, getSnapshotDate, refreshRemote, cloud }
