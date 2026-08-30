/*
  Warnings:

  - Added the required column `idempotencyKey` to the `CommitCertificate` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CommitCertificate" (
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
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" DATETIME,
    "brokenAt" DATETIME,
    CONSTRAINT "CommitCertificate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DealCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CommitCertificate" ("brokenAt", "caseId", "caseVersion", "certificateHash", "consumedAt", "createdAt", "id", "policyVersions", "reservationIds", "status", "supersedesCertificateId", "termsHash", "validUntil") SELECT "brokenAt", "caseId", "caseVersion", "certificateHash", "consumedAt", "createdAt", "id", "policyVersions", "reservationIds", "status", "supersedesCertificateId", "termsHash", "validUntil" FROM "CommitCertificate";
DROP TABLE "CommitCertificate";
ALTER TABLE "new_CommitCertificate" RENAME TO "CommitCertificate";
CREATE UNIQUE INDEX "CommitCertificate_idempotencyKey_key" ON "CommitCertificate"("idempotencyKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
