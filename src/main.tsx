import '@fontsource-variable/bricolage-grotesque/wdth.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startUpdates } from './pwa/register';
import { init } from './store/store';
import { App } from './ui/App';
import './ui/styles.css';

void init();
startUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
