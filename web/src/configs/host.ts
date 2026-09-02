export default {
  mock: {
    // 本地mock数据
    API: '',
  },
  development: {
    // v6.1：走 vite proxy 相对路径 /api → localhost:8080（Node+Neon 后端）
    API: '',
  },
  test: {
    API: '',
  },
  release: {
    // 正式环境：Nginx 反代 /api → 后端（与本仓 scripts/unified_proxy.js 同构）
    API: '',
  },
  site: {
    API: '',
  },
};
