const CHUNKING_REGEXPS = {
  word: /\S+\s+/m,
  line: /\n+/m
};

/**
 * Detects the first chunk in a buffer.
 * Returns the first detected chunk, or null/undefined if no chunk was detected.
 */
export type ChunkDetector = (buffer: string) => string | undefined | null;

export type StreamMessage = {
  id: string;
  type: string;
  content: string;
  [key: string]: unknown;
};

// Buffers and re-chunks CONTENT stream messages word-by-word with delays; adapted from ai-sdk smoothStream.
export function smoothStream({
  delayInMs = 10,
  chunking = 'word'
}: {
  delayInMs?: number | null;
  chunking?: 'word' | 'line' | RegExp | ChunkDetector;
} = {}): TransformStream<StreamMessage, StreamMessage> {
  let detectChunk: ChunkDetector;

  if (typeof chunking === 'function') {
    detectChunk = (buffer) => {
      const match = chunking(buffer);
      if (match == null) return null;
      if (!match.length) {
        throw new Error('Chunking function must return a non-empty string.');
      }
      if (!buffer.startsWith(match)) {
        throw new Error(
          'Chunking function must return a match that is a prefix of the buffer.'
        );
      }
      return match;
    };
  } else {
    const chunkingRegex =
      typeof chunking === 'string' ? CHUNKING_REGEXPS[chunking] : chunking;

    if (!chunkingRegex) {
      throw new Error(
        'chunking must be "word", "line", a RegExp, or a ChunkDetector function.'
      );
    }

    detectChunk = (buffer) => {
      const match = chunkingRegex.exec(buffer);
      if (!match) return null;
      return buffer.slice(0, match.index) + match[0];
    };
  }

  let buffer = '';
  let bufferedMessage: StreamMessage | null = null;

  function flushBuffer(controller: TransformStreamDefaultController<StreamMessage>) {
    if (buffer.length > 0 && bufferedMessage) {
      controller.enqueue({ ...bufferedMessage, content: buffer });
      buffer = '';
      bufferedMessage = null;
    }
  }

  return new TransformStream<StreamMessage, StreamMessage>({
    async transform(message, controller) {
      if (message.type !== 'CONTENT') {
        flushBuffer(controller);
        controller.enqueue(message);
        return;
      }

      buffer += message.content;
      bufferedMessage = message;

      let match;
      while ((match = detectChunk(buffer)) != null) {
        controller.enqueue({ ...bufferedMessage, content: match });
        buffer = buffer.slice(match.length);

        if (delayInMs != null) {
          await new Promise((resolve) => setTimeout(resolve, delayInMs));
        }
      }
    },
    flush(controller) {
      flushBuffer(controller);
    }
  });
}
