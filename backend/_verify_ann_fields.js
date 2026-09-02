'use strict';
// 验证公告编辑态字段全量持久化 + annFiles 回灌
const BASE = 'http://localhost:8080';
(async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '13800000001', password: '123456' }),
  }).then((r) => r.json());
  const H = { Authorization: 'Bearer ' + login.data.token, 'Content-Type': 'application/json' };
  const list = await fetch(`${BASE}/api/announcements`, { headers: H }).then((r) => r.json());
  const a = (list.data || [])[0];
  if (!a) throw new Error('无公告可测');
  console.log('改动前字段：', JSON.stringify({
    code: a.annCode, sign: a.annSign, open: a.annOpenMaterialSubmit, mode: a.annPublishMode,
    hours: a.annRemindHours, to: a.annRemindTo, files: (a.annFiles || []).length,
  }));
  const put = await fetch(`${BASE}/api/announcements/${a.id}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({
      annSign: '测试落款居委会', annSignDate: '2026年10月30日', annOpenMaterialSubmit: true,
      annPublishMode: 'scheduled', annRemindHours: 48, annRemindTo: ['editor'],
    }),
  }).then((r) => r.json());
  console.log('PUT 返回：', JSON.stringify(put.data));
  const list2 = await fetch(`${BASE}/api/announcements`, { headers: H }).then((r) => r.json());
  const b = (list2.data || []).find((x) => x.id === a.id);
  console.log('回读字段：', JSON.stringify({
    sign: b.annSign, signDate: b.annSignDate, open: b.annOpenMaterialSubmit,
    mode: b.annPublishMode, hours: b.annRemindHours, to: b.annRemindTo, files: (b.annFiles || []).length,
  }));
  const ok = b.annSign === '测试落款居委会' && b.annOpenMaterialSubmit === true &&
    b.annPublishMode === 'scheduled' && b.annRemindHours === 48 && b.annRemindTo === 'editor' &&
    (b.annFiles || []).length >= 1;
  console.log(ok ? '✓ 编辑态字段全部持久化且附件回灌' : '!! 存在未落库字段');
  // 复原，避免污染草稿
  await fetch(`${BASE}/api/announcements/${a.id}`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ annSign: '', annSignDate: '', annOpenMaterialSubmit: false, annPublishMode: 'immediate', annRemindHours: 24, annRemindTo: ['editor', 'admin'] }),
  });
  console.log('已复原默认值');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
