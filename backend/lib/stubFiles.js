'use strict';
/**
 * stubFiles.js — 示意附件（纯文本占位件）唯一真源
 * 背景：甲方暂未提供正式报名表 / 公文盖章件，为保证“每个岗位、每份公告都有各自独立可下载件、
 *      切换公告下载链接不写死”，系统在缺件目录自动生成一份纯文本示意件。
 * 规则：目录为空才生成；一旦经办上传了真实文件，目录非空即跳过 —— 已传原件 / 数据库优先。
 * api.js 与 scripts/ensure_stubs.js 共用本模块，禁止各处复制内容模板（避免第二真相）。
 */
const fs = require('fs');
const path = require('path');

const STUB_FILE_NAME = '示意附件.txt';

/** 目录为空才写示意件；已有任何文件则不动。返回是否新写 */
function ensureStubFile(uploadDir, relSub, content) {
  try {
    const dir = path.join(uploadDir, relSub);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length) return false;
    fs.writeFileSync(path.join(dir, STUB_FILE_NAME), content, 'utf8');
    return true;
  } catch (e) {
    console.error('[stub]', relSub, e.message.slice(0, 60));
    return false;
  }
}

function positionStubText(p) {
  return [
    '【示意附件 · 系统自动生成，非最终正式表格】',
    `岗位名称：${p.posType || '委员'}`,
    `应选名额：${Number(p.posQuota) || 1} 名`,
    p.posDesc ? `任职要求：${p.posDesc}` : '任职要求：（按本村/社区选举办法填写）',
    '',
    '说明：甲方暂未提供正式报名表，本纯文本文件仅用于打通“资料下载”链路、供经办与选民预览字段。',
    '正式 Word/PDF 报名表到位后，由经办在「岗位管理 → 岗位明细 → 上传报名表」上传，正式文件将与本意示件并列，可自行删除本意示件。',
    `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  ].join('\n');
}

function announcementStubText(a) {
  return [
    '【示意附件 · 公文底稿占位，系统自动生成】',
    `公告编号：${a.annCode || ''}号`,
    `公告标题：${a.annTitle || ''}`,
    a.stageKey ? `所属日程阶段：${a.stageKey}` : '',
    '发布状态：草稿（未发布）',
    '',
    '说明：本文件为纯文本示意件，保证“每份公告各自带一个可下载件”，切换公告时下载链接随该公告独立变化（不再写死）。',
    '正式公文正文请在「活动详情 → 小编工作台」内编辑定稿，并可上传正式 Word/PDF 盖章扫描件替换本意示件。',
    `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  ].filter((x) => x !== '').join('\n');
}

module.exports = { STUB_FILE_NAME, ensureStubFile, positionStubText, announcementStubText };
