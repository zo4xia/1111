/**
 * 公告 · 标准公文格式渲染组件（GB/T 9704-2012 党政机关公文格式）
 * 后台公告管理 + 小程序前端共用：标题2号小标宋居中、正文3号仿宋_GB2312、
 * 首行缩进2字符、行距固定、落款（发文机关署名+成文日期）右对齐。
 */
import { AnnouncementTemplate, renderAnnouncementBody, adaptOrgType } from 'utils/announcementTemplates';
import Style from './NoticeDoc.module.less';

interface NoticeDocProps {
  tpl: AnnouncementTemplate;
  orgType: 'village' | 'community';
  fills?: Record<string, string>;
  /** 成文日期（落款日期），如 2026年10月30日 */
  signDate?: string;
}

/** 公文正文段落类型解析：行内空格、首行缩进、居中名单等 */
export default function NoticeDoc({ tpl, orgType, fills, signDate }: NoticeDocProps) {
  const body = adaptOrgType(renderAnnouncementBody(tpl, fills || {}), orgType);
  const lines = body.split('\n');
  const signRaw = tpl.sign || '';
  const sign = adaptOrgType(renderAnnouncementBody({ ...tpl, body: signRaw }, fills || {}), orgType);

  return (
    <div className={Style.doc}>
      {/* 标题：2号小标宋，居中 */}
      <div className={Style.title}>{tpl.title}</div>
      {/* 正文：3号仿宋，首行缩进2字符 */}
      <div className={Style.body}>
        {lines.map((line, i) =>
          line.trim() === '' ? (
            <div key={i} className={Style.blank} />
          ) : (
            <p key={i} className={Style.para}>
              {line}
            </p>
          ),
        )}
      </div>
      {/* 落款：发文机关署名 + 成文日期，右对齐 */}
      <div className={Style.signBlock}>
        <div className={Style.sign}>{sign}</div>
        <div className={Style.signDate}>{signDate || '＿＿＿＿年＿＿月＿＿日'}</div>
      </div>
    </div>
  );
}
