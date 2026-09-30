-- AlterTable
ALTER TABLE `emails` MODIFY `status` ENUM('scheduled', 'delayed', 'sending', 'sent', 'failed', 'cancelled') NOT NULL DEFAULT 'scheduled';
