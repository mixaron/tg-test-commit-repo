/*
  Warnings:

  - A unique constraint covering the columns `[repositoryId,chatId]` on the table `ChatBinding` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ChatBinding_repositoryId_chatId_key" ON "ChatBinding"("repositoryId", "chatId");
