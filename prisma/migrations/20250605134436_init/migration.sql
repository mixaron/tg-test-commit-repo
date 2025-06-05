/*
  Warnings:

  - You are about to alter the column `chatId` on the `Repository` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Repository" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Repository" ("chatId", "createdAt", "id", "name") SELECT "chatId", "createdAt", "id", "name" FROM "Repository";
DROP TABLE "Repository";
ALTER TABLE "new_Repository" RENAME TO "Repository";
CREATE UNIQUE INDEX "Repository_name_key" ON "Repository"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
