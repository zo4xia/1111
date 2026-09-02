// 统一线性图标（零依赖，纯 SVG data URI）。颜色可指定品牌色。
const DAI = '#3a7670'

const PATHS = {
  bell: '<path d="M12 3a6 6 0 0 0-6 6c0 4.4-1.4 5.9-2.4 6.5h16.8C19.4 14.9 18 13.4 18 9a6 6 0 0 0-6-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  ballot: '<path d="M4 21V8l8-4 8 4v13"/><path d="M3 21h18"/><path d="M10 21v-6h4v6"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8.5 7l1.3-2h4.4L15.5 7"/>',
  clip: '<path d="M21 11.5 13 19.5a5 5 0 0 1-7-7l9-9a3 3 0 0 1 4.2 4.2l-9 9a1 1 0 0 1-1.4-1.4l8.3-8.3"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-1.8 5.5"/><path d="M20 5v6h-6"/>',
  warn: '<path d="M12 3.5 2.5 19.5h19z"/><path d="M12 9.5v4.5"/><path d="M12 17.5h.01"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s6.5-5.2 6.5-10A6.5 6.5 0 1 0 5.5 11c0 4.8 6.5 10 6.5 10z"/><circle cx="12" cy="11" r="2.3"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3.5a5.5 5.5 0 0 0-3.5 9.7c.8.8.8 1.6.8 2.3h5.4c0-.7 0-1.5.8-2.3A5.5 5.5 0 0 0 12 3.5z"/>',
  book: '<path d="M5 4.5h11A2 2 0 0 1 18 6.5V20H7a2 2 0 0 1-2-2z"/><path d="M5 4.5V18"/><path d="M9 8.5h6"/>',
  arrow: '<path d="M5 12h13"/><path d="M13 6.5 18.5 12 13 17.5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 18v-5M12 18V9M16 18v-7"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M14 8a4 4 0 0 1 0 8"/>',
  phone: '<path d="M6.5 3.5h3.2l1.3 4.4-2 1.5a12.8 12.8 0 0 0 5.6 5.6l1.5-2 4.4 1.3v3.2A2.5 2.5 0 0 1 18 20 15.5 15.5 0 0 1 4 6 2.5 2.5 0 0 1 6.5 3.5z"/>',
  wechat: '<path d="M21 11.6a8.4 8.4 0 0 1-8.4 8.4c-1.2 0-2.3-.25-3.3-.7L4 20.5l1.3-4.1A8.4 8.4 0 1 1 21 11.6z"/><path d="M8.8 10h.01M12.5 10h.01"/>'
}

function svg(inner, color) {
  const s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' +
    color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'
  return 'data:image/svg+xml,' + encodeURIComponent(s)
}

function palette(c) {
  const o = {}
  Object.keys(PATHS).forEach(k => { o[k] = svg(PATHS[k], c); })
  return o
}

module.exports = {
  dai: palette(DAI)
}
