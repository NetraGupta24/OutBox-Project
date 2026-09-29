-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `google_id` VARCHAR(64) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `avatar_url` VARCHAR(1024) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_google_id_key`(`google_id`),
    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `senders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `email` VARCHAR(320) NOT NULL,
    `display_name` VARCHAR(255) NOT NULL,
    `smtp_host` VARCHAR(255) NOT NULL,
    `smtp_port` INTEGER NOT NULL,
    `smtp_secure` BOOLEAN NOT NULL DEFAULT false,
    `smtp_user` VARCHAR(320) NOT NULL,
    `smtp_pass_enc` TEXT NOT NULL,
    `hourly_limit` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `senders_email_key`(`email`),
    INDEX `senders_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaigns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `sender_id` INTEGER NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `body_html` MEDIUMTEXT NOT NULL,
    `body_text` TEXT NOT NULL,
    `start_at` DATETIME(3) NOT NULL,
    `delay_ms` INTEGER NOT NULL,
    `hourly_limit` INTEGER NOT NULL,
    `total` INTEGER NOT NULL,
    `idempotency_key` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `campaigns_user_id_created_at_idx`(`user_id`, `created_at`),
    UNIQUE INDEX `campaigns_user_id_idempotency_key_key`(`user_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaign_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `sender_id` INTEGER NOT NULL,
    `recipient` VARCHAR(320) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `scheduled_at` DATETIME(3) NOT NULL,
    `status` ENUM('scheduled', 'delayed', 'sending', 'sent', 'failed') NOT NULL DEFAULT 'scheduled',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `locked_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `message_id` VARCHAR(255) NULL,
    `preview_url` VARCHAR(1024) NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `emails_user_id_status_scheduled_at_idx`(`user_id`, `status`, `scheduled_at`),
    INDEX `emails_status_scheduled_at_idx`(`status`, `scheduled_at`),
    INDEX `emails_sender_id_idx`(`sender_id`),
    UNIQUE INDEX `emails_campaign_id_recipient_key`(`campaign_id`, `recipient`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `slack_integrations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `team_id` VARCHAR(64) NOT NULL,
    `team_name` VARCHAR(255) NOT NULL,
    `channel` VARCHAR(255) NOT NULL,
    `webhook_url_enc` TEXT NOT NULL,
    `connected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `slack_integrations_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `senders` ADD CONSTRAINT `senders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `senders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `emails` ADD CONSTRAINT `emails_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `emails` ADD CONSTRAINT `emails_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `emails` ADD CONSTRAINT `emails_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `senders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `slack_integrations` ADD CONSTRAINT `slack_integrations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
