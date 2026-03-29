CREATE UNIQUE INDEX IF NOT EXISTS `period_status_message_type_period_idx`
ON `period_status_message` (`status_type`, `period_key`);

CREATE INDEX IF NOT EXISTS `period_status_message_channel_type_idx`
ON `period_status_message` (`channel_id`, `status_type`);
