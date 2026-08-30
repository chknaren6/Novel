-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DealCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fixtureId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'b2b',
    "activeTermsVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DealCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DealCase" ("activeTermsVersion", "companyId", "createdAt", "createdBy", "customerId", "fixtureId", "id", "status", "updatedAt") SELECT "activeTermsVersion", "companyId", "createdAt", "createdBy", "customerId", "fixtureId", "id", "status", "updatedAt" FROM "DealCase";
DROP TABLE "DealCase";
ALTER TABLE "new_DealCase" RENAME TO "DealCase";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
