import { useEffect, useState } from 'react';
import { Button, Dialog, Input, Select, Table, Tag, MessagePlugin } from 'tdesign-react';
import Page from 'layouts/components/Page';
import {
  apiOrgs,
  currentUser,
  adminListAccounts,
  adminPresetAccounts,
  Org,
  AdminAccount,
} from 'services/electionApi';
import Style from './index.module.less';

interface Row {
  key: number;
  name: string;
  phone: string;
  roleKey: 'sub_admin' | 'operator' | 'editor' | 'reviewer';
  password: string;
}

const ROLE_OPTIONS = [
  { value: 'sub_admin', label: '子管理（本村全权限）' },
  { value: 'operator', label: '经办' },
  { value: 'editor', label: '编辑' },
  { value: 'reviewer', label: '审核员' },
];
const ROLE_TAG: Record<string, { label: string; theme: 'primary' | 'warning' | 'success' | 'default' }> = {
  sub_admin: { label: '子管理', theme: 'primary' },
  operator: { label: '经办', theme: 'default' },
  editor: { label: '编辑', theme: 'warning' },
  reviewer: { label: '审核员', theme: 'success' },
  voters: { label: '参选人', theme: 'default' },
};

let rowSeq = 1;

/** D-013 隐藏解锁页：仅平台超管，解锁码 + 归属地 + 批量预设账号（初始密码 123456） */
export default function OrgSetup() {
  const user = currentUser();
  const isAdmin = user?.role === 'admin' || user?.roles === 'platform_admin';

  const [unlocked, setUnlocked] = useState(false);
  const [unlockCode, setUnlockCode] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState('');
  const [rows, setRows] = useState<Row[]>([{ key: rowSeq++, name: '', phone: '', roleKey: 'operator', password: '' }]);
  const [existing, setExisting] = useState<AdminAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: string[]; updated: string[]; skipped: { phone: string; reason: string }[] } | null>(null);

  useEffect(() => {
    if (isAdmin) apiOrgs().then(setOrgs).catch(() => MessagePlugin.error('归属地列表加载失败'));
  }, [isAdmin]);

  const loadExisting = async (oid: string) => {
    if (!oid) return;
    setLoading(true);
    try {
      const list = await adminListAccounts(oid);
      setExisting(list || []);
    } catch {
      MessagePlugin.error('现有账号加载失败');
    } finally {
      setLoading(false);
    }
  };

  const onOrgChange = (v: string) => {
    setOrgId(v);
    loadExisting(v);
  };

  const addRow = () => setRows((r) => [...r, { key: rowSeq++, name: '', phone: '', roleKey: 'operator', password: '' }]);
  const delRow = (key: number) => setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== key) : r));
  const updRow = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const onSave = async () => {
    if (!orgId) { MessagePlugin.warning('请先选择归属地'); return; }
    const valid = rows.filter((r) => r.phone.trim() || r.name.trim());
    if (!valid.length) { MessagePlugin.warning('至少填写一个账号'); return; }
    for (const r of valid) {
      if (!/^1\d{10}$/.test(r.phone.trim())) { MessagePlugin.warning(`手机号格式不对：${r.phone || '(空)'}`); return; }
    }
    setSaving(true);
    try {
      const res = await adminPresetAccounts(
        unlockCode,
        orgId,
        valid.map((r) => ({ name: r.name.trim(), phone: r.phone.trim(), roleKey: r.roleKey, password: r.password.trim() || undefined })),
      );
      setResult(res);
      MessagePlugin.success(`预设完成：新增 ${res.created.length} · 更新 ${res.updated.length} · 跳过 ${res.skipped.length}`);
      setRows([{ key: rowSeq++, name: '', phone: '', roleKey: 'operator', password: '' }]);
      loadExisting(orgId);
    } catch (e) {
      MessagePlugin.error((e as { message?: string })?.message || '预设失败，请检查解锁码');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <Page breadcrumbs={['系统', '归属地账号预设']}>
        <div className={Style.lockBox}>
          <h3>仅平台超管可访问</h3>
          <p>此页面用于为村/社区预设登录账号，请使用平台超管账号登录后访问。</p>
        </div>
      </Page>
    );
  }

  const existingCols = [
    { colKey: 'name', title: '姓名', width: 120 },
    { colKey: 'phone', title: '手机号', width: 140 },
    {
      colKey: 'roleKey', title: '角色', width: 120,
      cell: ({ row }: { row: AdminAccount }) => {
        const m = ROLE_TAG[row.roleKey || ''] || { label: row.roleKey || '未分配', theme: 'default' as const };
        return <Tag theme={m.theme} variant='light' size='small'>{m.label}</Tag>;
      },
    },
    {
      colKey: 'status', title: '状态', width: 100,
      cell: ({ row }: { row: AdminAccount }) => (
        <Tag theme={row.status === 'active' ? 'success' : 'default'} variant='outline' size='small'>
          {row.status === 'active' ? '启用' : '停用'}
        </Tag>
      ),
    },
    { colKey: 'createdAt', title: '创建时间', width: 170, cell: ({ row }: { row: AdminAccount }) => (row.createdAt || '').slice(0, 16).replace('T', ' ') },
  ];

  return (
    <Page breadcrumbs={['系统', '归属地账号预设']}>
      <div className={Style.wrap}>
        <div className={Style.pageHead}>
          <div>
            <h2 className={Style.pageTitle}>归属地账号预设（隐藏页）</h2>
            <div className={Style.sub}>为村/社区预设登录账号：子管理 / 经办 / 编辑 / 审核员，初始密码 123456。预设后前端即可用「归属地 + 手机号 + 密码」登录对应后台。</div>
          </div>
        </div>

        {!unlocked ? (
          <div className={Style.unlockBox}>
            <div className={Style.unlockTitle}>🔒 请输入超管解锁码</div>
            <Input type='password' value={unlockCode} onChange={(v) => setUnlockCode(String(v))} placeholder='解锁码（默认 123456，后端校验）' style={{ maxWidth: 320 }} />
            <Button theme='primary' disabled={!unlockCode} onClick={() => setUnlocked(true)}>解锁进入</Button>
            <div className={Style.hint}>解锁码不在前端校验对错，提交预设时由后端二次校验，错误会提示。</div>
          </div>
        ) : (
          <>
            <div className={Style.section}>
              <div className={Style.sectionTitle}>① 选择归属地</div>
              <Select
                value={orgId}
                onChange={(v) => onOrgChange(String(v))}
                placeholder='请选择村 / 社区'
                style={{ maxWidth: 360 }}
                options={orgs.map((o) => ({ value: o.orgId, label: `${o.name}（${o.type === 'community' ? '社区' : '村'}）` }))}
              />
            </div>

            <div className={Style.section}>
              <div className={Style.sectionTitle}>② 添加账号（可批量）</div>
              <div className={Style.rowTable}>
                <div className={Style.rowHeader}>
                  <span style={{ width: 140 }}>角色</span>
                  <span style={{ width: 140 }}>姓名（可选）</span>
                  <span style={{ width: 180 }}>手机号</span>
                  <span style={{ width: 160 }}>密码（留空=123456）</span>
                  <span style={{ width: 60 }}>操作</span>
                </div>
                {rows.map((r) => (
                  <div key={r.key} className={Style.rowItem}>
                    <Select
                      value={r.roleKey}
                      onChange={(v) => updRow(r.key, { roleKey: v as Row['roleKey'] })}
                      style={{ width: 140 }}
                      options={ROLE_OPTIONS}
                    />
                    <Input value={r.name} onChange={(v) => updRow(r.key, { name: String(v) })} placeholder='如：林建国' style={{ width: 140 }} />
                    <Input value={r.phone} onChange={(v) => updRow(r.key, { phone: String(v) })} placeholder='11 位手机号' style={{ width: 180 }} />
                    <Input value={r.password} onChange={(v) => updRow(r.key, { password: String(v) })} placeholder='默认 123456' style={{ width: 160 }} />
                    <Button variant='text' theme='danger' disabled={rows.length === 1} onClick={() => delRow(r.key)}>删除</Button>
                  </div>
                ))}
              </div>
              <div className={Style.actions}>
                <Button variant='outline' onClick={addRow}>＋ 添加一行</Button>
                <Button theme='primary' loading={saving} onClick={onSave}>保存预设</Button>
              </div>
            </div>

            {result && (
              <Dialog header='预设结果' visible={!!result} onClose={() => setResult(null)} footer={<Button theme='primary' onClick={() => setResult(null)}>知道了</Button>} width={480}>
                <div className={Style.resultBox}>
                  <div><Tag theme='success' variant='light'>新增 {result.created.length}</Tag> {result.created.join('、') || '—'}</div>
                  <div><Tag theme='primary' variant='light'>更新 {result.updated.length}</Tag> {result.updated.join('、') || '—'}</div>
                  <div><Tag theme='warning' variant='light'>跳过 {result.skipped.length}</Tag></div>
                  {result.skipped.map((s) => <div key={s.phone} className={Style.skipItem}>· {s.phone}：{s.reason}</div>)}
                </div>
              </Dialog>
            )}

            <div className={Style.section}>
              <div className={Style.sectionTitle}>③ 该归属地现有账号</div>
              <Table rowKey='id' columns={existingCols} data={existing} loading={loading} size='small' />
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
