import '@fontsource-variable/inter';
import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppRoot } from './app-root';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AppRoot />
    </StrictMode>,
  );
}
