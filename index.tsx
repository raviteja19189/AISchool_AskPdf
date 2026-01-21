
import React from 'react';
import { createRoot } from 'react-dom/client';
import RootLayout from './app/layout';
import Home from './app/page';

const App = () => (
  /* Fix: explicitly pass children prop to satisfy TypeScript requirement for RootLayout */
  <RootLayout children={<Home />} />
);

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
