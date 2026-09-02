import { useState } from 'react';
import { Button, Dialog, Form, Input, Table, Tag, Checkbox, Select, MessagePlugin } from 'tdesign-react';
import Page from 'layouts/components/Page';
import {
  Role,
  Permission,
  useRoles,
  useCurrentRole,
  createRole,
  updateRole,
  removeRole,
  setCurrentRole,
} from 'utils/roleStore';
import Style from './index.module.less';

const { FormItem } = Form;

const PERM_META: Record<Permission, { label: string; desc: string; theme: 'success' | 'warning' | 'primary' }> = {
  view: { label: '查看', desc: '查看列表与详情（所有人默认）', theme: 'primary' },
  edit: { label: '编辑', desc: '可编辑（驳回提案可重新编辑）', theme: 'warning' },
  approve: { label: '审批', desc: '可通过 / 驳回提案', theme: 'success' },
};

/** 权限点映射：内置按钮文案 */
const PERM_OPTIONS: { value: Permission; label: string }[] = [
  { value: 'edit', label: '可编辑（驳回后可重新编辑）' },
  { value: 'approve', label: '可审批（通过/驳回）' },
];

export default function Roles() {
  const roles = useRoles();
  const current = useCurrentRole();

  const [createVisible, setCreateVisible] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [form] = Form.useForm();

  /** 打开创建/编辑弹窗 */
  const openForm = (row?: Role) => {
    setEditing(row || null);
    setCreateVisible(true);
    if (row) {
      form.setFieldsValue({
        name: row.name,
        code: row.code,
        note: row.note,
        perms: row.perms.filter((p) => p !== 'view'),
      });
    } else {
      form.reset();
    }
  };

  /** 保存角色 */
  const onSave = async () => {
    const v = await form.validate();
    if (!v) return;
    const values = form.getFieldsValue(true);
    // view 为基底权限，必含
    const perms: Permission[] = ['view', ...(values.perms || [])];
    if (editing) {
      updateRole(editing.id, { name: values.name, code: values.code, note: values.note, perms });
      MessagePlugin.success('角色已更新');
    } else {
      createRole({ name: values.name, code: values.code, note: values.note, perms });
      MessagePlugin.success('角色已创建');
    }
    setCreateVisible(false);
  };

  const columns = [
    { colKey: 'name', title: '角色名称', width: 140 },
    { colKey: 'code', title: '角色编码', width: 160 },
    {
      colKey: 'perms',
      title: '权限',
      width: 240,
      cell: ({ row }: { row: Role }) => (
        <div className={Style.permTags}>
          {(['view', 'edit', 'approve'] as Permission[]).map((p) =>
            row.perms.includes(p) ? (
              <Tag key={p} theme={PERM_META[p].theme} variant='light'>
                {PERM_META[p].label}
              </Tag>
            ) : (
              <Tag key={p} theme='default' variant='outline'>
                {PERM_META[p].label}
              </Tag>
            ),
          )}
        </div>
      ),
    },
    { colKey: 'note', title: '说明', minWidth: 200 },
    {
      colKey: 'op',
      title: '操作',
      width: 220,
      cell: ({ row }: { row: Role }) => (
        <>
          <Button variant='text' theme='primary' onClick={() => openForm(row)}>
            编辑
          </Button>
          {current.id === row.id ? (
            <Tag theme='success' variant='light'>
              当前角色
            </Tag>
          ) : (
            <Button
              variant='text'
              onClick={() => {
                setCurrentRole(row.id);
                MessagePlugin.success(`已切换为「${row.name}」`);
              }}
            >
              设为当前
            </Button>
          )}
          <Button variant='text' theme='danger' disabled={current.id === row.id} onClick={() => removeRole(row.id)}>
            删除
          </Button>
        </>
      ),
    },
  ];

  return (
    <Page breadcrumbs={['后台管理', '角色管理']}>
      <div className={Style.wrap}>
        <div className={Style.pageHead}>
          <div>
            <h2 className={Style.pageTitle}>角色管理</h2>
            <div className={Style.sub}>
              当前登录角色：
              <Tag theme='primary' variant='light'>
                {current.name}
              </Tag>
              <span className={Style.hint}>（演示：可切换角色查看权限差异，后续接登录/归属地）</span>
            </div>
          </div>
          <Button theme='primary' onClick={() => openForm()}>
            ＋ 创建角色
          </Button>
        </div>

        <div className={Style.tableBox}>
          <Table rowKey='id' columns={columns} data={roles} />
        </div>

        {/* 权限规则说明 */}
        <div className={Style.ruleBox}>
          <b>权限规则：</b>
          <span>
            查看（所有人默认）→ 编辑（驳回后可重新编辑）→
            审批（通过/驳回）。子管理/超管/经办编辑可编辑；经办编辑不可审批；审核员可审批不可编辑。
          </span>
        </div>
      </div>

      {/* 创建/编辑角色弹窗 */}
      <Dialog
        header={editing ? `编辑角色：${editing.name}` : '创建角色'}
        visible={createVisible}
        width={520}
        onClose={() => setCreateVisible(false)}
        footer={
          <>
            <Button variant='text' onClick={() => setCreateVisible(false)}>
              取消
            </Button>
            <Button theme='primary' onClick={onSave}>
              保存
            </Button>
          </>
        }
      >
        <Form form={form} labelWidth={90}>
          <FormItem name='name' label='角色名称' rules={[{ required: true, message: '请填写角色名称' }]}>
            <Input placeholder='如：经办编辑' />
          </FormItem>
          <FormItem name='code' label='角色编码' rules={[{ required: true, message: '请填写角色编码' }]}>
            <Input placeholder='如：editor' />
          </FormItem>
          <FormItem name='note' label='角色说明'>
            <Input placeholder='该角色的职责说明' />
          </FormItem>
          <FormItem name='perms' label='权限配置'>
            <Checkbox.Group>
              {PERM_OPTIONS.map((opt) => (
                <Checkbox key={opt.value} value={opt.value}>
                  {opt.label}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </FormItem>
          <div className={Style.formTip}>「查看」为基底权限，所有角色默认拥有，无需勾选。</div>
        </Form>
      </Dialog>
    </Page>
  );
}
