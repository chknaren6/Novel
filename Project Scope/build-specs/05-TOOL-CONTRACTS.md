# CommitOS Tool Contracts

## Contract rules

- Every tool is implemented server-side.
- Every call includes case ID, case version, trace ID, role ID, and idempotency key when mutating.
- Read tools return evidence ID and observation timestamp.
- Mutation tools return a persisted receipt.
- The server checks role permission before executing the tool.
- Tool results are typed and schema-validated before returning to the model.
- Models cannot provide provider receipt IDs, policy versions, timestamps, balances, or quantities as trusted input.
- A role may request only its scoped reservation during its bounded run. The server-side tool performs the hold and returns the authoritative receipt; prose or an unexecuted `reservationRequest` never counts as a reservation.
- The coordinator may retry an identical role request with the original role context and idempotency key, but it cannot invent a reservation for that role.

## Common types

```typescript
interface ToolContext {
  caseId: string;
  caseVersion: number;
  termsHash: string;
  role: RoleId;
  traceId: string;
}

interface Evidence<T> {
  evidenceId: string;
  observedAt: string;
  source: string;
  data: T;
}

interface MutationReceipt<T> {
  receiptId: string;
  idempotencyKey: string;
  status: "succeeded" | "failed";
  providerRef: string | null;
  occurredAt: string;
  data: T;
}
```

## Read tools

### `get_deal_context`

**Allowed:** Sales, Risk.

```typescript
getDealContext(ctx: ToolContext): Promise<Evidence<{
  customerId: string;
  strategicTier: "standard" | "strategic";
  currentTerms: DealTerms;
  permittedCommercialLevers: string[];
}>>;
```

### `get_customer_credit`

**Allowed:** Finance, Risk.

```typescript
getCustomerCredit(ctx: ToolContext, customerId: string): Promise<Evidence<{
  creditLimitMinor: number;
  currentExposureMinor: number;
  overdueReceivablesMinor: number;
  allowedPaymentTerms: string[];
  policyVersion: string;
}>>;
```

### `get_inventory_positions`

**Allowed:** Inventory, Logistics, Risk. Logistics receives quantities already cleared for planning, not unrelated warehouse detail.

```typescript
getInventoryPositions(ctx: ToolContext, sku: string): Promise<Evidence<{
  positions: Array<{
    warehouseId: string;
    availableQuantity: number;
    earliestHoldExpiry: string | null;
  }>;
}>>;
```

### `get_supplier_options`

**Allowed:** Procurement, Risk.

```typescript
getSupplierOptions(ctx: ToolContext, input: {
  sku: string;
  requiredQuantity: number;
}): Promise<Evidence<{
  options: Array<{
    supplierId: string;
    availableQuantity: number;
    unitCostMinor: number;
    leadDays: number;
    optionTtlSeconds: number;
    status: "available" | "degraded" | "unavailable";
  }>;
}>>;
```

### `get_delivery_options`

**Allowed:** Logistics, Risk.

```typescript
getDeliveryOptions(ctx: ToolContext, input: {
  backedOrigins: Array<{ originId: string; quantity: number }>;
  destinationId: string;
  deadline: string;
}): Promise<Evidence<{
  plans: Array<{
    planId: string;
    deliveredQuantity: number;
    deliveryDate: string;
    costMinor: number;
    splitShipment: boolean;
  }>;
}>>;
```

### `calculate_deal_economics`

**Allowed:** Finance, Risk, coordinator.

This deterministic tool calculates revenue, cost, contribution, contribution margin, discount cost, deposit amount, and credit exposure. The model supplies no calculated totals.

## Reservation tools

### `hold_credit_envelope`

**Allowed:** Finance only.

Inputs: customer, exposure limit, payment terms, policy version, TTL. The server recomputes exposure and rejects mismatched policy or insufficient capacity.

### `hold_inventory`

**Allowed:** Inventory only.

Inputs: SKU, warehouse, quantity, TTL. The server performs an atomic availability check and decrement-to-held transition.

### `hold_supplier_option`

**Allowed:** Procurement only.

Inputs: supplier, SKU, quantity, maximum unit cost, required lead days, TTL. The server reads current supplier state and refuses an unavailable or changed option.

### `hold_delivery_slot`

**Allowed:** Logistics only.

Inputs: plan ID, quantities, dates, TTL. The server verifies that the plan references backed origins and current slot capacity.

Every successful hold returns:

```typescript
MutationReceipt<{
  reservationId: string;
  domain: "credit" | "inventory" | "supplier" | "logistics";
  resourceRef: string;
  expiresAt: string;
  policyVersion: string;
}>;
```

## Coordinator-only tools

### `prepare_commit_certificate`

Inputs: case version, terms hash, required reservation IDs. Validates the complete reservation set and creates a draft or valid certificate. Models cannot call this tool.

### `commit_order`

Requires a valid certificate ID and certificate hash. Commits sandbox order, allocation, supplier, logistics, CRM, Stripe checkout-release, and outbox actions through idempotent receipts.

### `abort_commitment`

Releases every still-held reservation for a preparation attempt. Repeated calls return existing release receipts.

### `break_certificate`

Requires a persisted disruption event and consumed certificate. Marks the certificate broken without deleting committed history.

### `compensate_commitment`

Executes the compensation matrix from the data specification. It cannot claim success until all required compensation receipts reach a terminal status.

### `verify_terminal_state`

Reads database and adapter state and returns a deterministic expected-versus-actual report. It never asks an LLM to judge correctness.

## Customer and messaging tools

### `create_counteroffer`

**Invoked by:** coordinator using a Sales proposal.

Creates a new terms version and signed buyer link. The offer is explicitly non-binding until accepted and certified.

### `record_buyer_response`

**Invoked by:** signed buyer route.

Accepts one permitted response against the exact active offer and source version. Duplicate responses return the original result.

### `create_deposit_checkout`

**Invoked by:** coordinator during commit.

Creates a Stripe test checkout for the deterministically calculated deposit. Uses case ID and certificate ID in metadata and a stable Stripe idempotency key.

### `send_backed_promise`

**Invoked by:** coordinator after commit receipts pass.

Writes to a persistent message outbox. The message includes certificate ID, terms version, delivery plan, checkout link, and honest limitations.

### `send_correction`

**Invoked by:** coordinator after a broken certificate.

Writes a correction linked to the original message and repaired or escalated state. It never deletes or overwrites the original promise.

## Protected Promise API

These public application commands enforce the product’s core value:

```typescript
sendQuote(caseId, caseVersion, mode: "non_binding_counteroffer" | "backed_commitment")
commitOrder(caseId, caseVersion, certificateId)
```

- `non_binding_counteroffer` requires a current counteroffer but no certificate and must be labeled non-binding.
- `backed_commitment` requires a valid certificate.
- `commitOrder` requires a valid certificate and coordinator authority.
- Any mismatch returns a typed denial reason and creates no business mutation.

## Error contract

All tool failures return:

```typescript
interface ToolError {
  code:
    | "FORBIDDEN_TOOL"
    | "STALE_CASE_VERSION"
    | "TERMS_HASH_MISMATCH"
    | "RESOURCE_UNAVAILABLE"
    | "POLICY_VIOLATION"
    | "RESERVATION_EXPIRED"
    | "IDEMPOTENCY_CONFLICT"
    | "PROVIDER_UNAVAILABLE"
    | "INVALID_INPUT";
  message: string;
  retryable: boolean;
  evidenceRefs: string[];
}
```

Agent-facing messages are concise and exclude secrets. Operator-facing details come from persisted evidence and receipts.
