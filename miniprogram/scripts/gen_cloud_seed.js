// scripts/gen_cloud_seed.js
// 将 data/db.js 的 DB 全量表导出为云函数初始化数据 seed.json。
// 设计要点：
//   1) 剔除云数据库自动生成的 _id，保持与本地 db.js 结构完全一致（单一真相，无第二套字段）
//   2) 数据真相源仍是 db.js（由 scripts/gen_mini_db.py 生成），本脚本只做「同源复制」到云端
// 用法：node scripts/gen_cloud_seed.js  （输出到 cloudfunctions/initDB/seed.json）
const fs = require('fs')
const path = require('path')
const db = require('../data/db')

const seed = {}
for (const [name, rows] of Object.entries(db.DB)) {
  seed[name] = (rows || []).map(r => {
    const { _id, ...rest } = r || {}
    return rest
  })
}

const out = path.join(__dirname, '..', 'cloudfunctions', 'initDB', 'seed.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(seed, null, 1), 'utf8')

const total = Object.values(seed).reduce((s, a) => s + a.length, 0)
console.log(`✅ seed.json 已生成：${Object.keys(seed).length} 个集合，共 ${total} 条记录`)
console.log(`   输出：${path.relative(process.cwd(), out)}`)
