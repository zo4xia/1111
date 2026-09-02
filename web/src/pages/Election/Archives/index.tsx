import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Empty, Tag, Tree, Loading, MessagePlugin } from 'tdesign-react';
import Page from 'layouts/components/Page';
import { getArchives, getElections, ArchiveItem, Election } from 'services/electionApi';
import Style from './index.module.less';

interface TNode {
  label: React.ReactNode;
  value: string;
  children?: TNode[];
  item?: ArchiveItem;
}

// 归档来源类型（后端 arch_source_type）→ 中文分组名
const SOURCE_META: Record<string, { label: string; theme: 'primary' | 'warning' | 'success' | 'default' }> = {
  proposal: { label: '提案方案', theme: 'primary' },
  announcement: { label: '公告文件', theme: 'warning' },
  material: { label: '参选人材料', theme: 'success' },
  result: { label: '选举结果', theme: 'default' },
  stage_evidence: { label: '阶段凭证', theme: 'default' },
};
const VIS_LABEL: Record<string, string> = { public: '公开', internal: '内部' };

/** 历史归档：以每一届为文件夹，按归档来源类型分组（全部来自后端真实 archives 表，无 mock） */
export default function Archives() {
  const [list, setList] = useState<ArchiveItem[]>([]);
  const [elections, setElections] = useState<Election[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ArchiveItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ar, el] = await Promise.all([getArchives(), getElections()]);
      setList(ar || []);
      setElections(el || []);
    } catch (e) {
      MessagePlugin.error((e as { message?: string })?.message || '归档数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // elId → 届次信息
  const elMap = useMemo(() => {
    const m = new Map<string, Election>();
    elections.forEach((e) => m.set(e.elId, e));
    return m;
  }, [elections]);

  // 真实数据 → 树：根 → 届 → 来源类型 → 归档项
  const treeData = useMemo<TNode[]>(() => {
    const byEl = new Map<string, ArchiveItem[]>();
    list.forEach((it) => {
      const k = it.elId || 'unknown';
      if (!byEl.has(k)) byEl.set(k, []);
      byEl.get(k)!.push(it);
    });
    const elNodes: TNode[] = [];
    byEl.forEach((items, elId) => {
      const el = elMap.get(elId);
      // 届内按来源类型二级分组
      const byType = new Map<string, ArchiveItem[]>();
      items.forEach((it) => {
        const t = it.archSourceType || 'other';
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t)!.push(it);
      });
      const typeNodes: TNode[] = [];
      byType.forEach((rows, type) => {
        const meta = SOURCE_META[type] || { label: type || '其他', theme: 'default' as const };
        typeNodes.push({
          label: (
            <span>
              <Tag theme={meta.theme} variant='light' size='small'>{meta.label}</Tag>
              <span style={{ marginLeft: 8, color: 'var(--td-text-color-secondary)' }}>{rows.length} 项</span>
            </span>
          ),
          value: `${elId}-${type}`,
          children: rows.map((r) => ({
            label: `📄 ${r.archDisplayName || '未命名归档项'}`,
            value: r.id,
            item: r,
          })),
        });
      });
      elNodes.push({
        label: `📁 ${el?.elTerm || el?.elName || elId} ｜ D日 ${el?.elElectionDate || '未定'}`,
        value: `el-${elId}`,
        children: typeNodes,
      });
    });
    return [{ label: `🗂️ 选举归档（共 ${list.length} 项 · ${byEl.size} 届）`, value: 'root', children: elNodes }];
  }, [list, elMap]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClick = (context: any) => {
    const d = context?.node?.data as TNode;
    if (d?.item) setDetail(d.item);
  };

  const detailEl = detail ? elMap.get(detail.elId) : null;

  return (
    <Page breadcrumbs={['收尾归档', '历史归档']}>
      <div className={Style.treeHead}>
        <span>以每一届建立文件夹，按「提案 / 公告 / 材料 / 结果 / 阶段凭证」分类归档（数据来自后端，真实可溯）</span>
        <Button theme='primary' variant='outline' size='small' loading={loading} onClick={load}>刷新</Button>
      </div>
      <div className={Style.treeBox}>
        {loading ? (
          <Loading text='加载归档台账…' />
        ) : list.length === 0 ? (
          <Empty description='暂无归档记录（提案通过并推进后自动产生）' />
        ) : (
          // 结构与 TDesign TreeOptionData 对齐（label/value/children），展示数据用宽松类型避免递归泛型摩擦
          <Tree data={treeData as unknown as any[]} expandAll hover activable onClick={handleClick} />
        )}
      </div>

      <Dialog header='归档项详情' visible={!!detail} onClose={() => setDetail(null)} footer={false} width={480}>
        {detail && (
          <div className={Style.detailBox}>
            <div className={Style.detailRow}><span className={Style.detailLabel}>名称</span><span>{detail.archDisplayName}</span></div>
            <div className={Style.detailRow}><span className={Style.detailLabel}>所属届次</span><span>{detailEl?.elTerm || detailEl?.elName || detail.elId}</span></div>
            <div className={Style.detailRow}>
              <span className={Style.detailLabel}>来源类型</span>
              <Tag theme={(SOURCE_META[detail.archSourceType]?.theme) || 'default'} variant='light' size='small'>
                {SOURCE_META[detail.archSourceType]?.label || detail.archSourceType}
              </Tag>
            </div>
            <div className={Style.detailRow}>
              <span className={Style.detailLabel}>可见性</span>
              <Tag theme={detail.archVisibility === 'public' ? 'success' : 'default'} variant='outline' size='small'>
                {VIS_LABEL[detail.archVisibility] || detail.archVisibility}
              </Tag>
            </div>
            <div className={Style.detailRow}><span className={Style.detailLabel}>文件版本</span><span>{detail.archFileVersion || 'v1'}</span></div>
            <div className={Style.detailTip}>正式归档文件存储在服务器 uploads 目录，按「归属地 / 届 / 分类」归档；此处为归档台账。</div>
          </div>
        )}
      </Dialog>
    </Page>
  );
}
