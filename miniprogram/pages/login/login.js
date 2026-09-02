const { DB } = require('../../data/db')
const icons = require('../../utils/icons')

/* ───────────────────────────────────────────────────────────────────────
 * 本页依赖的 DB 字段（外部系统适配 / 内容映射锚点）
 * 权威真相见仓库根 db_structure.md；服务端 PG 字段经 data/map.js 翻译。
 * 登录页只写会话态，不直接渲染业务表；归属地选择 / 角色来自以下表：
 * ── 取数表 → 字段 ──────────────────────────────────────────────────────
 * organizations  : slug, name, town, type, org_note（org_note 用于推断主管单位；slug 即 g.orgId）
 * accounts       : acc_phone, acc_name, acc_status, acc_password_hint（明文比对密码；acc_phone=手机号身份）
 * account_roles  : ar_org_id, ar_acc_id, ar_role_key, ar_status（该账号可用角色，驱动 roleList）
 * roles          : role_key, role_name（角色键→中文名映射，驱动 roleList 展示）
 * ─────────────────────────────────────────────────────────────────────── */

Page({
  data: {
    icons: icons.dai,
    // 平台名/主管单位：数据驱动，从 organizations 平台根组织（slug='boss'）读取，避免写死
    platformName: '城厢区换届选举平台',
    platformDept: '城厢区民政局',
    // 演示预填充：用户名=手机号，密码意思一下（明天演示直接撑场，可一键登录）
    phone: '13800000002',
    password: '123456',
    // 当前选中的角色 ar_role_key（由 account_roles 动态给出，不再是写死枚举）
    role: '',
    roleList: [],        // 该账号+归属地下的可用角色 [{ key, name }]
    isGuest: false,       // 当前是否以游客身份兜底（未注册 / 无可用角色）
    isUnregistered: false, // 手机号在 accounts 中无记录（完全未注册）
    orgIndex: -1,        // -1 = 未选择；归属地强制必选
    orgs: [],
    orgNames: [],
    orgLocked: false,     // 归属地锁定：本机已注册绑定的账号，归属地不可再改（注册后终身锁定）
    error: '',
    loading: false
  },

  onLoad() {
    const app = getApp()
    // 平台品牌名与主管单位：取自 organizations 平台根组织（slug='boss'），数据驱动不写死
    const boss = DB.organizations.find(o => o.slug === 'boss')
    if (boss) {
      const patch = { platformName: boss.name || this.data.platformName }
      // 主管单位：组织备注/类型推断；平台根组织无独立 dept 字段时回落 db 既有成熟期值
      const dept = (boss.org_note && /局|委|部/.test(boss.org_note)) ? boss.org_note : this.data.platformDept
      patch.platformDept = dept
      this.setData(patch)
    }
    // ⇠ 后端[organizations] app.demoOrgs() 返回「村(居)委会且存在进行中届次」的组织列表；
    //   页面消费 org.slug(归属地标识) 与 org.name(显示)。
    //   （内部按 organizations.type ∈ {community_committee, village_committee} 过滤，organizations.type 亦被使用）
    const orgs = app.demoOrgs()
    this.setData({ orgs, orgNames: orgs.map(o => o.name) })

    // ⇠ 后端 GET /api/orgs（免登录）：服务端可达时归属地=全部 122 村/社区（不含平台入口），
    //   注册的用户可任选自己的归属地；离线回落本地演示组织列表。
    require('../../utils/api').get('/api/orgs', { timeout: 4000 }).then((rows) => {
      const list = (rows || []).filter(o => o.type === 'village_committee' || o.type === 'community_committee')
      if (!list.length) return
      this.setData({
        orgs: list,
        orgNames: list.map(o => (o.town ? (o.town + ' · ' + o.name) : o.name))
      })
      this._applyOrgLock()   // 服务端组织列表到位后重挂锁（锁定索引与列表相关）
    }).catch(() => { /* 离线：保持本地演示组织列表 */ })

    // 归属地锁定（服务端口径）：本机已有注册绑定的账号 → 预填手机号并锁死归属地。
    // 服务端同时强制校验（错归属地登录 401 / 换归属地注册 409），此处只是界面提示层。
    this._binding = wx.getStorageSync('electionLoginBinding') || null
    if (this._binding && this._binding.accountPhone) {
      const isLocalAccount = DB.accounts.some(a => a.acc_phone === this._binding.accountPhone)
      this.setData({
        phone: this._binding.accountPhone,
        password: isLocalAccount ? this.data.password : ''  // 免密注册账号：密码留空直登
      })
      this._applyOrgLock()
      this._refreshRoles()
    }
  },

  /* 把归属地选择器锁到绑定归属地：手机号 = 本机绑定手机号时锁定，否则放开（换号即换人） */
  _applyOrgLock() {
    const b = this._binding
    if (!b || !b.accountPhone || b.accountPhone !== this.data.phone) {
      this.setData({ orgLocked: false })
      return
    }
    const idx = this.data.orgs.findIndex(o => o.slug === b.orgId)
    if (idx >= 0) this.setData({ orgLocked: true, orgIndex: idx })
  },

  // 依据「手机号 + 所选归属地」反查 account_roles，并用 roles 字典映射中文名渲染芯片；
  // 未注册账号或账号无可用角色 → 一律兜底为「游客」身份
  _refreshRoles() {
    const { phone, orgs, orgIndex } = this.data
    if (orgIndex < 0 || !phone) {
      this.setData({ roleList: [], role: '', isGuest: false, isUnregistered: false })
      return
    }
    const org = orgs[orgIndex]
    // ⇠ 后端[accounts.acc_phone] 判断是否已在系统注册
    const acc = DB.accounts.find(a => a.acc_phone === phone)
    const isUnregistered = !acc
    // ⇠ 后端[account_roles] 按 ar_acc_id(手机号) + ar_org_id(归属地) + ar_status=active
    //   取该账号在本组织拥有的全部角色 key
    const keys = DB.account_roles
      .filter(r => r.ar_acc_id === phone && r.ar_org_id === org.slug && r.ar_status === 'active')
      .map(r => r.ar_role_key)
    // ⇠ 后端[roles] 字典：role_key → role_name（中文显示名）
    const roleMap = {}
    DB.roles.forEach(r => { roleMap[r.role_key] = r.role_name })
    if (keys.length) {
      // 已注册且有角色：动态渲染真实角色芯片
      const roleList = keys.map(k => ({ key: k, name: roleMap[k] || k }))
      this.setData({ roleList, role: roleList[0].key, isGuest: false, isUnregistered })
    } else {
      // 未注册 / 无可用角色：兜底为游客（role='guest' 仅作标记，login 时映射为 voters 只读）
      this.setData({ roleList: [], role: 'guest', isGuest: true, isUnregistered })
    }
  },

  onPhone(e) {
    this.setData({ phone: e.detail.value, error: '' })
    this._applyOrgLock()   // 换手机号 = 换人：绑定手机号才锁归属地
    this._refreshRoles()
  },
  onPassword(e) { this.setData({ password: e.detail.value, error: '' }) },
  onRole(e) { this.setData({ role: e.currentTarget.dataset.r, error: '' }) },
  onOrgChange(e) {
    if (this.data.orgLocked) return   // 归属地已锁定（注册后不可更改）
    const v = e && e.detail && e.detail.value
    if (v !== undefined) {
      this.setData({ orgIndex: Number(v), error: '' })
      this._refreshRoles()
    }
  },

  /* wx.login 取 code（尽力而为：失败传空，服务端如实跳过绑定） */
  _getWxCode() {
    return new Promise((resolve) => {
      wx.login({
        success: (r) => resolve((r && r.code) || ''),
        fail: () => resolve('')
      })
    })
  },

  submit() {
    if (this.data.loading) return
    const { phone, password, orgs, orgIndex } = this.data
    // 归属地强制必选：未选则拦截
    if (orgIndex < 0) return this.setData({ error: '请先选择归属地（注册后归属地不可更改）' })
    const org = orgs[orgIndex]
    // ⇠ 后端[accounts.acc_phone] 以手机号作为登录唯一标识查询账号（本地兜底显示用）
    const acc = DB.accounts.find(a => a.acc_phone === phone)
    this.setData({ loading: true, error: '' })
    // 密码留空 → 选民免密路径（POST /api/mp/login；未注册则引导免密注册）
    if (!password) return this._serverMpLogin(acc, org)
    this._serverLogin(acc, org, password)
  },

  /* 密码路径：POST /api/login（org_id + 手机号 + 密码）—— 与 PC 端登录同源同口径 */
  _serverLogin(acc, org, password) {
    const app = getApp()
    wx.showLoading({ title: '登录中…', mask: true })
    require('../../utils/api').login(org.slug, this.data.phone, password).then((result) => {
      wx.hideLoading()
      this.setData({ loading: false })
      // 本地账号对象用于界面资料；服务端才认识的新账号合成最小资料对象
      const localAcc = acc || {
        acc_phone: this.data.phone, acc_name: result.accName, acc_org_id: org.slug,
        acc_status: 'active', acc_password_hint: '', org: result.orgName,
        roles: '', acc_created_by: 'server', acc_note: '服务端账号'
      }
      app.login(localAcc, result.role, org.slug)
      // 立即同步 PC 端设置的最新数据；后端不可达不阻断进入（页面回落本地演示数据）
      app.serverLogin(result, this.data.phone).catch(() => {
        wx.showToast({ title: '后端暂不可达：暂用本地演示数据', icon: 'none', duration: 2500 })
      })
      wx.switchTab({ url: '/pages/home/home' })
    }).catch((e) => {
      wx.hideLoading()
      this.setData({ loading: false })
      // 网络不可达 → 离线回退：沿用本地演示登录（真实优先/离线回退双轨，与 PC 端一致）
      if (e.type === 'network') {
        return this._localLogin(acc, (this.data.role === 'guest') ? 'voters' : this.data.role, org, password)
      }
      // 本地无此账号 + 服务端查无此人 → 引导免密注册（拒绝则游客浏览）
      if (!acc && e.type === 'auth' && /不存在/.test(e.message || '')) {
        return this._offerRegister(org)
      }
      // 服务端明确拒绝（密码错/账号停用）：如实提示，不静默降级
      this.setData({ error: e.message || '登录失败' })
    })
  },

  /* 免密路径：POST /api/mp/login {orgId, phone}；跨归属地 401、未注册 401 均如实分流 */
  _serverMpLogin(acc, org) {
    const app = getApp()
    wx.showLoading({ title: '登录中…', mask: true })
    this._getWxCode().then((wxCode) =>
      require('../../utils/api').mpLogin(org.slug, this.data.phone, wxCode)
    ).then((result) => {
      wx.hideLoading()
      this.setData({ loading: false })
      const localAcc = acc || {
        acc_phone: this.data.phone, acc_name: result.accName, acc_org_id: org.slug,
        acc_status: 'active', acc_password_hint: '', org: result.orgName,
        roles: '', acc_created_by: 'server', acc_note: '免密注册选民'
      }
      app.login(localAcc, result.role, org.slug)
      app.serverLogin(result, this.data.phone).catch(() => {
        wx.showToast({ title: '后端暂不可达：暂用本地演示数据', icon: 'none', duration: 2500 })
      })
      wx.switchTab({ url: '/pages/home/home' })
    }).catch((e) => {
      wx.hideLoading()
      this.setData({ loading: false })
      // 网络不可达 → 离线回退（与密码路径同策略）
      if (e.type === 'network') {
        return this._localLogin(acc, (this.data.role === 'guest') ? 'voters' : this.data.role, org, '')
      }
      // 账号不存在（含跨归属地）→ 引导免密注册；拒绝则游客浏览
      if (e.type === 'auth' && /不存在/.test(e.message || '')) {
        return this._offerRegister(org)
      }
      // 已设密码账号走免密 / 停用等：如实提示
      this.setData({ error: e.message || '登录失败' })
    })
  },

  /* 免密注册引导：归属地一次选定终身锁定（服务端三铁律强制，此处是知情确认） */
  _offerRegister(org) {
    const phone = this.data.phone
    if (!/^1\d{10}$/.test(phone)) {
      return this.setData({ error: '手机号格式不正确（11 位数字）' })
    }
    wx.showModal({
      title: '选民免密注册',
      content: '手机号 ' + phone + ' 尚未注册。将以「' + org.name + '」为归属地完成免密注册（无需密码，手机号+归属地即可登录）。归属地一经注册不可更改，确认注册？',
      confirmText: '注册并登录',
      cancelText: '游客浏览',
      success: (r) => {
        if (!r.confirm) return this._guestLogin(org)   // 拒绝注册 → 游客只读路径保留
        wx.showLoading({ title: '注册中…', mask: true })
        this._getWxCode().then((wxCode) =>
          require('../../utils/api').mpRegister(org.slug, phone, wxCode)
        ).then((result) => {
          wx.hideLoading()
          wx.showToast({ title: '注册成功：归属地已锁定', icon: 'success', duration: 2000 })
          const localAcc = {
            acc_phone: phone, acc_name: result.accName, acc_org_id: org.slug,
            acc_status: 'active', acc_password_hint: '', org: result.orgName,
            roles: '', acc_created_by: 'server', acc_note: '免密注册选民'
          }
          getApp().login(localAcc, result.role, org.slug)
          getApp().serverLogin(result, phone).catch(() => {})
          wx.switchTab({ url: '/pages/home/home' })
        }).catch((e) => {
          wx.hideLoading()
          // 服务端 409（他村已注册/系统账号/已注册本村）：如实提示，绝不静默降级
          this.setData({ error: (e && e.message) || '注册失败，请稍后重试' })
        })
      }
    })
  },

  /* 离线回退：后端不可达时沿用本地演示登录路径（原逻辑保留） */
  _localLogin(acc, finalRole, org, password) {
    if (!acc) return this._guestLogin(org)
    // ⇠ 后端[accounts.acc_status] 状态校验：已注册但非 active 仍拦截（停用账号不可登录）
    if (acc.acc_status !== 'active') return this.setData({ error: '账号已停用' })
    // ⇠ 后端[accounts.acc_password_hint] 明文密码 hint 比对（演示用；生产应走服务端鉴权，禁止前端明文）
    if (password && password !== '123456' && password !== acc.acc_password_hint) return this.setData({ error: '密码错误' })
    wx.showLoading({ title: '离线登录中…', mask: true })
    setTimeout(() => {
      wx.hideLoading()
      getApp().login(acc, finalRole, org.slug)
      wx.switchTab({ url: '/pages/home/home' })
    }, 380)
  },

  /* 游客访问：本地只读公开内容（无 token，不与服务端交互） */
  _guestLogin(org) {
    wx.showLoading({ title: '游客访问中…', mask: true })
    setTimeout(() => {
      wx.hideLoading()
      // ⇠ 游客兜底账号：无 acc 记录时构造游客身份，roleKey 映射为 voters（只读）
      const guestAcc = { acc_phone: this.data.phone, acc_org_id: org.slug, acc_status: 'guest', isGuest: true }
      getApp().login(guestAcc, 'voters', org.slug)
      wx.switchTab({ url: '/pages/home/home' })
    }, 320)
  },

  // 微信一键登录：wx.login 取 code → POST /api/mp/wxlogin（openid 换 token）。
  // 服务端未配置 WX_APPID/WX_SECRET 时 501 如实提示（不静默降级、不造假绑定）；
  // 该微信未绑定时提示先用手机号登录一次完成绑定。
  quickLogin() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    wx.showLoading({ title: '授权中…', mask: true })
    wx.login({
      success: (res) => {
        if (!res.code) {
          wx.hideLoading()
          this.setData({ loading: false, error: '微信授权未取得凭证，请改用账号登录' })
          return
        }
        require('../../utils/api').wxLogin(res.code).then((result) => {
          wx.hideLoading()
          this.setData({ loading: false })
          const orgs = this.data.orgs
          const org = orgs.find(o => o.slug === result.orgId) || orgs[0] || { slug: result.orgId, name: result.orgName }
          const localAcc = {
            acc_phone: result.phone || '', acc_name: result.accName, acc_org_id: result.orgId,
            acc_status: 'active', acc_password_hint: '', org: result.orgName,
            roles: '', acc_created_by: 'server', acc_note: '微信一键登录'
          }
          getApp().login(localAcc, result.role, org.slug)
          getApp().serverLogin(result, result.phone || '').catch(() => {})
          wx.switchTab({ url: '/pages/home/home' })
        }).catch((e) => {
          wx.hideLoading()
          this.setData({ loading: false })
          this.setData({ error: (e && e.message) || '微信一键登录失败，请改用账号登录' })
        })
      },
      fail: () => {
        wx.hideLoading()
        this.setData({ loading: false, error: '微信授权暂不可用，请改用账号登录' })
      }
    })
  }
})
