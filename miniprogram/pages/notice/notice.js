const { ctx, MATERIAL_STAGE_KEYS } = require('../../utils/kit')
const { computeStageDates, shortRange, materialWindow } = require('../../utils/dates')
const { DB } = require('../../data/db')
const icons = require('../../utils/icons')

/* ───────────────────────────────────────────────────────────────────────
 * 本页依赖的 DB 字段（外部系统适配 / 内容映射锚点）
 * 权威真相见仓库根 db_structure.md；服务端 PG 字段经 data/map.js 翻译。
 * 全局上下文：g.orgId / g.electionId
 * ── 取数表 → 字段 ──────────────────────────────────────────────────────
 * announcements       : ann_org_id, ann_election_id, ann_code, ann_title, ann_content,
 *                       ann_publish_time, ann_stage_key, ann_status
 * election_stages     : es_election_id, es_stage_key, es_stage_name, es_note,
 *                       es_status, es_offset_start
 * election_results    : er_election_id, er_org_name, er_election_date, er_position,
 *                       er_winner_name, er_turnout, er_actual_voters, er_filing_status,
 *                       er_result_ann_code
 * （notifications / notification_reads 由 profile 页负责未读红点；本页不读，故不列）
 * ─────────────────────────────────────────────────────────────────────── */

function excerptOf(s, n) {
  n = n || 64
  if (!s) return ''
  s = String(s).replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}

Page({
  data: {
    icons: icons.dai,
    activeTab: 'latest',
    orgName: '',
    marqueeText: '',
    latest: [],
    electionOptions: [],
    electionIndex: 0,
    selectedElectionId: '',
    selectedElectionLabel: '',
    forecasts: [],
    history: [],
    detail: null,
    detailKind: '',
    readSet: []
  },

  onShow() {
    this.setData({ readSet: wx.getStorageSync('readNotices') || [] })
    this.refresh()
    // ⇠ 来自首页“某条公告”点击：home 把目标 ann_code 挂到 globalData.pendingAnnCode，
    //    此处接收并在 latest 列表中定位 idx，自动打开对应详情（而非停留在列表页）。
    this._tryOpenPending()
  },

  _tryOpenPending() {
    const app = getApp()
    const code = app.pendingAnnCode
    if (!code) return
    app.pendingAnnCode = null
    // 确保落在 latest 标签（首页公告均为已发布，归属 latest）
    if (this.data.activeTab !== 'latest') this.setData({ activeTab: 'latest', detail: null })
    const idx = (this.data.latest || []).findIndex(x => x.code === code)
    if (idx >= 0) this.openDetail({ currentTarget: { dataset: { idx } } })
  },

  refresh() {
    const { app, g, s } = ctx()
    if (!g.account || !g.orgId || !g.electionId) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const org = app.org()
    const el = app.election()
    const stages = computeStageDates(el.el_election_date, s.stages)
    const readSet = this.data.readSet || []

    // 公告页允许在同一个村居内切换当前届和历史届，默认仍落在当前正在进行的届次。
    const electionOptions = DB.elections
      .filter(x => x.el_org_id === g.orgId)
      .sort((a, b) => {
        if (a.el_id === g.electionId) return -1
        if (b.el_id === g.electionId) return 1
        return (b.el_election_date || '').localeCompare(a.el_election_date || '')
      })
      .map(x => ({
        id: x.el_id,
        term: x.el_term,
        label: (x.el_id === g.electionId ? '当前届次 · ' : '') + x.el_term + ' · ' + x.el_name,
        name: x.el_name,
        status: x.el_status,
        date: x.el_election_date
      }))
    const selectedElectionId = electionOptions.some(x => x.id === this.data.selectedElectionId)
      ? this.data.selectedElectionId
      : (electionOptions.some(x => x.id === g.electionId) ? g.electionId : (electionOptions[0] ? electionOptions[0].id : ''))
    const electionIndex = Math.max(0, electionOptions.findIndex(x => x.id === selectedElectionId))
    const selectedElection = electionOptions[electionIndex]

    const anns = DB.announcements
      .filter(a => a.ann_org_id === g.orgId && a.ann_election_id === selectedElectionId)
      .filter(a => a.ann_status === 'published' || a.ann_status === '已发布')

    // —— 公告按「事情时间线」排序：真相源 election_stages.es_offset_start 升序（D-35 → D0），
    //    同阶段内按 ann_publish_time 升序（号次顺序）；每条挂阶段名标签 es_stage_name ——
    const stageRows = DB.election_stages
      .filter(x => x.es_election_id === selectedElectionId)
      .sort((a, b) => (a.es_offset_start || 0) - (b.es_offset_start || 0))
    const stageIdx = {}
    const stageNameMap = {}
    const stageNoteMap = {}
    stageRows.forEach((s, i) => {
      stageIdx[s.es_stage_key] = i
      stageNameMap[s.es_stage_key] = s.es_stage_name
      stageNoteMap[s.es_stage_key] = s.es_note || ''
    })

    // 选中届（可能是历史届）的阶段计划日期
    const selectedStages = selectedElectionId === g.electionId
      ? stages
      : computeStageDates(selectedElection ? selectedElection.date : '', stageRows)
    /* 材料上报窗口：必须与「材料提交」页同源（都走 materialWindow）。
       不能拿「本公告所属阶段的当日」当办理期 —— D-15 阶段只有 -15 一天，
       那样第7号公告会显示「可在 07-15 内办理」，既与它自己正文写的
       「7月15日8时至7月17日18时」矛盾，也与材料页显示的 07-15~07-17 矛盾。 */
    const matWin = materialWindow(selectedStages, g.snapshotDate)
    const isCurrentTerm = selectedElectionId === g.electionId

    const latest = anns.map(a => {
      const st = selectedStages.find(x => x.es_stage_key === a.ann_stage_key)
      const code = a.ann_code
      // 是否为「材料上报相关公告」的公告（只看阶段，不看届次）
      const isMaterialStage = MATERIAL_STAGE_KEYS.indexOf(a.ann_stage_key) >= 0
      return {
        code, title: a.ann_title, content: a.ann_content,
        excerpt: excerptOf(a.ann_content, 64),
        stageKey: a.ann_stage_key,
        stageName: stageNameMap[a.ann_stage_key] || '通用事项',
        stageNote: stageNoteMap[a.ann_stage_key] || '',
        stageIdx: stageIdx[a.ann_stage_key] !== undefined ? stageIdx[a.ann_stage_key] : 999,
        isMaterialStage,
        // 能真正去提交材料：既要是材料阶段公告，又必须属于当前进行中的届次
        // （材料提交页只服务 g.electionId，历史届公告跳过去列表对不上）
        canMaterial: isMaterialStage && isCurrentTerm,
        start: st ? st.plan_start : '', end: st ? st.plan_end : '',
        publish: (a.ann_publish_time || '').slice(0, 10),
        electionTerm: selectedElection ? selectedElection.term : '',
        noticeKey: selectedElectionId + '::' + code,
        unread: readSet.indexOf(selectedElectionId + '::' + code) === -1,
        files: Array.isArray(a.ann_files) ? a.ann_files : []   // 每份公告独立附件 [{name,url}]
      }
    }).sort((x, y) => (x.stageIdx - y.stageIdx) || String(x.publish).localeCompare(String(y.publish)))

    const forecasts = stages
      .filter(x => x.plan_start && x.plan_start > g.snapshotDate)
      .map(x => {
        const status = x.es_status || '未开始'
        const cls = status === '办理中' || status === '进行中' || status === '已开始' ? 'tag-live'
          : status === '已完成' || status === '已归档' ? 'tag-done'
          : 'tag-forecast'
        return { key: x.es_stage_key, name: x.es_stage_name, start: x.plan_start, end: x.plan_end, note: x.es_note, annDesc: x.es_note, statusLabel: status, statusCls: cls }
      })

    // 「现在进行中」数据源 = 全量阶段中状态为办理中/进行中/已开始 的那一个。
    // 不能用 forecasts 找（它是未来阶段，永远命不中 tag-live），否则 live-banner 恒为空。
    const LIVE_STATUS = ['办理中', '进行中', '已开始']
    const liveStageRaw = stages.find(x => LIVE_STATUS.includes(x.es_status)) || null
    const liveStage = liveStageRaw
      ? { key: liveStageRaw.es_stage_key, name: liveStageRaw.es_stage_name, start: liveStageRaw.plan_start, end: liveStageRaw.plan_end, range: shortRange(liveStageRaw.plan_start, liveStageRaw.plan_end) }
      : null

    /* 往届结果公示：纯数据驱动，全部来自 election_results / election_stages / announcements 真实表，
       不写死届次名、组织名、阶段 key/名、公告号。换数据即自动跟着变，不再与真实库打架。 */
    const history = []
    const ysAnns = s.announcements.slice().sort((a, b) => (b.ann_publish_time || '').localeCompare(a.ann_publish_time || ''))
    // 往届结果 = 非当前届（g.electionId）的选举结果，按届次分组（同一届多岗位拼一张卡）
    const pastResults = s.results.filter(r => r.er_election_id !== g.electionId)
    const byElec = {}
    pastResults.forEach(r => {
      const k = r.er_election_id || 'unknown'
      if (!byElec[k]) byElec[k] = { electionId: k, orgName: r.er_org_name, date: r.er_election_date, rows: [] }
      byElec[k].rows.push(r)
    })
    Object.keys(byElec).forEach(k => {
      const grp = byElec[k]
      // 阶段名/说明：从该往届自己的 election_stages 动态取 D0（es_offset_start===0）那一条
      const stage = DB.election_stages.find(x => x.es_election_id === k && x.es_offset_start === 0)
      const stageKey = stage ? stage.es_stage_key : 'D0'
      const stageName = stage ? stage.es_stage_name : '正式选举'
      const stageNote = stage ? stage.es_note : '现场集中投票、当众开箱计票、当场公布结果'
      // 关联公告：优先用结果表自带的 er_result_ann_code 反查（不再写死公告号数组）
      const annCode = (grp.rows[0].er_result_ann_code || '').trim()
      const ann = annCode ? ysAnns.find(a => a.ann_code === annCode) : null
      const winners = grp.rows.map(r => (r.er_position ? r.er_position + '：' : '') + r.er_winner_name).join('｜')
      history.push({
        title: grp.orgName + '换届选举结果公示',
        date: grp.date,
        result: winners,
        voters: '参选率：' + (grp.rows[0].er_turnout || '—') + '（' + (grp.rows[0].er_actual_voters || '0') + '人投票）',
        status: grp.rows[0].er_filing_status || '已完结',
        orgName: grp.orgName,
        content: ann ? ann.ann_content : '',
        stageKey, stageName, stageNote
      })
    })

    // 时间线升序后，最新一条在末尾（走马灯播最新）
    const lastAnn = latest.length ? latest[latest.length - 1] : null
    const marqueeText = (selectedElection ? selectedElection.term + ' · ' : '') + '公告 ' + latest.length + ' 条已发布 — 最新：' + (lastAnn ? lastAnn.code + ' ' + lastAnn.title : '当前届次暂无已发布公告')
    const unreadCount = latest.filter(a => a.unread).length

    // —— 阶段卡片：按 election_stages 分组，每阶段一张高级感卡片（阶段参数+介绍+公告列表）——
    const stageCardMap = {}
    stageRows.forEach((s, i) => {
      const computed = stages.find(x => x.es_stage_key === s.es_stage_key) || {}
      stageCardMap[s.es_stage_key] = {
        key: s.es_stage_key,
        name: s.es_stage_name,
        note: s.es_note || '',
        status: s.es_status || '未开始',
        statusCls: (s.es_status === '已完成' || s.es_status === '已归档') ? 'tag-done'
          : (s.es_status === '办理中' || s.es_status === '进行中' || s.es_status === '已开始') ? 'tag-live'
          : 'tag-forecast',
        barCls: (s.es_status === '已完成' || s.es_status === '已归档') ? 'bar-done'
          : (s.es_status === '进行中' || s.es_status === '已开始') ? 'bar-live'
          : 'bar-todo',
        start: computed.plan_start || '',
        end: computed.plan_end || '',
        stageIdx: i,
        announcements: []
      }
    })
    latest.forEach((a, idx) => {
      const card = stageCardMap[a.stageKey]
      if (card) card.announcements.push(Object.assign({}, a, { globalIdx: idx }))
    })
    const stageCards = Object.values(stageCardMap)
      .filter(c => c.announcements.length > 0)
      .sort((a, b) => a.stageIdx - b.stageIdx)

    this.setData({
      orgName: org ? org.name : '', marqueeText, latest, stageCards,
      electionOptions, electionIndex, selectedElectionId,
      selectedElectionLabel: selectedElection ? selectedElection.label : '',
      forecasts, history, unreadCount, liveStage,
      // 材料上报窗口：与「材料提交」页同源，供公告详情底部如实承诺办理时间
      matRange: matWin.start ? (matWin.start + ' ~ ' + matWin.end) : '待公布'
    })
  },

  pickElection(e) {
    const index = Number(e.detail.value)
    const option = (this.data.electionOptions || [])[index]
    if (!option) return
    this.setData({ electionIndex: index, selectedElectionId: option.id })
    this.refresh()
  },

  switchTab(e) { this.setData({ activeTab: e.currentTarget.dataset.key, detail: null }) },

  openDetail(e) {
    const idx = e.currentTarget.dataset.idx
    let d, kind
    if (this.data.activeTab === 'latest') { d = this.data.latest[idx]; kind = 'ann' }
    else if (this.data.activeTab === 'forecast') { d = this.data.forecasts[idx]; kind = 'forecast' }
    else {
      const h = this.data.history[idx]
      if (h.content) { d = h; kind = 'ann' } else { wx.showToast({ title: '结果详情见PC端「结果与花名册」', icon: 'none' }); return }
    }
    if (d && d.code) {
      const rs = new Set(this.data.readSet || [])
      rs.add(d.noticeKey || d.code)
      const arr = Array.from(rs)
      wx.setStorageSync('readNotices', arr)
      const latest = this.data.latest.map(x => x.code === d.code ? Object.assign({}, x, { unread: false }) : x)
      this.setData({ readSet: arr, latest, unreadCount: latest.filter(x => x.unread).length })
      d = Object.assign({}, d, { unread: false, excerpt: d.excerpt || excerptOf(d.content, 64) })
    }
    this.setData({ detail: d, detailKind: kind })
  },

  closeDetail() { this.setData({ detail: null }) },
  /* 带着公告号跳转：材料提交页据此预选「对应公告」，
     否则用户从某条公告点进来，到了还得在下拉里把同一条公告再选一遍。 */
  goMaterial() {
    // 极简提交页已无「公告关联」picker，不再带 ann 参数；直接进页填材料即可
    this.setData({ detail: null })
    wx.navigateTo({ url: '/pages/material/material' })
  },
  // 公告原文下载：小程序内无文件流，以「复制全文」落地（可粘贴到本地保存/转发）
  copyAnnContent() {
    const d = this.data.detail
    if (!d || !d.content) return
    wx.setClipboardData({
      data: d.title + '\n' + d.content,
      success: () => wx.showToast({ title: '原文已复制，可粘贴保存', icon: 'success' })
    })
  },
  // 公告附件下载：每份公告独立附件，点击下载并打开（根治"切换公告下载链接是死的"）
  downloadAttachment(e) {
    const { url, name } = e.currentTarget.dataset
    if (!url) return
    const api = require('../../utils/api')
    const fullUrl = api.BASE_URL + url
    wx.showLoading({ title: '下载中…', mask: true })
    wx.downloadFile({
      url: fullUrl,
      success(res) {
        wx.hideLoading()
        if (res.statusCode === 200 && res.tempFilePath) {
          wx.openDocument({
            filePath: res.tempFilePath,
            showMenu: true,
            fail() {
              // 打不开的类型（如 .txt/.jpg），复制文件路径兜底
              wx.setClipboardData({ data: fullUrl, success: () => wx.showToast({ title: '链接已复制，浏览器打开', icon: 'none' }) })
            }
          })
        } else {
          wx.showToast({ title: '下载失败（' + res.statusCode + '）', icon: 'none' })
        }
      },
      fail() {
        wx.hideLoading()
        wx.setClipboardData({ data: fullUrl, success: () => wx.showToast({ title: '下载失败，链接已复制', icon: 'none' }) })
      }
    })
  }
})
