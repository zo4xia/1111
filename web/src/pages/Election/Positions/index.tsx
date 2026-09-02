import { useState } from 'react';
import { Button, Dialog, Table, Tag, Upload, UploadFile, MessagePlugin } from 'tdesign-react';
import Page from 'layouts/components/Page';
import { useActivities, ElectionActivity } from 'utils/electionStore';
import { uploadPositionFile } from 'services/electionApi';
import { forceResync } from 'utils/liveSync';
import Style from './index.module.less';

/**
 * 岗位管理 · 岗位选举表
 * 数据关联：提案审批通过 → 活动（提案名届），提案的岗位 + 选举方式 → 本（提案名-岗位管理）明细：
 *   岗位需求（岗位/人数/要求）+ 资料信息（报名表/资料下载，后台可上传）
 *   该明细 = 小程序前端「选举方式」页展示内容（同一数据源）
 */
export default function Positions() {
  const activities = useActivities();
  const [current, setCurrent] = useState<ElectionActivity | null>(null);
  const [visible, setVisible] = useState(false);

  const openDetail = (row: ElectionActivity) => {
    setCurrent(row);
    setVisible(true);
  };

  /** 上传岗位资料到后端（真实落库，刷新不丢）；挂到该届首个岗位，资料区汇总各岗位文件 */
  const onUpload = async (files: UploadFile[]) => {
    if (!current || !files.length) return;
    const raws = files.map((f) => f.raw as File).filter(Boolean);
    if (!raws.length) return;
    const posId = current.posts.find((p) => p.posId)?.posId;
    if (!posId) {
      MessagePlugin.error('该届尚未生成岗位，请先让提案审批通过');
      return;
    }
    try {
      await Promise.all(raws.map((f) => uploadPositionFile(posId as string, f)));
      MessagePlugin.success(`已上传 ${raws.length} 份岗位资料`);
      await forceResync().catch(() => undefined);
    } catch (e) {
      MessagePlugin.error('上传失败：' + (e as Error).message);
    }
  };

  /** 弹窗展示始终用最新 store 数据，上传/刷新后立即反映 */
  const detail = activities.find((a) => a.id === current?.id) || current;

  const columns = [
    {
      colKey: 'name',
      title: '届名称（提案名）',
      width: 260,
      cell: ({ row }: { row: ElectionActivity }) => <b>{row.name}</b>,
    },
    { colKey: 'election_mode', title: '选举方式', width: 120 },
    { colKey: 'dday', title: '正式选举日(D)', width: 140 },
    {
      colKey: 'posts',
      title: '岗位需求',
      minWidth: 240,
      cell: ({ row }: { row: ElectionActivity }) => row.posts.map((p) => `${p.position}${p.count}名`).join('、') || '—',
    },
    {
      colKey: 'op',
      title: '操作',
      width: 120,
      cell: ({ row }: { row: ElectionActivity }) => (
        <Button variant='text' theme='primary' onClick={() => openDetail(row)}>
          岗位明细
        </Button>
      ),
    },
  ];

  return (
    <Page breadcrumbs={['选举管理', '岗位管理', '岗位选举表']}>
      <div className={Style.wrap}>
        <div className={Style.pageHead}>
          <div>
            <h2 className={Style.pageTitle}>岗位选举表</h2>
            <div className={Style.sub}>
              数据来自已通过的提案：本（提案名-岗位管理）明细 = 岗位需求 +
              资料信息，也是小程序前端「选举方式」展示内容。
            </div>
          </div>
        </div>
        <div className={Style.tableBox}>
          <Table rowKey='id' columns={columns} data={activities} />
        </div>
      </div>

      {/* 本（提案名-岗位管理）明细 */}
      <Dialog
        header={detail ? `本（${detail.name}-岗位管理）明细` : '岗位明细'}
        visible={visible}
        onClose={() => setVisible(false)}
        width={760}
        footer={null}
      >
        {current && detail && (
          <div className={Style.detail}>
            <div className={Style.meta}>
              选举方式：
              <Tag variant='light' theme='primary'>
                {detail.election_mode}
              </Tag>
              　正式选举日(D)：<b>{detail.dday}</b>
            </div>

            {/* 岗位需求 */}
            <div className={Style.block}>
              <h4>岗位需求</h4>
              <Table
                rowKey='position'
                data={detail.posts}
                columns={[
                  { colKey: 'position', title: '岗位', width: 120 },
                  { colKey: 'count', title: '人数', width: 80, cell: ({ row }: any) => `${row.count} 名` },
                  { colKey: 'requirement', title: '任职要求' },
                ]}
              />
            </div>

            {/* 资料信息（报名表/资料下载） */}
            <div className={Style.block}>
              <h4>资料信息（报名表 / 资料下载）</h4>
              <div className={Style.files}>
                {detail.downloadFiles.length === 0 && (
                  <div className={Style.muted}>暂无资料，请上传报名表/资料文件</div>
                )}
                {detail.downloadFiles.map((f, i) => (
                  <div key={i} className={Style.fileItem}>
                    <span className={Style.fileName}>📄 {f.name}</span>
                    <Button
                      variant='text'
                      size='small'
                      theme='primary'
                      onClick={() => (f.url ? window.open(f.url, '_blank') : MessagePlugin.info('该文件暂无下载地址'))}
                    >
                      下载
                    </Button>
                  </div>
                ))}
              </div>
              <Upload
                theme='file'
                autoUpload={false}
                accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx'
                onChange={onUpload}
                className={Style.upload}
              />
              <div className={Style.hint}>上传报名表/资料文件后，小程序前端「选举方式」页即可下载</div>
            </div>
          </div>
        )}
      </Dialog>
    </Page>
  );
}
