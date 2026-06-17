import { registerImagesApiProvider } from '@earendil-works/pi-ai';

import { FAL_IMAGES_API, generateImagesFal } from './fal';
import { GEMINI_IMAGES_API, generateImagesGemini } from './gemini';
import { OPENAI_IMAGES_API, generateImagesOpenAI } from './openai';
import { XAI_IMAGES_API, generateImagesXai } from './xai';

let registered = false;

export function registerImageApis(): void {
  if (registered) return;
  registered = true;

  registerImagesApiProvider({
    api: GEMINI_IMAGES_API,
    generateImages: generateImagesGemini
  });
  registerImagesApiProvider({
    api: OPENAI_IMAGES_API,
    generateImages: generateImagesOpenAI
  });
  registerImagesApiProvider({ api: XAI_IMAGES_API, generateImages: generateImagesXai });
  registerImagesApiProvider({ api: FAL_IMAGES_API, generateImages: generateImagesFal });
}

registerImageApis();
