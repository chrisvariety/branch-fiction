import type { ImagesOptions } from '@earendil-works/pi-ai';

import type { AspectRatio } from '../image-types';

// Our one-shot image APIs accept an aspect ratio alongside the standard pi-ai options.
// apiKey is omitted: the Tauri proxy injects real keys and strips any the client sends.
export interface OneShotImageOptions extends Omit<ImagesOptions, 'apiKey'> {
  aspectRatio?: AspectRatio;
}
