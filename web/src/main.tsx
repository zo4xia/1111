import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import store from 'modules/store';
import App from 'layouts/index';

import 'tdesign-react/es/style/index.css';

import './styles/index.less';

// v6.1 live：已登录则启动即拉后端真实数据（未登录/失败静默走 mock 兜底）
import { syncAll } from './utils/liveSync';
import { currentUser } from './services/electionApi';
if (currentUser()) syncAll();

const env = import.meta.env.MODE || 'development';
const baseRouterName = env === 'site' ? '/starter/react/' : '';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const root = document.getElementById('app')!;

const renderApp = () => {
  ReactDOM.createRoot(root).render(
    <Provider store={store}>
      <BrowserRouter basename={baseRouterName}>
        <App />
      </BrowserRouter>
    </Provider>,
  );
};

renderApp();
