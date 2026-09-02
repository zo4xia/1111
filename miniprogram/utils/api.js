// utils/api.js — 小程序端 HTTP 客户端（配套后端 = server/api.js，Node/Express + JWT，端口 8080）
// 设计原则（与 PC 端 web-front 一致的「真实优先 / 离线回退」）：
//   1) 网络失败 e.type='network' → 调用方回落本地 db.js 演示数据，演示不断链；
//   2) 服务端明确拒绝（401/403/400）e.type='auth'/'http' → 如实提示，不静默降级；
//   3) 401 自动清 token（12h 过期），下次登录重新获取。
// 部署提示：开发者工具需勾选「不校验合法域名」（project.private.config.json 已置 urlCheck:false）；
//   生产环境将 BASE_URL 换成 https 域名并在小程序管理后台配置 request 合法域名。
const BASE_URL = 'http://127.0.0.1:8080'
const TOKEN_KEY = 'mpToken'

function hasWx() { return typeof wx !== 'undefined' }
function getToken() { return (hasWx() && wx.getStorageSync(TOKEN_KEY)) || '' }
function setToken(t) { if (!hasWx()) return; if (t) wx.setStorageSync(TOKEN_KEY, t); else wx.removeStorageSync(TOKEN_KEY) }
function clearToken() { setToken('') }

function err(type, message) { const e = new Error(message); e.type = type; return e }

/** 底层请求：wx.request → Promise；统一 {code:0,data} 契约解包 */
function request(method, path, body, opts) {
  opts = opts || {}
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + path,
      method,
      data: body || undefined,
      timeout: opts.timeout || 5000,
      header: Object.assign(
        { 'Content-Type': 'application/json' },
        getToken() ? { Authorization: 'Bearer ' + getToken() } : {}
      ),
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const j = res.data
          if (j && typeof j === 'object' && j.code !== undefined) {
            if (j.code === 0) resolve(j.data)
            else reject(err('http', j.message || '业务处理失败'))
          } else {
            resolve(j)
          }
        } else if (res.statusCode === 401) {
          clearToken() // 登录过期：清 token 保持本地演示可用，待用户重新登录
          reject(err('auth', (res.data && res.data.message) || '登录已过期，请重新登录'))
        } else {
          reject(err('http', (res.data && res.data.message) || ('请求失败（' + res.statusCode + '）')))
        }
      },
      fail() { reject(err('network', '后端不可达（未启动或不在同一网络）')) },
    })
  })
}

function get(path, opts) { return request('GET', path, null, opts) }
function post(path, body, opts) { return request('POST', path, body, opts) }
function put(path, body, opts) { return request('PUT', path, body, opts) }

/** 服务端登录：POST /api/login {orgId, phone, password}
 *  不传 role → 服务端按账号 roles 自动解析（NO.*=参选人 / platform_admin=超管），
 *  与 PC 端登录口径完全一致（同一个人在小程序与 PC 看到的是同一身份）。 */
function login(orgId, phone, password) {
  return post('/api/login', { orgId, phone, password }, { timeout: 6000 })
}

/* ============ 选民免密注册/登录（「先跑通」尾巴 ①） ============
 *  免密铁律（与服务端同口径）：归属地注册后终身锁定；跨归属地登录 401；
 *  已设密码账号必须走 login()。wxCode 为 wx.login 取得的 code，
 *  服务端配置了 WX_APPID/WX_SECRET 才真实绑定 openid，否则如实跳过。 */
function mpRegister(orgId, phone, wxCode) {
  return post('/api/mp/register', { orgId, phone, wxCode }, { timeout: 8000 })
}

function mpLogin(orgId, phone, wxCode) {
  return post('/api/mp/login', { orgId, phone, wxCode }, { timeout: 6000 })
}

/** 微信一键登录：服务端未配置微信凭据时 501 如实返回（e.type='http'） */
function wxLogin(wxCode) {
  return post('/api/mp/wxlogin', { wxCode }, { timeout: 6000 })
}

/** 附件真实上传（wx.uploadFile → multipart）：POST /api/materials/:id/upload
 *  与 request() 同一套错误分类（network/auth/http）；返回 {name,url} 与附件列表。 */
function uploadFile(path, filePath, formData) {
  return new Promise((resolve, reject) => {
    if (!getToken()) return reject(err('auth', '未登录（无 token），请先登录'))
    wx.uploadFile({
      url: BASE_URL + path,
      filePath: filePath,
      name: 'file',
      header: { Authorization: 'Bearer ' + getToken() },
      formData: formData || {},
      timeout: 20000,
      success(res) {
        let j = null
        try { j = typeof res.data === 'string' ? JSON.parse(res.data) : res.data } catch (e) { j = null }
        if (res.statusCode >= 200 && res.statusCode < 300 && j && j.code === 0) {
          resolve(j.data)
        } else if (res.statusCode === 401) {
          clearToken()
          reject(err('auth', (j && j.message) || '登录已过期，请重新登录'))
        } else {
          reject(err('http', (j && j.message) || ('上传失败（' + res.statusCode + '）')))
        }
      },
      fail() { reject(err('network', '后端不可达（上传中断）')) },
    })
  })
}

module.exports = { BASE_URL, getToken, setToken, clearToken, get, post, put, login, mpRegister, mpLogin, wxLogin, uploadFile }
