import { EmbedBuilder } from 'discord.js';

import type { GoogleCalendarEventRecord } from '../../domain/event';

export function buildEventAddSuccessEmbed(event: GoogleCalendarEventRecord) {
  return buildEventEmbed('Event Created', event, 'Created in Google Calendar.');
}

export function buildEventEditSuccessEmbed(event: GoogleCalendarEventRecord) {
  return buildEventEmbed('Event Updated', event, 'Updated in Google Calendar.');
}

export function buildEventDeleteSuccessEmbed(event: GoogleCalendarEventRecord) {
  return buildEventEmbed('Event Deleted', event, 'Deleted from Google Calendar.');
}

function buildEventEmbed(title: string, event: GoogleCalendarEventRecord, statusMessage: string) {
  const fields = [
    {
      name: 'Status',
      value: statusMessage,
      inline: false,
    },
    {
      name: 'When',
      value: event.startLabel,
      inline: false,
    },
  ];

  if (event.location) {
    fields.push({
      name: 'Location',
      value: event.location,
      inline: false,
    });
  }

  if (event.description) {
    fields.push({
      name: 'Description',
      value: truncateField(event.description),
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(fields)
    .setTimestamp(new Date());

  if (event.url) {
    embed.setDescription(`[${escapeMarkdown(event.title)}](${event.url})`);
  } else {
    embed.setDescription(escapeMarkdown(event.title));
  }

  return embed;
}

function truncateField(value: string) {
  return value.length <= 1024 ? value : `${value.slice(0, 1021)}...`;
}

function escapeMarkdown(value: string) {
  return value.replaceAll('[', '\\[').replaceAll(']', '\\]');
}
