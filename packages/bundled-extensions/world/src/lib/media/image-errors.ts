// Thrown by an image API when its provider rejects the prompt for safety/moderation.
export class ImageSafetyError extends Error {
  constructor(message = 'IMAGE_SAFETY') {
    super(message);
    this.name = 'ImageSafetyError';
  }
}

export function isImageSafetyError(error: unknown): error is ImageSafetyError {
  return error instanceof ImageSafetyError;
}
