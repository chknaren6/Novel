import { FakeModelGateway } from "./fakeGateway";
import type { ModelGateway } from "./modelGateway";
import { pickDeskDemoScript } from "./deskDemoScripts";

// Optional, explicitly opt-in local preview path (DESK_MODEL_MODE=demo in .env) — never
// the default. It exists so the Commitment Desk UI can be exercised end-to-end without a
// working OpenAI key, using the same honest, test-verified role behavior as
// deskDemoDefinitions.test.ts, not a fresh made-up script. The default path (unset or
// DESK_MODEL_MODE=live) is untouched: the submit route still builds a real
// OpenAIModelGateway straight from .env, exactly as before.
//
// Returns null (rather than a gateway that always answers "unavailable") for any sku
// outside the three seeded demo fixtures, so a caller can fail loudly instead of silently
// producing a meaningless all-unavailable run for a case this stand-in was never built to
// answer for.
export function createDeskDemoGateway(sku: string): ModelGateway | null {
  const script = pickDeskDemoScript(sku);
  if (!script) return null;
  return new FakeModelGateway(script);
}
