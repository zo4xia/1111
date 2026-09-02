// 图片九宫格选择器 —— 全站唯一图片上传实现
// 事件契约：bind:success(新增 files) / bind:remove(index) / bind:fail(errMsg)，页面据此拼装数据
// 点缩略图 wx.previewImage 全屏预览
// 注意：禁用态不静默 return —— 静默会让用户以为程序坏了，必须经 fail 事件把原因交给页面提示。
const icons = require('../../utils/icons')

let seq = 0
// 稳定唯一 id：避免同一张图重复选择时 wx:key="url" 冲突导致列表复用错乱
function nextId() { seq += 1; return 'f' + Date.now().toString(36) + '_' + seq }

Component({
  properties: {
    files: { type: Array, value: [] },             // [{ _id, url, name, size, type }]
    max: { type: Number, value: 9 },               // 张数上限
    sizeLimit: { type: Number, value: 10485760 },  // 单张字节上限（10MB）
    disabled: { type: Boolean, value: false },
    disabledTip: { type: String, value: '当前不可添加图片' }
  },
  data: { addIcon: icons.dai.camera },
  methods: {
    choose() {
      if (this.data.disabled) {
        this.triggerEvent('fail', { errMsg: this.data.disabledTip })
        return
      }
      const remain = this.data.max - this.data.files.length
      if (remain <= 0) {
        this.triggerEvent('fail', { errMsg: '最多上传 ' + this.data.max + ' 张图片' })
        return
      }
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => {
          const add = []
          let oversize = 0
          ;(res.tempFiles || []).forEach(f => {
            if (f.size > this.data.sizeLimit) { oversize += 1; return }
            add.push({ _id: nextId(), url: f.tempFilePath, name: '材料图片', size: f.size, type: 'image' })
          })
          if (oversize) {
            this.triggerEvent('fail', { errMsg: oversize + ' 张超过 ' + Math.round(this.data.sizeLimit / 1048576) + 'MB，已自动跳过' })
          }
          if (add.length) this.triggerEvent('success', { files: add })
        },
        fail: (err) => {
          // 用户主动取消不算失败，不触发事件
          if (err && /cancel/i.test(err.errMsg || '')) return
          this.triggerEvent('fail', { errMsg: '选择图片失败，请重试' })
        }
      })
    },
    remove(e) { this.triggerEvent('remove', { index: Number(e.currentTarget.dataset.idx) }) },
    preview(e) {
      const idx = Number(e.currentTarget.dataset.idx)
      const urls = this.data.files.map(f => f.url)
      if (!urls[idx]) return
      wx.previewImage({ current: urls[idx], urls })
    }
  }
})
