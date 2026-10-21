import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryStorage } from './storage/MemoryStorage';
import { App } from './ui/App';
import './ui/theme.css';

// Milestone 2: in-memory storage only. Drive storage arrives with sign-in (milestone 3).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App storage={new MemoryStorage()} />
  </StrictMode>,
);
