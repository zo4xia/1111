import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, Select, Table, Tag, MessagePlugin } from 'tdesign-react';
import Page from 'layouts/components/Page';
import {
  apiOrgs,
  currentUser,
  adminListAccounts,
  adminSetAccountStatus,
  adminResetPassword,
  Org,
  AdminAccount,
} from 'services/electionApi';
import Style from './index.module.less';

const ROLE_TAG: Record<string, { label: string; theme: 'primary' | 'warning' | 'success' | 'default' }> = {
  sub_admin: { label: '子管理', theme: 'primary' },
  operator: { label: '经办', theme: 'default' },
  editor: { label: '编辑', theme: 'warning' },
  reviewer: { label: '审核员', theme: 'success' },
  voters: { label: '参选人', theme: 'default' },
  platform_admin: { label: '平台超管', theme: 'primary' },
};

/** 人员管理：查看/启停/重置密码（真实后端 /api/admin/accounts，仅超管可跨村） */
export default function Users() {
  const navigate = useNavigate();
  const user = currentUser();
  const isAdmin = user?.role === 'admin' || user?.roles === 'platform_admin';
  const crossOrg = !!user?.crossOrg;

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState(user?.orgId || '');
  const [list, setList] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminAccount | null>(null);

  const load = useCallback(async (oid: string) => {
    if (!oid) return;
    setLoading(true);
    try {
      const data = await adminListAccounts(crossOrg ? oid : undefined);
      // 非超管后端会自动按归属地过滤，这里再兜底一次
      const filtered = crossOrg ? data : (data || []).filter((a) => a.orgId === user?.orgId);
      setList(filtered || []);
    } catch (e) {
      MessagePlugin.error((e as { message?: string })?.message || '账号列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [crossOrg, user?.orgId]);

  useEffect(() => {
    if (isAdmin) {
      apiOrgs().then(setOrgs).catch(() => {});
      load(orgId || user?.orgId || '');
    }
  }, [isAdmin, orgId, user?.orgId, load]);

  const onToggleStatus = async (row: AdminAccount) => {
    const next = row.status === 'active' ? 'disabled' : 'active';
    try {
      await adminSetAccountStatus(row.id, next);
      MessagePlugin.success(`已${next === 'active' ? '启用' : '停用'} ${row.name || row.phone}`);
      load(orgId);
    } catch (e) {
      MessagePlugin.error((e as { message?: string })?.message || '操作失败');
    }
  };

  const onReset = async () => {
    if (!resetTarget) return;
    try {
      await adminResetPassword(resetTarget.id);
      MessagePlugin.success(`已重置 ${resetTarget.name || resetTarget.phone} 的密码为 123456`);
      setResetTarget(null);
    } catch (e) {
      MessagePlugin.error((e as { message?: string })?.message || '重置失败');
    }
  };

  if (!isAdmin) {
    return (
      <Page breadcrumbs={['后台管理', '人员管理']}>
        <div className={Style.lockBox}>
          <h3>仅平台超管可管理人员</h3>
          <p>村/社区子管理可在「归属地账号预设」页为本村添加账号。</p>
          <Button theme='primary' onClick={() => navigate('/org-setup')}>前往账号预设</Button>
        </div>
      </Page>
    );
  }

  const columns = [
    { colKey: 'name', title: '姓名', width: 120 },
    { colKey: 'phone', title: '手机号', width: 140 },
    { colKey: 'orgName', title: '归属地', width: 180, cell: ({ row }: { row: AdminAccount }) => row.orgName || row.orgId },
    {
      colKey: 'roleKey', title: '角色', width: 110,
      cell: ({ row }: { row: AdminAccount }) => {
        const m = ROLE_TAG[row.roleKey || ''] || { label: row.roleKey || '未分配', theme: 'default' as const };
        return <Tag theme={m.theme} variant='light' size='small'>{m.label}</Tag>;
      },
    },
    {
      colKey: 'status', title: '状态', width: 90,
      cell: ({ row }: { row: AdminAccount }) => (
        <Tag theme={row.status === 'active' ? 'success' : 'default'} variant='outline' size='small'>
          {row.status === 'active' ? '启用' : '停用'}
        </Tag>
      ),
    },
    { colKey: 'createdAt', title: '创建时间', width: 160, cell: ({ row }: { row: AdminAccount }) => (row.createdAt || '').slice(0, 16).replace('T', ' ') },
    {
      colKey: 'op', title: '操作', width: 200,
      cell: ({ row }: { row: AdminAccount }) => (
        <>
          <Button variant='text' theme='primary' onClick={() => setResetTarget(row)}>重置密码</Button>
          <Button variant='text' theme={row.status === 'active' ? 'warning' : 'success'} onClick={() => onToggleStatus(row)}>
            {row.status === 'active' ? '停用' : '启用'}
          </Button>
        </>
      ),
    },
  ];

  return (
    <Page breadcrumbs={['后台管理', '人员管理']}>
      <div className={Style.wrap}>
        <div className={Style.pageHead}>
          <div>
            <h2 className={Style.pageTitle}>人员管理</h2>
            <div className={Style.sub}>管理各村/社区的后台登录账号。新增账号请使用「归属地账号预设」隐藏页。</div>
          </div>
          <div className={Style.headActions}>
            {crossOrg && (
              <Select
                value={orgId}
                onChange={(v) => setOrgId(String(v))}
                placeholder='按归属地筛选'
                style={{ width: 220 }}
                options={[{ value: '', label: '全部归属地' }, ...orgs.map((o) => ({ value: o.orgId, label: o.name }))]}
              />
            )}
            <Button theme='primary' variant='outline' onClick={() => load(orgId)}>刷新</Button>
            <Button theme='primary' onClick={() => navigate('/org-setup')}>＋ 账号预设</Button>
          </div>
        </div>
        <Table rowKey='id' columns={columns} data={list} loading={loading} size='small' />
      </div>

      <Dialog
        header='重置密码'
        visible={!!resetTarget}
        onClose={() => setResetTarget(null)}
        footer={
          <>
            <Button variant='text' onClick={() => setResetTarget(null)}>取消</Button>
            <Button theme='primary' onClick={onReset}>确认重置</Button>
          </>
        }
      >
        <p>确定将 <b>{resetTarget?.name || resetTarget?.phone}</b> 的密码重置为 <b>123456</b> 吗？</p>
        <p className={Style.tip}>重置后该账号可用新密码登录，建议首次登录后修改。</p>
      </Dialog>
    </Page>
  );
}
