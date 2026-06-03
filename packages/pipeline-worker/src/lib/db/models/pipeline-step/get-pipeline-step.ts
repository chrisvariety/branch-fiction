import { getDb } from '../../index';

export async function getPipelineStepsByBookImportId(bookImportId: string) {
  return getDb()
    .selectFrom('pipelineSteps')
    .selectAll()
    .where('bookImportId', '=', bookImportId)
    .execute();
}

export async function getPipelineStepsByBookImportIdAndStepId(
  bookImportId: string,
  stepId: string
) {
  return getDb()
    .selectFrom('pipelineSteps')
    .selectAll()
    .where('bookImportId', '=', bookImportId)
    .where('stepId', '=', stepId)
    .execute();
}
