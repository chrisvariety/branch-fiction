export interface PipelineWorkerAPI {
  init(args: {
    dbPath: string;
    bridgePort: number;
    bridgeToken: string;
  }): Promise<{ ok: true }>;
  runImport(args: { bookImportId: string; retryFailed?: boolean }): Promise<{
    ok: true;
    status:
      | 'pending'
      | 'projection'
      | 'awaiting_projection'
      | 'extract'
      | 'awaiting_selection'
      | 'arc'
      | 'completed'
      | 'failed';
  }>;
}
