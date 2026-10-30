/**
 * Eval harness — case registry. Add a new category file here to register it.
 */
import type { EvalCase } from '../types';
import { cases as intentClassification } from './intent-classification';
import { cases as multiTurn } from './multi-turn';
import { cases as toolUse } from './tool-use';
import { cases as fallback } from './fallback';
import { cases as anaphora } from './anaphora';
import { cases as correction } from './correction';
import { cases as liveLlm } from './live-llm';

export const ALL_CASES: EvalCase[] = [
  ...intentClassification,
  ...multiTurn,
  ...toolUse,
  ...fallback,
  ...anaphora,
  ...correction,
  ...liveLlm,
];

const ids = ALL_CASES.map((c) => c.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length > 0) {
  throw new Error(`duplicate eval case ids: ${dupes.join(', ')}`);
}
