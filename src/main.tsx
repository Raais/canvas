import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { canonicalCanvasAddress } from './project/address';
import '@xyflow/react/dist/style.css';
import './styles/app.css';

const address = canonicalCanvasAddress(location.pathname, location.search, location.hash);
if (address) history.replaceState(history.state, '', address);

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
