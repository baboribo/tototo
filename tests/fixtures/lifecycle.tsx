import { createRoot, type Root } from 'react-dom/client';
import { Workspace } from '../../src/workspace';

let root: Root | undefined;
document.querySelector('#mount-workspace')!.addEventListener('click', () => {
  if (root) return;
  root = createRoot(document.querySelector('#fixture-root')!);
  root.render(<Workspace />);
});
document.querySelector('#unmount-workspace')!.addEventListener('click', () => {
  root?.unmount();
  root = undefined;
});
