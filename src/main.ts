import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { Workspace } from './workspace';
const root = createRoot(document.getElementById('root')!);
root.render(createElement(Workspace));
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
