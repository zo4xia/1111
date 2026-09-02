import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Radio, Button, MessagePlugin } from 'tdesign-react';
import Page from 'layouts/components/Page';
import {
  ANNOUNCEMENT_TEMPLATES,
  adaptOrgType,
  AnnouncementTemplate,
} from 'utils/announcementTemplates';
import NoticeDoc from 'components/NoticeDoc';
import Style from './index.module.less';

/**
 * 快捷模板：全部换届公文模板集中速查。
 * 选模板 → 切村/社区称谓 → 一键复制全文，回「公告记录」粘贴微调即可发布，避免小编到处找模板。
 */
export default function QuickTemplates() {
  const navigate = useNavigate();
  const [orgType, setOrgType] = useState<'village' | 'community'>('village');
  const [keyword, setKeyword] = useState('');
  const [no, setNo] = useState(ANNOUNCEMENT_TEMPLATES[0].no);

  const list = useMemo(() => {
    const kw = keyword.trim();
    return ANNOUNCEMENT_TEMPLATES.filter((t) => !kw || t.title.includes(kw) || t.no.includes(kw));
  }, [keyword]);

  const tpl: AnnouncementTemplate = ANNOUNCEMENT_TEMPLATES.find((t) => t.no === no) ?? ANNOUNCEMENT_TEMPLATES[0];

  /** 复制标题+正文+落款纯文本，供粘贴到公告编辑器或外部公文 */
  const copyAll = async () => {
    const body = adaptOrgType(tpl.body, orgType);
    const sign = adaptOrgType(tpl.sign, orgType);
    const text = `${tpl.title}\n\n${body}\n\n${sign}\n＿＿＿＿年＿＿月＿＿日`;
    try {
      await navigator.clipboard.writeText(text);
      MessagePlugin.success(`已复制「${tpl.title}」全文，可直接粘贴`);
    } catch {
      MessagePlugin.error('复制失败，请在右侧正文中手动选择复制');
    }
  };

  return (
    <Page>
      <div className={Style.page}>
        <div className={Style.head}>
          <h2 className={Style.title}>公文快捷模板</h2>
          <p className={Style.sub}>
            全部 {ANNOUNCEMENT_TEMPLATES.length} 份换届公文模板集中速查：选模板 → 切村/社区称谓 → 一键复制，回公告记录粘贴微调即可发布。
          </p>
        </div>

        <div className={Style.toolbar}>
          <Radio.Group value={orgType} onChange={(v) => setOrgType(v as 'village' | 'community')}>
            <Radio.Button value='village'>村委会版</Radio.Button>
            <Radio.Button value='community'>居委会版</Radio.Button>
          </Radio.Group>
          <Input
            className={Style.search}
            placeholder='搜索编号或标题，如：选民 / 9'
            value={keyword}
            onChange={(v) => setKeyword(v as string)}
            clearable
          />
          <Button theme='primary' onClick={copyAll}>
            复制全文
          </Button>
          <Button variant='outline' onClick={() => navigate('/election/announcements')}>
            去公告记录编辑
          </Button>
        </div>

        <div className={Style.body}>
          <div className={Style.list}>
            {list.map((t) => (
              <div
                key={t.no}
                className={t.no === no ? Style.itemActive : Style.item}
                onClick={() => setNo(t.no)}
              >
                <span className={Style.no}>{t.no}号</span>
                <span className={Style.itemTitle}>{t.title}</span>
              </div>
            ))}
            {list.length === 0 && <div className={Style.empty}>无匹配模板</div>}
          </div>

          <div className={Style.preview}>
            <NoticeDoc tpl={tpl} orgType={orgType} />
          </div>
        </div>
      </div>
    </Page>
  );
}
