import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';

export function useWindowTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!isTauri() || !title) return;
    void getCurrentWindow().setTitle(title);
  }, [title]);
}
