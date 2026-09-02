// 只读冒烟：通过 HTTP 调运行中的 8080（不重启、不占端口），验证登录与角色链路
const http = require('http');
function req(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: 8080, path, method: method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) } },
      res => { let buf = ''; res.on('data', c => buf += c); res.on('end', () => resolve({ status: res.statusCode, body: buf })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
(async () => {
  try {
    console.log('health:', (await req('/api/health')).body);
    for (const [phone, who] of [['13800000001', '张主任'], ['13800000003', '王审核(reviewer)'], ['13800000011', '吴春霖(sub_admin)'], ['13800000006', '黄志明(voters)']]) {
      const login = await req('/api/login', 'POST', { phone, password: '123456' });
      const j = JSON.parse(login.body);
      if (j.data) {
        const u = j.data.user;
        console.log(`${who} 登录${login.status === 200 ? 'OK' : 'FAIL'}: role=${u.role} roles=${u.roles} roleKeys=[${u.roleKeys}] crossOrg=${u.crossOrg}`);
      } else console.log(`${who} 登录返回:`, login.status, login.body.slice(0, 120));
    }
  } catch (e) { console.error('冒烟失败（后端可能未运行，不影响数据修复结论）：', e.message); process.exitCode = 1; }
})();
