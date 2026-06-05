import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow
} from 'kysely';

// Every boolean column must be listed here (post-CamelCasePlugin names) or it arrives as a raw 0/1.
const BOOLEAN_COLUMNS = new Set([
  'emailVerified', // users
  'isAnonymous', // users
  'isPreliminary', // chapterScenes
  'hasVoice', // bookEntities
  'notificationsEnabled', // bookImports
  'autoConfirmProjection', // bookImports
  'isMajority', // bookStyles
  'isSeed', // books query (derived from book_seeds)
  'enabled' // extensions
]);

export class BooleanPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }

  async transformResult(
    args: PluginTransformResultArgs
  ): Promise<QueryResult<UnknownRow>> {
    if (args.result.rows) {
      for (const row of args.result.rows) {
        for (const key of Object.keys(row as Record<string, unknown>)) {
          if (BOOLEAN_COLUMNS.has(key)) {
            const rec = row as Record<string, unknown>;
            rec[key] = rec[key] === 1 ? true : rec[key] === 0 ? false : rec[key];
          }
        }
      }
    }
    return args.result;
  }
}
