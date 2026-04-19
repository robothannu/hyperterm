/// <reference path="./global.d.ts" />

function initSidebarResize(): void {
  const sidebar = document.getElementById('sidebar')!;
  const handle = document.getElementById('sidebar-resize-handle')!;

  const saved = localStorage.getItem('sidebarWidth');
  if (saved) {
    const w = parseInt(saved, 10);
    if (!isNaN(w)) sidebar.style.width = w + 'px';
  }

  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(150, Math.min(500, startWidth + (ev.clientX - startX)));
      sidebar.style.width = newWidth + 'px';
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebarWidth', String(sidebar.offsetWidth));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}
