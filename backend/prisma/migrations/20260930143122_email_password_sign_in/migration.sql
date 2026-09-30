-- AlterTable
ALTER TABLE `users` ADD COLUMN `password_hash` VARCHAR(255) NULL,
    ADD COLUMN `session_version` INTEGER NOT NULL DEFAULT 0,
    MODIFY `google_id` VARCHAR(64) NULL;
