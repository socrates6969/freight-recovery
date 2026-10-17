/**
 * Swappable extraction-provider interface (port of `freight_recovery.extraction.provider`).
 *
 * Contract for every provider, present and future: return an `ExtractionDraft` (allow-listed field
 * keys, values, a source pointer and a confidence per field). The draft always passes through the SAME
 * validators and review flagging as the deterministic provider, and a provider's own (model) confidence
 * can never LOWER the review flags raised by the deterministic checks (unparseable/conflicting/sanitized
 * values and the threshold rule). No provider may perform I/O: providers run inside the parse sandbox.
 */
import { DeterministicProvider } from './deterministic.js';
import type { ExtractionDraft, ParsedText } from './types.js';

export interface ExtractionProvider {
  readonly name: string;
  readonly version: string;
  extract(doc: ParsedText, threshold: number): ExtractionDraft;
}

/** Placeholder for a hosted-model provider: NOT implemented and not reachable from configuration. */
export class LLMExtractionProvider implements ExtractionProvider {
  readonly name = 'llm';
  readonly version = '0';

  extract(): ExtractionDraft {
    throw new Error('NotImplemented: the LLM extraction provider does not exist in this step');
  }
}

/** Resolve a provider by name. `stub` (the Python name) and `deterministic` are the same provider. */
export function getProvider(name = 'deterministic'): ExtractionProvider {
  if (name === 'deterministic' || name === 'stub') return new DeterministicProvider();
  throw new Error('Unknown or unimplemented extraction provider');
}
