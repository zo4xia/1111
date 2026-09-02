const { ctx, materialStatus, MATERIAL_TYPES } = require('../../utils/kit')
const { computeStageDates, materialWindow } = require('../../utils/dates')
const icons = require('../../utils/icons')

/* ───────────────────────────────────────────────────────────────────────
 * 本页依赖的 DB 字段（外部系统适配 / 内容映射锚点）
 * 权威真相见仓库根 db_structure.md；服务端 PG 字段经 data/map.js 翻译。
 * 全局上下文：g.account.acc_phone / acc_name；窗口判定走 utils/dates.materialWindow()
 * ── 取数表 → 字段 ──────────────────────────────────────────────────────
 * elections  : el_election_date（算材料上报窗口）
 * materials  : mat_applicant_id, mat_status, mat_type,
 *              mat_submit_time, mat_review_comment, mat_attachments[{name,url}]
 * accounts   : acc_phone, acc_name（提交人归属）
 * ─────────────────────────────────────────────────────────────────────── */

// 离线演示提交暂存键：本地记录必须落盘，否则 onShow → refresh() 重建 records 会把刚提交的记录冲掉
const DRAFT_KEY = 'localMaterialDrafts'

// D-015 材料模板（文件在后端 uploads/material_templates，由 /api/files 静态服务）
// 有空白表的清单给「下载空白表」；身份证/简历/无犯罪证明等需本人自备
const TPL_FILE = {
  '个人自荐表': '自荐表-可填写版.xlsx',
  '组织推荐函': '提名表-可填写版.xlsx'
}
const EXTRA_TPL = [
  { name: '自荐表填写样例（参考）', file: '自荐表-参考样例.jpg' },
  { name: '委托书（委托他人代交时用）', file: '委托书-可填写版.docx' },
  { name: '候选人资格审查表', file: '资格审查表.xlsx' },
  { name: '主任候选人资格审查表', file: '主任候选人资格审查表.xlsx' }
]

Page({
  data: {
    icons: icons.dai,
    realWindowOpen: false,
    canSubmit: false,
    windowMsg: '',
    windowState: 'none',   // before / open / after / none
    windowRange: '',       // 「07-15 ~ 07-17」形式的窗口区间
    windowHint: '',
    submitBtnText: '提交材料',
    // 需提交材料清单（说明卡直接复用 kit 单一真相，不另写一套文字）
    needList: MATERIAL_TYPES,
    needCards: [],       // D-015：清单 + 每项是否有空白模板可下载
    extraTpl: EXTRA_TPL, // 其他可下载表格（样例/委托书/资格审查表）
    positionList: [],    // 本届岗位按钮（pos_type），兜底 主任/副主任/委员
    positionId: '',      // 当前选中岗位（提交时带给后端，不再硬编码「委员」）
    imgFiles: [],   // img-picker：拍照/相册图片
    docFiles: [],   // 文件附件（PDF/Word 等）
    noteText: '',   // 文字说明输入
    records: [],
    submitting: false
  },

  onLoad() {
    // 清单卡：逐项标注是否有可下载空白模板
    const needCards = MATERIAL_TYPES.map(n => ({ name: n, tpl: TPL_FILE[n] || '' }))
    this.setData({ needCards })
  },
  onShow() { this.refresh() },

  refresh() {
    const { app, g, s } = ctx()
    if (!g.account || !g.orgId || !g.electionId) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const el = app.election()
    const stages = computeStageDates(el.el_election_date, s.stages)
    // 窗口开关 = 日程引擎自动判断（D-15 ~ D-13），无人工开关；同时取回区间用于如实告知
    const win = materialWindow(stages, g.snapshotDate)
    const phone = g.account ? g.account.acc_phone : ''
    const mine = s.materials.filter(m => m.mat_applicant_id === phone)
    // 提交记录：只展示「谁交的 / 交了什么概览 / 状态」，不再绑定公告号与渠道维度
    const records = mine.map(m => {
      const st = materialStatus(m.mat_status)
      return {
        _id: 'db_' + (m.mat_applicant_id || '') + '_' + (m.mat_submit_time || ''),
        name: m.mat_type || '参选材料',
        date: (m.mat_submit_time || '').slice(0, 10),
        status: st.text,
        cls: st.cls,
        note: m.mat_review_comment || '',
        files: (m.mat_attachments && m.mat_attachments.length)
          ? ('附件 ' + m.mat_attachments.length + ' 份')
          : (m.files || '')
      }
    })
    // 本地演示提交：与服务端记录合并展示（服务端在前，本地草稿在后）
    const drafts = this.loadDrafts(phone, g.electionId)
    const all = records.concat(drafts)

    const range = win.start ? (win.start.slice(5) + ' ~ ' + win.end.slice(5)) : '待公布'
    const btnText = { open: '提交材料', before: '尚未到提交时间', after: '窗口已截止', none: '提交材料' }
    // D-015 本届岗位按钮：以 positions 表为准，空库兜底常见三岗；当前选中失效则回落到第一个
    const posRows = (s.positions || []).filter(p => p.pos_election_id === g.electionId)
    let positionList = posRows.map(p => p.pos_type).filter(Boolean)
    if (!positionList.length) positionList = ['主任', '副主任', '委员']
    let positionId = this.data.positionId
    if (!positionId || positionList.indexOf(positionId) < 0) positionId = positionList[0]
    this.setData({
      realWindowOpen: win.open, canSubmit: win.open, records: all,
      windowState: win.state, windowRange: range,
      submitBtnText: btnText[win.state] || '提交材料',
      windowMsg: this.windowText(win, range),
      windowHint: this.windowHint(win, range),
      positionList, positionId
    })
  },

  /** D-015 选择要参选的岗位（主任/副主任/委员…），提交记录挂到该岗位 */
  onPickPosition(e) {
    this.setData({ positionId: e.currentTarget.dataset.pos })
  },

  /** 下载空白材料模板：wx.downloadFile → wx.openDocument 预览；失败兜底复制链接 */
  downloadTpl(e) {
    const file = e.currentTarget.dataset.file
    if (!file) { wx.showToast({ title: '该项需本人自备，无空白模板', icon: 'none' }); return }
    const api = require('../../utils/api')
    const url = api.BASE_URL + '/api/files/material_templates/' + encodeURIComponent(file)
    wx.showLoading({ title: '下载中…', mask: true })
    wx.downloadFile({
      url,
      success(res) {
        wx.hideLoading()
        if (res.statusCode !== 200) { wx.showToast({ title: '模板下载失败', icon: 'none' }); return }
        wx.openDocument({
          filePath: res.tempFilePath, showMenu: true,
          fail() {
            wx.setClipboardData({ data: url })
            wx.showToast({ title: '无法预览，已复制链接', icon: 'none' })
          }
        })
      },
      fail() {
        wx.hideLoading()
        wx.setClipboardData({ data: url })
        wx.showToast({ title: '下载失败，已复制链接', icon: 'none' })
      }
    })
  },

  /* 窗口文案：把「为什么不能交 / 什么时候能交 / 现在能做什么」说清楚，
     替代原来只有一句「逾期无法提交」的死胡同提示 */
  windowText(win, range) {
    if (win.state === 'open') return '本次提交时间：' + range + '（含首尾日），还剩 ' + win.days + ' 天截止'
    if (win.state === 'before') return '材料上报窗口 ' + range + '，距开放还有 ' + win.days + ' 天，可先备好材料'
    if (win.state === 'after') return '材料上报窗口 ' + range + ' 已于 ' + win.days + ' 天前截止；材料仍可先上传备好，正式受理需到村委会现场办理，日期可在「公告」页查看'
    return '提交时间按日程自动开关；日期可在「公告」页查看'
  },

  /** 提交按钮下方提示（与窗口态一一对应，避免「未开放」却提示「请到现场办理」） */
  windowHint(win, range) {
    if (win.state === 'open') return '审核结果可在下方「我的提交记录」查看；请确保图片文字清晰'
    if (win.state === 'before') return '上报窗口 ' + range + '，距开放还有 ' + win.days + ' 天；材料可先备好，开放后再来提交'
    if (win.state === 'after') return '上报窗口 ' + range + ' 已截止 ' + win.days + ' 天；材料可先备好，正式受理请到村委会现场办理'
    return '本届日程尚未公布，暂不能提交'
  },

  loadDrafts(phone, electionId) {
    let list = []
    try { list = wx.getStorageSync(DRAFT_KEY) || [] } catch (e) { list = [] }
    if (!Array.isArray(list)) list = []
    return list.filter(d => d.phone === phone && d.electionId === electionId)
  },

  saveDraft(rec) {
    let list = []
    try { list = wx.getStorageSync(DRAFT_KEY) || [] } catch (e) { list = [] }
    if (!Array.isArray(list)) list = []
    list.unshift(rec)
    // 只保留最近 50 条，避免本地草稿无上限膨胀
    try { wx.setStorageSync(DRAFT_KEY, list.slice(0, 50)) } catch (e) { /* 存储配额不足不阻断提交 */ }
  },

  onNoteInput(e) { this.setData({ noteText: e.detail.value }) },

  /* ============ img-picker：拍照 / 相册图片（可自增多个） ============ */
  // 保留组件下发的 _id（列表 wx:key 依赖它），不要重建对象
  onImgAdd(e) {
    const add = (e.detail.files || []).map(f => Object.assign({}, f))
    this.setData({ imgFiles: this.data.imgFiles.concat(add).slice(0, 9) })
  },
  onImgRemove(e) {
    const idx = e.detail.index
    const imgFiles = this.data.imgFiles.slice()
    imgFiles.splice(idx, 1)
    this.setData({ imgFiles })
  },
  onUploadFail(e) { wx.showToast({ title: (e.detail && e.detail.errMsg) || '选择图片失败，请重试', icon: 'none' }) },

  /* ============ 文件附件：自增多个（PDF / Word 等） ============ */
  // 备料（拍照/选文件）是纯本地行为，与上报窗口无关：窗口外也必须能操作，
  // 否则用户拿到的就是一个「什么都点不动」的死页面。
  addDocFile() {
    const that = this
    wx.chooseMessageFile({
      count: 9, type: 'file',
      success(res) {
        // path 必存：在线提交时 wx.uploadFile 逐个真实上传到服务端
        const add = res.tempFiles.map(f => ({ name: f.name, size: Math.max(1, Math.round(f.size / 1024)) + 'KB', path: f.path }))
        that.setData({ docFiles: that.data.docFiles.concat(add).slice(0, 9) })
      }
    })
  },
  removeDocFile(e) {
    const idx = e.currentTarget.dataset.idx
    const docFiles = this.data.docFiles.slice()
    docFiles.splice(idx, 1)
    this.setData({ docFiles })
  },

  submit() {
    // 连点保护：提交是写操作，未加锁会重复落库 / 重复上传
    if (this.data.submitting) return
    if (!this.data.canSubmit) {
      const tip = { before: '尚未到提交时间，可先备好材料', after: '窗口已截止，请到村委会现场办理', none: '本届日程尚未公布，暂不能提交' }
      wx.showToast({ title: tip[this.data.windowState] || '当前不可提交', icon: 'none' })
      return
    }
    const { imgFiles, docFiles, noteText } = this.data
    if (!imgFiles.length && !docFiles.length) { wx.showToast({ title: '请先拍照或添加文件附件', icon: 'none' }); return }
    this.setData({ submitting: true })
    const g = getApp().globalData

    // 在线模式：选民端真实写库（POST /api/mp/materials，JWT 带 orgId/phone/name）
    // → wx.uploadFile 逐个真实上传附件 → PC 管理端材料列表立即可见、可预览
    // ⚠️ 不要调 /api/materials（那是 staff 内推端点，requireStaff 选民必 403）
    if (g.serverMode) {
      const api = require('../../utils/api')
      const http = require('../../data/http')
      const that = this
      wx.showLoading({ title: '提交中…', mask: true })
      api.post('/api/mp/materials', {
        positionId: this.data.positionId || '委员',   // D-015 取顶部选中的参选岗位
        note: noteText
        // 附件走 /api/materials/:id/upload 真实上传（multipart），选民可用（auth 无 requireStaff）
      }).then((created) => {
        const matId = created && created.id
        // 真实附件上传：图片（img-picker 临时路径）+ 文件（chooseMessageFile 临时路径）逐个传
        const uploads = imgFiles.map(f => ({ path: f.url, displayName: f.name || '材料图片' }))
          .concat(docFiles.map(f => ({ path: f.path, displayName: f.name || '附件' })))
        let okCount = 0
        const uploadNext = (i) => {
          if (i >= uploads.length) return Promise.resolve()
          wx.showLoading({ title: '上传附件 ' + (i + 1) + '/' + uploads.length + '…', mask: true })
          return api.uploadFile('/api/materials/' + matId + '/upload', uploads[i].path, { displayName: uploads[i].displayName })
            .then(() => { okCount++; return uploadNext(i + 1) })
            .catch(() => { return uploadNext(i + 1) })   // 单个失败不阻断其余；结束统一如实汇总
        }
        return uploadNext(0).then(() => {
          wx.hideLoading()
          if (okCount === uploads.length) {
            wx.showToast({ title: '提交成功，等待收审', icon: 'success' })
          } else if (okCount === 0) {
            wx.showToast({ title: '材料已提交，但附件全部上传失败（可稍后在记录中补传）', icon: 'none', duration: 3000 })
          } else {
            wx.showToast({ title: '提交成功，' + okCount + '/' + uploads.length + ' 附件已上传', icon: 'none', duration: 3000 })
          }
          that.setData({ imgFiles: [], docFiles: [], noteText: '', submitting: false })
          return http.syncAll()   // 我的材料列表刷新为服务端真实状态（含附件计数）
        })
      }).catch((e) => {
        wx.hideLoading()
        that.setData({ submitting: false })
        wx.showToast({ title: (e && e.message) || '提交失败，请稍后重试', icon: 'none' })
      })
      return
    }

    /* 离线演示：本地暂存一条记录（不落库，仅撑演示链路）。
       必须落盘 —— 只写 this.data.records 的话，下一次 onShow → refresh() 会用服务端数据重建列表，
       刚提交的记录会凭空消失，用户看到的就是「提交成功但记录没了」。 */
    const st = materialStatus('pending')   // 状态文案取全站唯一语义表，不在此另造
    const rec = {
      _id: 'local_' + Date.now(),
      phone: (g.account && g.account.acc_phone) || '',
      electionId: g.electionId,
      name: '参选人材料',
      date: (g.snapshotDate || '').slice(0, 10),
      status: st.text, cls: st.cls,
      note: noteText,
      files: '图片 ' + imgFiles.length + ' 份 · 文件 ' + docFiles.length + ' 份',
      comment: '本地暂存：未连接服务端，待联网后同步'
    }
    this.saveDraft(rec)
    this.setData({ imgFiles: [], docFiles: [], noteText: '', submitting: false })
    this.refresh()   // 列表组装只有 refresh 一个入口（服务端记录 + 本地草稿），此处不另拼一份
    wx.showToast({ title: '提交成功，等待收审', icon: 'success' })
  }
})
