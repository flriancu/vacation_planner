import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The theme tokens first: the app's own styles (imported by the components) override them where they need to.
import './ui/theme.css';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Root } from './ui/Root';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
