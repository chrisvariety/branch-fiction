import { invoke } from '@tauri-apps/api/core';

type AllocatedPort = { port: number; needsClear: boolean };

// Reserves the session's loopback port for an extension; `needsClear` flags a fresh/reassigned origin.
export async function allocateExtensionPort(extensionId: string): Promise<AllocatedPort> {
  return invoke<AllocatedPort>('allocate_extension_port', { extensionId });
}

// Loads the origin's self-clear page in a sandboxed iframe, resolving once wiped or after a timeout.
export function scrubExtensionOrigin(port: number): Promise<void> {
  return new Promise((resolve) => {
    const expected = String(port);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      frame.remove();
      resolve();
    };
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { __bfCleanup?: string } | null;
      if (data && data.__bfCleanup === expected) finish();
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(finish, 3000);

    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.style.display = 'none';
    frame.src = `http://127.0.0.1:${port}/__cleanup`;
    document.body.appendChild(frame);
  });
}
