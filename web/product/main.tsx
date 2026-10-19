import '../src/product/styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ProductApp } from '../src/product/ProductApp';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ProductApp />
    </StrictMode>,
  );
}