import { appDataDir, homeDir, join } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { useCallback } from 'react';
import { v7 as uuidv7 } from 'uuid';

const IMAGE_EXT_TO_MEDIA_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp'
};

const COVER_MEDIA_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

export function imageMediaTypeFromPath(path: string): string | null {
  const ext = path.toLowerCase().split('.').pop();
  return ext ? (IMAGE_EXT_TO_MEDIA_TYPE[ext] ?? null) : null;
}

export function coverFileExtForMediaType(mediaType: string): string {
  return COVER_MEDIA_TYPE_TO_EXT[mediaType] ?? '';
}

export type PickedCover = { bytes: Uint8Array; mediaType: string };

export function useCoverPicker() {
  // Opens a native image picker; returns bytes+mediaType or null on cancel/unsupported.
  const pickCoverImage = useCallback(async (): Promise<PickedCover | null> => {
    const home = await homeDir();
    const chosen = await openDialog({
      multiple: false,
      directory: false,
      defaultPath: home,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
    });
    if (!chosen || typeof chosen !== 'string') return null;
    const mediaType = imageMediaTypeFromPath(chosen);
    if (!mediaType) return null;
    const bytes = await readFile(chosen);
    return { bytes, mediaType };
  }, []);

  // Writes cover bytes to storage/covers and returns the file:// URL; pass fileId to key by that id.
  const writeCoverImage = useCallback(
    async (
      bytes: Uint8Array,
      mediaType: string,
      fileId: string = uuidv7()
    ): Promise<string> => {
      const ext = coverFileExtForMediaType(mediaType);
      const dataDir = await appDataDir();
      const coversDir = await join(dataDir, 'storage', 'covers');
      const filePath = await join(coversDir, `${fileId}${ext}`);
      await mkdir(coversDir, { recursive: true });
      await writeFile(filePath, bytes);
      return `file://covers/${fileId}${ext}`;
    },
    []
  );

  return { pickCoverImage, writeCoverImage };
}
