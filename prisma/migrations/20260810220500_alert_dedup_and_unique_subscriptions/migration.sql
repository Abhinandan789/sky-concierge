-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AlertLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertLog_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AlertSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AlertLog" ("eventType", "id", "message", "sentAt", "subscriptionId") SELECT "eventType", "id", "message", "sentAt", "subscriptionId" FROM "AlertLog";
DROP TABLE "AlertLog";
ALTER TABLE "new_AlertLog" RENAME TO "AlertLog";
CREATE INDEX "AlertLog_subscriptionId_eventType_sentAt_idx" ON "AlertLog"("subscriptionId", "eventType", "sentAt");
CREATE UNIQUE INDEX "AlertLog_subscriptionId_eventType_dateKey_key" ON "AlertLog"("subscriptionId", "eventType", "dateKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AlertSubscription_email_lat_lon_key" ON "AlertSubscription"("email", "lat", "lon");

