'use strict';
// 修复：R1 正则曾从“公告标题 Input”起跨元素误吞，本脚本把该段重建为 标题/正文/落款/附件上传 的正确结构
const fs = require('fs');
const FILE = 'C:/Users/zo4xi/Desktop/3/web/src/pages/Election/ActivityDetail/index.tsx';
let src = fs.readFileSync(FILE, 'utf8');

const re = /[ \t]*\{\/\* 公告正文编辑 \*\/\}[\s\S]*?单份 ≤ 20MB<\/span>\s*<\/div>/;
const hit = (src.match(re) || []).length;
console.log('待修复段命中:', hit);
if (hit !== 1) { console.error('命中异常，未改动。'); process.exit(1); }

const nb = `                  {/* 公告正文编辑 */}
                  <div className={Style.wbField}>
                    <div className={Style.wbLabel}>公告标题</div>
                    <Input value={current.title} onChange={(v) => patch({ title: v as string })} placeholder='公告标题' />
                    <div className={Style.wbLabel} style={{ marginTop: 8 }}>
                      公告正文（「____」为待填项，日期/届次自动代入，可直接改）
                    </div>
                    <Textarea
                      value={current.body}
                      onChange={(v) => patch({ body: v as string })}
                      autosize={{ minRows: 7, maxRows: 14 }}
                    />
                    <div className={Style.wbBtns}>
                      <Button size='small' variant='outline' onClick={() => setPreviewVisible(true)}>
                        预览公文
                      </Button>
                      <Button
                        size='small'
                        variant='outline'
                        theme='warning'
                        onClick={() => {
                          resetNotice(current.id);
                          MessagePlugin.info('已恢复为官方模板默认内容');
                        }}
                      >
                        重置为模板
                      </Button>
                      {current.status === 'published' && (
                        <Tag size='small' theme='success' variant='light'>
                          已发布
                        </Tag>
                      )}
                    </div>
                  </div>

                  {/* 落款 / 成文日期（唯一编辑器，真落库刷新不丢） */}
                  <div className={Style.wbField}>
                    <div className={Style.wbLabel}>落款单位 / 成文日期</div>
                    <div className={Style.wbRow}>
                      <Input size='small' value={current.sign} placeholder='落款单位（默认取官方模板）' onChange={(v) => patch({ sign: v as string })} />
                      <Input size='small' style={{ width: 210 }} value={current.signDate} placeholder='成文日期，如 2026年10月30日' onChange={(v) => patch({ signDate: v as string })} />
                    </div>
                  </div>

                  {/* 本公告附件：真上传 + 每份独立下载（切换公告随之变化，根治链接写死） */}
                  <div className={Style.wbField}>
                    <div className={Style.wbLabel}>
                      本公告附件（{current.files?.length ?? 0} 份 · 每份公告独立，小程序公告下方供下载）
                    </div>
                    <div className={Style.wbRow}>
                      <Button size='small' variant='outline' onClick={() => annFileRef.current?.click()}>
                        上传附件
                      </Button>
                      <span className={Style.wbHint}>pdf / jpg / png / doc / xls / txt，单份 ≤ 20MB</span>
                    </div>`;

src = src.replace(re, nb);
fs.writeFileSync(FILE, src, 'utf8');
console.log('已重建标题/正文/落款/附件上传段。');
