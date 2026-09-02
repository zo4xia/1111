# 踩坑记录 · Web 工程搭建（TDesign React Starter）

> 2026-08-31 · 部署 tdesign-react-starter 全过程踩坑，务必先读再动

## 环境
- Windows + node v20.20.2 + npm 10.8.2
- starter: `@tencent/tdesign-react-starter@0.3.1`（自带 vite 2.9.18，偏老）
- 工程目录：`own/web-front`，dev 端口 **3003**

## 坑 1：npm install 未完整完成 → vite 命令找不到
- **现象**：`npm run dev` 报 `'vite' is not recognized as an internal or external command`
- **根因**：第一次 npm install 没跑完（`node_modules/.bin` 为空 0 个），vite 可执行文件没生成
- **解决**：重新完整 `npm install --no-audit --no-fund`，**确认 `.bin` 数量 > 20 再启动**
- **教训**：装依赖不能只看 node_modules 存在，要看 `.bin` 是否生成

## 坑 2：vite 2.9 + node 20 → `/` 404
- **现象**：`/` 返回 404，但 `/index.html` 200，`/src/main.tsx`、`/@vite/client` 都 200（模块转换正常）
- **根因**：vite 2.9 太老（2022），history fallback 在 node 20 下失效，根路径不 fallback 到 index.html
- **解决**：升级 **vite@^5.4.21 + @vitejs/plugin-react@^4 + vite-plugin-mock@^3**，升级后 `/` 200
- **教训**：老 vite + 新 node 必炸路由，直接升级 vite 到 5.x 以上

## 坑 3：peer dependency 冲突
- **现象**：`Conflicting peer dependency: vite@5.4.21`（老 vite-plugin-mock 与新 vite5 冲突）
- **解决**：`npm install ... --legacy-peer-deps` 重试
- **教训**：升级 vite 时同步升级配套插件，冲突就用 --legacy-peer-deps

## 坑 4：残留进程占端口
- **现象**：3000 端口有残留进程返回 500，真正 dev server 在 3003
- **解决**：`Get-NetTCPConnection -LocalPort 3003` 查 OwningProcess → `Stop-Process -Force` 清理
- **教训**：端口被占先查监听进程再清理，别猜

## 坑 5：后台任务查询接口异常
- **现象**：TaskOutput 多次 `Native execution failed`
- **解决**：改用**文件/端口轮询**判断完成（查 .bin 数量、查端口监听）
- **教训**：不要依赖单个任务查询接口，轮询文件状态更稳

## 遗留警告（后续优化）
- vite CJS build deprecated → 把 `vite.config.js` 改 ESM（.mjs）或加 `"type":"module"`
- `.env` 里 `NODE_ENV=production` 在 mock 模式有警告 → 清理
- browserslist 数据旧 → `npx update-browserslist-db@latest`

## 启动命令（确认可用）
```powershell
cd E:\w\0\election-v2-2.0\0716\own\web-front
npm run dev:mock   # → http://localhost:3003/
```

---

> 变更树：2026-08-31 记录 Web 工程搭建踩坑（install/路由/peer/端口/任务查询）
