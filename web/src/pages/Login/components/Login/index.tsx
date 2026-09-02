import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Form,
  type FormInstanceFunctions,
  Input,
  MessagePlugin,
  Select,
  type SubmitContext,
} from 'tdesign-react';
import { BrowseIcon, BrowseOffIcon, LockOnIcon, UserIcon } from 'tdesign-icons-react';
import classnames from 'classnames';
import { apiLogin, apiOrgs, saveLogin, type Org } from 'services/electionApi';
import { syncAll } from 'utils/liveSync';

import Style from './index.module.less';

const { FormItem } = Form;

/**
 * 登录（v6.1：真调后端 POST /api/login，JWT 存 cxq_token）
 * 演示账号已预填：13800000001 / 123456 / 平台管理（张主任·platform_admin）
 */
export default function Login() {
  const [showPsw, toggleShowPsw] = useState(false);
  const [orgs, setOrgs] = useState<Array<{ label: string; value: string }>>([
    { label: '平台管理', value: 'boss' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormInstanceFunctions>();
  const navigate = useNavigate();

  // 拉真实组织列表（失败兜底四项，不白屏）
  useEffect(() => {
    let alive = true;
    apiOrgs()
      .then((list: Org[]) => {
        if (!alive || !list?.length) return;
        const opts = [{ label: '平台管理', value: 'boss' }, ...list
          .filter((o) => o.orgId !== 'boss')
          .map((o) => ({ label: `${o.town ? o.town + ' · ' : ''}${o.name}`, value: o.orgId }))];
        setOrgs(opts);
      })
      .catch(() => {
        if (alive) setOrgs([
          { label: '平台管理', value: 'boss' },
          { label: '涧口社区居委会', value: 's-jiankou' },
          { label: '延寿社区居委会', value: 'v-yanshou' },
          { label: '北磨社区居委会', value: 's-beimo' },
        ]);
      });
    return () => { alive = false; };
  }, []);

  const onSubmit = async (e: SubmitContext) => {
    if (e.validateResult !== true) return;
    const formValue = formRef.current?.getFieldsValue?.(true) || {};
    const { orgId, phone, password } = formValue;
    if (!orgId || !phone || !password) {
      MessagePlugin.error('请完整填写归属地、手机号和密码');
      return;
    }
    setSubmitting(true);
    try {
      const { token, user } = await apiLogin(String(phone), String(password), String(orgId));
      saveLogin(token, user);
      MessagePlugin.success(`欢迎，${user.name || user.phone} · ${user.orgName || user.orgId}`);
      syncAll(); // 后台拉真实数据灌入各 store（不阻塞跳转）
      navigate('/election/home');
    } catch (err) {
      const e2 = err as Error;
      MessagePlugin.error(e2.message?.includes('归属地') ? e2.message : `登录失败：${e2.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Form ref={formRef} className={classnames(Style.itemContainer)} labelWidth={0} onSubmit={onSubmit}>
        {/* ① 归属地（真实 123 组织） */}
        <FormItem
          name='orgId'
          initialData='boss'
          rules={[{ required: true, message: '请选择归属地', type: 'error' }]}
        >
          <Select size='large' placeholder='请选择归属地（村/社区）' options={orgs} filterable />
        </FormItem>

        {/* ② 手机号（演示账号预填） */}
        <FormItem
          name='phone'
          initialData='13800000001'
          rules={[{ required: true, message: '手机号必填', type: 'error' }]}
        >
          <Input size='large' maxlength={11} placeholder='请输入手机号（管理员 13800000001）' prefixIcon={<UserIcon />} />
        </FormItem>

        {/* ③ 密码 */}
        <FormItem name='password' initialData='123456' rules={[{ required: true, message: '密码必填', type: 'error' }]}>
          <Input
            size='large'
            type={showPsw ? 'text' : 'password'}
            clearable
            placeholder='请输入登录密码（演示 123456）'
            prefixIcon={<LockOnIcon />}
            suffixIcon={
              showPsw ? (
                <BrowseIcon onClick={() => toggleShowPsw((current) => !current)} />
              ) : (
                <BrowseOffIcon onClick={() => toggleShowPsw((current) => !current)} />
              )
            }
          />
        </FormItem>

        <FormItem className={Style.btnContainer}>
          <Button block size='large' type='submit' loading={submitting}>
            登录
          </Button>
        </FormItem>
      </Form>
    </div>
  );
}
