import type { ImagesApi, ProviderImages } from '@earendil-works/pi-ai';

import { FAL_IMAGES_API, generateImagesFal } from './fal';
import { GEMINI_IMAGES_API, generateImagesGemini } from './gemini';
import { OPENAI_IMAGES_API, generateImagesOpenAI } from './openai';
import { XAI_IMAGES_API, generateImagesXai } from './xai';

const IMAGE_APIS: Partial<Record<ImagesApi, ProviderImages>> = {
  [GEMINI_IMAGES_API]: { generateImages: generateImagesGemini },
  [OPENAI_IMAGES_API]: { generateImages: generateImagesOpenAI },
  [XAI_IMAGES_API]: { generateImages: generateImagesXai },
  [FAL_IMAGES_API]: { generateImages: generateImagesFal }
};

export function getImagesApi(api: ImagesApi): ProviderImages {
  const impl = IMAGE_APIS[api];
  if (!impl) {
    throw new Error(`No image generator registered for api: ${api}`);
  }
  return impl;
}
