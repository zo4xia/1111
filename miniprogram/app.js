const { DB, SNAPSHOT_DATE, findOrg, findElection, orgElections, scopedOf } = require('./data/db')
const http = require('./data/http')

App({
  globalData: {
    account: null,
    roleKey: '',
    orgId: '',
    electionId: '',
    snapshotDate: SNAPSHOT_DATE,
    binding: null,
    serverMode: false   // true = 已连配套后端（数据与 PC 端实时一致）；false = 本地演示数据
  },

  onLaunch() {
    // 异步从微信云开发/配套后端拉取最新数据（失败自动回退本地 db.js），绝不阻塞启动
    require('./data/source').refreshRemote().catch(() => {})
    // 使用系统字体（仿宋/宋体），无需动态加载，避免编译错误
    // 字体栈在 app.wxss 中已配置：FangSong / STFangsong / STSong / Songti SC 等

    const binding = wx.getStorageSync('electionLoginBinding')
    if (binding && binding.accountPhone && binding.orgId) {
      let acc = DB.accounts.find(a => a.acc_phone === binding.accountPhone)
      if (!acc) {
        // 免密注册选民：本地演示库无此账号（服务端真账号），按服务端会话合成最小账号对象。
        // 归属地锁定随 binding 固定 —— 合成账号的 acc_org_id 永远 = 注册时选定的归属地。
        const auth = wx.getStorageSync('mpAuth') || {}
        if (auth.phone === binding.accountPhone && auth.orgId === binding.orgId) {
          acc = {
            acc_phone: auth.phone, acc_name: auth.accName || '选民', acc_org_id: auth.orgId,
            acc_status: 'active', org: auth.orgName || '', roles: '',
            acc_created_by: 'server', acc_note: '免密注册选民（服务端账号）'
          }
        }
      }
      if (acc && acc.acc_status === 'active' && this.resolveOrgId(acc) === binding.orgId) {
        this.login(acc, binding.roleKey || 'voters', binding.orgId)
        // 服务端会话恢复：token 与本地绑定归属地一致时，后台静默切换到在线模式
        this.restoreServerSession()
        return
      }
    }
    this.globalData.account = null
  },

  /* 服务端会话恢复：不阻塞启动；token 过期（401 已被 api 层清除）则保持本地演示模式 */
  restoreServerSession() {
    const api = require('./utils/api')
    if (!api.getToken()) return
    const auth = wx.getStorageSync('mpAuth') || {}
    if (auth.orgId && this.globalData.orgId && auth.orgId !== this.globalData.orgId) return
    http.syncAll().then(() => {
      // 登录后即补拉（token 在手但冷启动首拉可能已在 source.refreshRemote 完成）
    }).catch(() => {
      this.globalData.serverMode = false
    })
  },

  login(acc, roleKey, orgId) {
    const selectedOrgId = orgId || this.resolveOrgId(acc)
    const ar = DB.account_roles.find(r => r.ar_acc_id === acc.acc_phone && r.ar_role_key === roleKey)
    this.globalData.account = acc
    this.globalData.roleKey = ar ? ar.ar_role_key : (roleKey || 'voters')
    this.globalData.orgId = selectedOrgId
    const el = DB.elections.find(e => e.el_org_id === selectedOrgId && e.el_status === 'in_progress')
    this.globalData.electionId = el ? el.el_id : ''
    this.globalData.binding = { accountPhone: acc.acc_phone, orgId: selectedOrgId, roleKey: this.globalData.roleKey }
    wx.setStorageSync('electionLoginBinding', this.globalData.binding)
    // 本机记录「注册 / 最后登录」时间（演示环境无后端：注册时间取快照生成日，登录时间取当前时刻）
    const saved = wx.getStorageSync('electionProfile') || {}
    const d = new Date()
    const p = n => (n < 10 ? '0' + n : '' + n)
    const now = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    wx.setStorageSync('electionProfile', {
      phone: acc.acc_phone,
      registeredAt: saved.phone === acc.acc_phone ? (saved.registeredAt || SNAPSHOT_DATE) : SNAPSHOT_DATE,
      lastLoginAt: now
    })
  },

  resolveOrgId(acc) {
    return acc && acc.acc_org_id === 'boss' ? 's-jiankou' : (acc ? acc.acc_org_id : '')
  },

  logout() {
    this.globalData.account = null
    this.globalData.roleKey = ''
    this.globalData.binding = null
    this.globalData.serverMode = false
    require('./utils/api').clearToken()
    wx.removeStorageSync('mpAuth')
    wx.removeStorageSync('electionLoginBinding')
    wx.reLaunch({ url: '/pages/login/login' })
  },

  /* 服务端登录成功（POST /api/login 返回 data）：存 token + 立即拉全量数据。
   * 由 login 页在拿到服务端结果后调用；失败（网络）不阻断进入，页面回落本地演示数据。 */
  serverLogin(result, phone) {
    const api = require('./utils/api')
    api.setToken(result.token)
    wx.setStorageSync('mpAuth', {
      orgId: result.orgId, phone: phone || '', role: result.role,
      accName: result.accName, orgName: result.orgName, ts: Date.now()
    })
    this.globalData.serverMode = true
    // 服务端解析的角色优先于本地 account_roles（NO.* 账号在服务端 = 参选人，与 PC 端一致）
    if (result.role && this.globalData.account) {
      this.globalData.roleKey = result.role
      this.globalData.binding = Object.assign({}, this.globalData.binding, { roleKey: result.role })
      wx.setStorageSync('electionLoginBinding', this.globalData.binding)
    }
    return http.syncAll()
  },

  scoped() { return scopedOf(this.globalData.orgId, this.globalData.electionId) },
  org() { return findOrg(this.globalData.orgId) },
  election() { return findElection(this.globalData.electionId) },
  demoOrgs() {
    return DB.organizations.filter(o =>
      ['community_committee', 'village_committee'].includes(o.type) &&
      orgElections(o.slug).some(e => e.el_status === 'in_progress'))
  }
})
