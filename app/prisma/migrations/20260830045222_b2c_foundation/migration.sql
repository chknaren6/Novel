-- AlterTable
ALTER TABLE "SupplierOption" ADD COLUMN "freshnessTier" TEXT;
ALTER TABLE "SupplierOption" ADD COLUMN "lastVerifiedAt" DATETIME;

-- AlterTable
ALTER TABLE "TermsVersion" ADD COLUMN "advanceBps" INTEGER;
ALTER TABLE "TermsVersion" ADD COLUMN "confirmedBuyPriceMinor" INTEGER;

-- CreateTable
CREATE TABLE "MarketplaceBuyer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
