import { EmbedBuilder } from 'discord.js';

import type { GoogleCalendarEventRecord } from '../../domain/event';
import { formatEventRecordLine, truncateField } from './formatting';

export function buildEventAddSuccessEmbed(event: GoogleCalendarEventRecord) {
  return buildEventEmbed('✅ Event Created', event, 'Saved to Google Calendar.');
}

export function buildEventEditSuccessEmbed(event: GoogleCalendarEventRecord) {
  return buildEventEmbed('✏️ Event Updated', event, 'Changes saved to Google Calendar.');
}

export function buildEventDeleteSuccessEmbed(event: GoogleCalendarEventRecord) {
  return buildEventEmbed('🗑️ Event Deleted', event, 'Removed from Google Calendar.');
}

function buildEventEmbed(title: string, event: GoogleCalendarEventRecord, statusMessage: string) {
  const fields = [
    {
      name: '🗓 Event',
      value: truncateField(formatEventRecordLine(event)),
      inline: false,
    },
  ];

  if (event.location) {
    fields.push({
      name: '📍 Location',
      value: event.location,
      inline: false,
    });
  }

  if (event.description) {
    fields.push({
      name: '📝 Notes',
      value: truncateField(event.description),
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(statusMessage)
    .addFields(fields)
    .setColor(0x3182ce)
    .setTimestamp(new Date());

  return embed;
}
