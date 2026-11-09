import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { registerServiceWorker } from './client/pwa';
import { PwaInstall } from './components/PwaInstall';
import { ErrorBoundary } from './components/ErrorBoundary';

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <PwaInstall />
    </ErrorBoundary>
  </React.StrictMode>
);
