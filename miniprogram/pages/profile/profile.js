const { ctx, sourceLabel, statusType, materialStatus } = require('../../utils/kit')
const { DB, SNAPSHOT_DATE } = require('../../data/db')
const icons = require('../../utils/icons')

/* ───────────────────────────────────────────────────────────────────────
 * 本页依赖的 DB 字段（外部系统适配 / 内容映射锚点）
 * 权威真相见仓库根 db_structure.md；服务端 PG 字段经 data/map.js 翻译。
 * 全局上下文：g.account.acc_phone / acc_name；未读红点 = notifications(sent) − notification_reads(已读)
 * ── 取数表 → 字段 ──────────────────────────────────────────────────────
 * accounts            : acc_phone, acc_name
 * candidates          : cand_acc_id, cand_election_id, cand_name, cand_position_id,
 *                       cand_source, cand_status
 * materials           : mat_applicant_id, mat_status, mat_type, mat_position_id, mat_submit_time
 * notifications       : notif_id, notif_status
 * notification_reads  : nr_acc_id, nr_notif_id
 * ─────────────────────────────────────────────────────────────────────── */

const ROLE_LABELS = {
  platform_admin: '平台超管', sub_admin: '子管理', operator: '经办/书记',
  editor: '运营编辑', reviewer: '审核', voters: '选民',
  candidate: '参选人'   // 服务端对 NO.* 账号的角色解析（与 PC 端同口径）
}

const UPLOAD_KEY = 'myUploads'              // 本机快速上传缓存（演示环境）
const UPLOAD_TTL = 7 * 24 * 3600 * 1000     // 7 日自动清除（平台不保留用户信息）

/** 字节数 → 可读大小 */
function fmtSize(n) {
  return n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'
}
/** 时间戳 → MM-DD HH:mm */
function fmtTime(ts) {
  const d = new Date(ts)
  const p = n => (n < 10 ? '0' + n : '' + n)
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

Page({
  data: {
    icons: icons.dai,
    account: null,
    avatarChar: '游',
    roleLabel: '',
    orgName: '',
    info: [],           // 头部信息网格 [{ icon, label, value }]
    myCand: null,       // 我的参选档案（精简）
    unreadCount: 0,
    materialList: [],   // 我的提交材料（最近 3 条摘要）
    materialTotal: 0,
    uploads: []         // 本机快速上传（7 日 TTL）
  },

  onShow() { this.refresh() },

  refresh() {
    const { app, g, s } = ctx()
    if (!g.account || !g.orgId || !g.electionId) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const org = app.org()
    const acc = g.account
    const phone = acc.acc_phone

    // 本机「注册 / 最后登录」时间（app.login 时写入；游客/首次登录回退快照日）
    const profile = wx.getStorageSync('electionProfile') || {}
    const registeredAt = (profile.phone === phone && profile.registeredAt) ? profile.registeredAt : SNAPSHOT_DATE
    const lastLoginAt = (profile.phone === phone && profile.lastLoginAt) ? profile.lastLoginAt : '—'

    // 参选档案（精简：仅姓名 / 岗位 / 来源 / 状态，去掉冗长时间线）
    let myCand = null
    const c = DB.candidates.find(x => x.cand_acc_id === phone && x.cand_election_id === g.electionId)
    if (c) {
      myCand = {
        name: c.cand_name, position: c.cand_position_id,
        source: sourceLabel(c.cand_source),
        status: c.cand_status, statusCls: statusType(c.cand_status)
      }
    }

    // 未读公告（口径与后端 notification_reads 一致）
    const sent = s.notifications.filter(n => n.notif_status === 'sent')
    const readIds = DB.notification_reads.filter(r => r.nr_acc_id === phone).map(r => r.nr_notif_id)
    const unreadCount = sent.filter(n => !readIds.includes(n.notif_id)).length

    // 我的提交材料（最近 3 条摘要，完整记录在 material 页，不做第二套渲染）
    const mine = s.materials.filter(m => m.mat_applicant_id === phone)
    const materialList = mine.slice(0, 3).map(m => {
      const st = materialStatus(m.mat_status)
      return {
        name: m.mat_position_id ? (m.mat_type + ' · ' + m.mat_position_id + '岗') : (m.mat_type || '参选材料'),
        date: (m.mat_submit_time || '').slice(0, 10),
        status: st.text,
        cls: st.cls
      }
    })

    this.setData({
      account: acc,
      avatarChar: acc.acc_name ? acc.acc_name[0] : '游',
      roleLabel: ROLE_LABELS[g.roleKey] || g.roleKey || '游客',
      orgName: org ? org.name : '',
      info: [
        { icon: icons.dai.user, label: '手机号', value: acc.acc_phone },
        { icon: icons.dai.pin, label: '归属地', value: org ? org.name : '—' },
        { icon: icons.dai.calendar, label: '注册时间', value: registeredAt },
        { icon: icons.dai.refresh, label: '最后登录', value: lastLoginAt }
      ],
      myCand, unreadCount, materialList, materialTotal: mine.length
    })
    this._loadUploads()
  },

  /* ============ 本机快速上传（7 日自动清除，不保留用户信息） ============ */
  _loadUploads() {
    const raw = wx.getStorageSync(UPLOAD_KEY) || []
    const keep = raw.filter(u => u && Date.now() - u.time < UPLOAD_TTL)
    if (keep.length !== raw.length) wx.setStorageSync(UPLOAD_KEY, keep) // 顺手清理过期项
    this.setData({ uploads: keep.map(u => Object.assign({}, u, { sizeText: fmtSize(u.size), timeText: fmtTime(u.time) })) })
  },
  addUpload() {
    wx.chooseMessageFile({
      count: 9, type: 'all',
      success: (res) => {
        const now = Date.now()
        const add = (res.tempFiles || []).map(f => ({ name: f.name || '资料', size: f.size || 0, time: now }))
        if (!add.length) return
        const list = (wx.getStorageSync(UPLOAD_KEY) || []).filter(u => now - u.time < UPLOAD_TTL).concat(add)
        wx.setStorageSync(UPLOAD_KEY, list)
        this._loadUploads()
        wx.showToast({ title: '已上传，7 日后自动清除', icon: 'none' })
      },
      fail: () => wx.showToast({ title: '选择文件失败，请重试', icon: 'none' })
    })
  },
  removeUpload(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const list = this.data.uploads.slice()
    list.splice(idx, 1)
    wx.setStorageSync(UPLOAD_KEY, list)
    this._loadUploads()
  },

  /* ============ 跳转 ============ */
  goCandidate() { wx.switchTab({ url: '/pages/candidate/candidate' }) },
  goNotice() { wx.switchTab({ url: '/pages/notice/notice' }) },
  goMaterial() { wx.navigateTo({ url: '/pages/material/material' }) }
})
