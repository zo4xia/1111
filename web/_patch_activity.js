'use strict';
// ActivityDetail 剩余重构补丁：每对 [old,new] 必须在文件中恰好命中 1 次，全部命中才写回（原子、可重跑校验）
const fs = require('fs');
const FILE = 'C:/Users/zo4xi/Desktop/3/web/src/pages/Election/ActivityDetail/index.tsx';
const J = (...a) => a.join('\n');
let src = fs.readFileSync(FILE, 'utf8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';
const L = (s) => s.split('\n').join(nl); // 统一成文件换行风格

const pairs = [];

// R0 引入 AnnouncementTemplate 类型
pairs.push([
  "import { getAnnouncement } from 'utils/announcementTemplates';",
  "import { getAnnouncement, type AnnouncementTemplate } from 'utils/announcementTemplates';",
]);

// R-prev previewDocTpl 标注类型
pairs.push([
  J(
    "  const previewDocTpl = activeTpl && current",
    "    ? { ...activeTpl, title: current.title, body: current.body, sign: current.sign || activeTpl.sign || '' }",
    "    : activeTpl;",
  ),
  J(
    "  const previewDocTpl: AnnouncementTemplate | null = activeTpl && current",
    "    ? { ...activeTpl, title: current.title, body: current.body, sign: current.sign || activeTpl.sign || '' }",
    "    : activeTpl;",
  ),
]);

// R1 外链 Input → 格式提示（用唯一 placeholder 的正则，避免缩进逐字匹配问题）
const r1 = { re: /<Input\b[\s\S]*?placeholder='备用：粘贴外链下载地址'[\s\S]*?\/>/, n: "                      <span className={Style.wbHint}>pdf / jpg / png / doc / xls / txt，单份 ≤ 20MB</span>" };

// R2 材料开关前插入“每份附件下载列表”
pairs.push([
  J(
    "                    {stage.material && (",
    "                      <div className={Style.wbRow}>",
    "                        <Switch",
    "                          value={current.openMaterialSubmit}",
  ),
  J(
    "                    {(current.files ?? []).map((f) => (",
    "                      <div key={f.url} className={Style.wbRow}>",
    "                        <a href={f.url} target='_blank' rel='noreferrer'>",
    "                          附件 · {f.name}",
    "                        </a>",
    "                      </div>",
    "                    ))}",
    "                    {stage.material && (",
    "                      <div className={Style.wbRow}>",
    "                        <Switch",
    "                          value={current.openMaterialSubmit}",
  ),
]);

// R3 假按钮 → 诚实跳转（线下办完回对应页回填）
pairs.push([
  J(
    "                    {stage.material && (",
    "                      <Button",
    "                        size='small'",
    "                        variant='outline'",
    "                        // 【数据接入】GET /api/materials?election_id&stage_key=stage.key",
    "                        onClick={() => MessagePlugin.info(`查看「${stage.name}」阶段已上传材料（接材料管理）`)}",
    "                      >",
    "                        查看已上传材料",
    "                      </Button>",
    "                    )}",
    "                    {stage.review && (",
    "                      <Button",
    "                        size='small'",
    "                        variant='outline'",
    "                        // 【数据接入】PUT /api/candidates/result（四轮公示，随 stage.review 轮次）",
    "                        onClick={() => MessagePlugin.info(`更新候选人公示（${stage.review}）`)}",
    "                      >",
    "                        更新候选人展示",
    "                      </Button>",
    "                    )}",
  ),
  J(
    "                    {stage.material && (",
    "                      <Button size='small' variant='outline' onClick={() => navigate('/election/materials')}>",
    "                        前往材料记录（线下审核后回填）",
    "                      </Button>",
    "                    )}",
    "                    {stage.review && (",
    "                      <Button size='small' variant='outline' onClick={() => navigate('/election/candidates')}>",
    "                        前往候选人审核（线下审核后回填：{stage.review}）",
    "                      </Button>",
    "                    )}",
  ),
]);

// R4 岗位区补附件下载 + 补传
pairs.push([
  J(
    "                {activity.posts.map((p) => (",
    "                  <div key={p.position} className={Style.postItem}>",
    "                    <b>{p.position}</b>",
    "                    <span className={Style.postCount}>{p.count} 名</span>",
    "                    <span className={Style.postReq}>{p.requirement || '—'}</span>",
    "                  </div>",
    "                ))}",
  ),
  J(
    "                {activity.posts.map((p) => (",
    "                  <div key={p.position} className={Style.postItem}>",
    "                    <b>{p.position}</b>",
    "                    <span className={Style.postCount}>{p.count} 名</span>",
    "                    <span className={Style.postReq}>{p.requirement || '—'}</span>",
    "                    <div className={Style.postFiles}>",
    "                      {(p.files ?? []).map((f) => (",
    "                        <a key={f.url} href={f.url} target='_blank' rel='noreferrer'>",
    "                          附件 · {f.name}",
    "                        </a>",
    "                      ))}",
    "                      <Button",
    "                        size='small'",
    "                        variant='text'",
    "                        theme='primary'",
    "                        onClick={() => {",
    "                          posUploadId.current = p.posId;",
    "                          posFileRef.current?.click();",
    "                        }}",
    "                      >",
    "                        上传/补传附件",
    "                      </Button>",
    "                    </div>",
    "                  </div>",
    "                ))}",
  ),
]);

// R5 预览 Dialog：裸 <pre> → 标准 NoticeDoc（与公告记录同一组件、同一长相）
pairs.push([
  J(
    "        <div className={Style.noticeBody}>",
    "          <div className={Style.noticeMeta}>",
    "            组织类型：{activity.org_type === 'village' ? '村委会版（原版）' : '居委会版（自动替换称谓）'}｜正式选举日：",
    "            {activity.dday}",
    "          </div>",
    "          <pre className={Style.noticePre}>{previewBody}</pre>",
    "          <div className={Style.noticeHint}>「____」为待填项，仅日期/届次已自动代入；核对后回到右侧发布。</div>",
    "        </div>",
  ),
  J(
    "        {current && activeTpl && (",
    "          <NoticeDoc",
    "            tpl={previewDocTpl as AnnouncementTemplate}",
    "            orgType={activity.org_type}",
    "            fills={tplVars}",
    "            signDate={current.signDate}",
    "          />",
    "        )}",
    "        <div className={Style.noticeHint}>「____」为待填项，仅日期/届次已自动代入；核对后回到右侧发布。</div>",
  ),
]);

// R6 </Page> 前插入两个隐藏文件选择器
pairs.push([
  J(
    "      </Dialog>",
    "    </Page>",
    "  );",
    "}",
  ),
  J(
    "      </Dialog>",
    "",
    "      {/* 隐藏文件选择器：公告附件 / 岗位附件（真上传，每份独立目录） */}",
    "      <input ref={annFileRef} type='file' hidden accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt' onChange={onPickAnnFile} />",
    "      <input ref={posFileRef} type='file' hidden accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt' onChange={onPickPosFile} />",
    "    </Page>",
    "  );",
    "}",
  ),
]);

// 校验 + 应用
let ok = true;
pairs.forEach(([o], i) => {
  const needle = L(o);
  const c = src.split(needle).length - 1;
  if (c !== 1) { ok = false; console.log(`lit#${i} 命中 ${c} 次（需恰好1次），首段: ${needle.slice(0, 60).replace(/\n/g, '⏎')}`); }
});
const r1c = (src.match(r1.re) || []).length;
if (r1c !== 1) { ok = false; console.log(`R1-Input 正则命中 ${r1c} 次（需1次）`); }
if (!ok) { console.error('存在未唯一命中的替换段，未写回任何改动。'); process.exit(1); }
pairs.forEach(([o, n]) => { src = src.replace(L(o), L(n)); });
src = src.replace(r1.re, L(r1.n));
fs.writeFileSync(FILE, src, 'utf8');
console.log(`全部 ${pairs.length + 1} 段精确命中并已写回。`);
