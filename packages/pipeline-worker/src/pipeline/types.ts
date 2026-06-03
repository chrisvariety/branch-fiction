export interface PipelineContext {
  bookImportId: string;
  bookId: string | null;
}

export interface SimpleStep {
  id: string;
  kind: 'simple';
  label: string;
  depends: string[];
  payload: (ctx: PipelineContext) => Record<string, unknown>;
  cleanup?: (bookId: string) => Promise<void>;
}

export interface FanOutStep {
  id: string;
  kind: 'fan-out';
  label: string;
  depends: string[];
  payload: (ctx: PipelineContext) => Record<string, unknown>;
  enumerator: string;
  progressNarrative: string;
  cleanup?: (bookId: string) => Promise<void>;
}

export type Step = SimpleStep | FanOutStep;
