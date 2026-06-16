export type AspectRatio = '16:9' | '9:16' | '3:4' | '1:1';

export interface InlineImage {
  mimeType: string;
  // base64-encoded
  data: string;
}

export interface GeneratedImage {
  mimeType: string;
  data: Uint8Array;
}
