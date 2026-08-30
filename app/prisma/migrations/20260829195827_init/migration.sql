-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creditLimitMinor" INTEGER NOT NULL,
    "currentExposureMinor" INTEGER NOT NULL,
    "overdueReceivablesMinor" INTEGER NOT NULL,
    "allowedPaymentTerms" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "availableQuantity" INTEGER NOT NULL,
    "earliestHoldExpiry" DATETIME
);

-- CreateTable
CREATE TABLE "SupplierOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "availableQuantity" INTEGER NOT NULL,
    "unitCostMinor" INTEGER NOT NULL,
    "leadDays" INTEGER NOT NULL,
    "optionTtlSeconds" INTEGER NOT NULL,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "DeliveryPlanOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "originWarehouseId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "deliveredQuantity" INTEGER NOT NULL,
    "deliveryDate" DATETIME NOT NULL,
    "costMinor" INTEGER NOT NULL,
    "splitShipment" BOOLEAN NOT NULL,
    "capacityRemaining" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "DealCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fixtureId" TEXT,
    "activeTermsVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DealCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TermsVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parentVersion" INTEGER,
    "source" TEXT NOT NULL,
    "termsHash" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "totalValueMinor" INTEGER NOT NULL,
    "discountBps" INTEGER NOT NULL,
    "paymentTerms" TEXT NOT NULL,
    "deliveryDeadline" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TermsVersion_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DealCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DomainDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "caseVersion" INTEGER NOT NULL,
    "termsHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "evidenceRefs" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "modelId" TEXT NOT NULL,
    "gatewayRequestId" TEXT,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DomainDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DealCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "caseVersion" INTEGER NOT NULL,
    "termsHash" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "resourceRef" TEXT NOT NULL,
    "quantityMinor" INTEGER,
    "limitMinor" INTEGER,
    "status" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "receiptId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reservation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DealCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommitCertificate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "caseVersion" INTEGER NOT NULL,
    "termsHash" TEXT NOT NULL,
    "reservationIds" TEXT NOT NULL,
    "policyVersions" TEXT NOT NULL,
    "validUntil" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "supersedesCertificateId" TEXT,
    "certificateHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" DATETIME,
    "brokenAt" DATETIME,
    CONSTRAINT "CommitCertificate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DealCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActionReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "caseVersion" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL,
    "resourceRef" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReceiptRef" TEXT,
    "responsePayload" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ActionReceipt_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DealCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaseEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "caseVersion" INTEGER NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorRef" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DealCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Counteroffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "sourceTermsVersion" INTEGER NOT NULL,
    "proposedTermsVersion" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "respondedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Counteroffer_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DealCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SandboxOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalValueMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CrmStageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StripeCheckoutMock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "certificateId" TEXT,
    "correctsId" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Operator_email_key" ON "Operator"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPlanOption_planId_key" ON "DeliveryPlanOption"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "TermsVersion_caseId_version_key" ON "TermsVersion"("caseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_idempotencyKey_key" ON "Reservation"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ActionReceipt_idempotencyKey_key" ON "ActionReceipt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CaseEvent_caseId_sequence_key" ON "CaseEvent"("caseId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Counteroffer_tokenHash_key" ON "Counteroffer"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCheckoutMock_stripeSessionId_key" ON "StripeCheckoutMock"("stripeSessionId");
