import React, { memo } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, Empty } from 'tdesign-react';
import Style from './index.module.less';

/** 未开发页面的占位页：显示路由名 + 建设中 */
export default memo(() => {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() || '';

  return (
    <Card className={Style.placeholder} bordered={false}>
      <Empty description={`【${name}】页面建设中`} />
      <div className={Style.tip}>按「村长仪表盘」靶子结构逐步填充，组件统一用 TDesign</div>
    </Card>
  );
});
