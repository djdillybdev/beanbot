import { EmbedBuilder } from 'discord.js';

import type { AppConfig } from '../../config';
import type { DailyReviewResult, HabitReviewResult, PeriodReviewResult, UpcomingTaskReviewResult } from '../../domain/daily-review';
import { formatLocalDayLabel, formatLocalTime, getLocalDateParts } from '../../utils/time';
import {
  buildCompletedTaskField,
  buildEventField,
  buildMetricField,
  buildProviderStatusField,
  buildTaskField,
  chunkSections,
  getSummaryColor,
  renderDayGroup,
  truncateField,
} from './formatting';

export function buildTodayEmbeds(config: AppConfig, review: DailyReviewResult) {
  const todayKey = getLocalDateParts(new Date(), config.timezone).date;

  return [
    new EmbedBuilder()
      .setTitle(`📅 Today · ${formatLocalDayLabel(todayKey, config.timezone)}`)
      .setDescription(`Current day in ${config.timezone}`)
      .addFields(
        buildTaskField('⏰ Overdue', review.overdueTasks, 'Nothing overdue.'),
        buildTaskField('📝 Tasks', review.dueTodayTasks, 'No tasks due today.'),
        buildEventField('🗓 Events', review.todayEvents, 'No events today.'),
        buildProviderStatusField(review.todoistStatus, review.googleCalendarStatus),
      )
      .setColor(
        getSummaryColor({
          overdueCount: review.overdueTasks.length,
          primaryCount: review.dueTodayTasks.length + review.todayEvents.length,
        }),
      )
      .setTimestamp(new Date()),
  ];
}

export function buildWeekEmbeds(config: AppConfig, review: PeriodReviewResult) {
  return buildPeriodEmbeds('📆 Week', 'Next 7 days', config.timezone, review);
}

export function buildMonthEmbeds(config: AppConfig, review: PeriodReviewResult) {
  return buildPeriodEmbeds('🗓 Month', 'Next 31 days', config.timezone, review);
}

export function buildHabitsEmbeds(config: AppConfig, review: HabitReviewResult) {
  return buildHabitEmbeds('🌱 Habits', config.timezone, review, new Date(), false);
}

export function buildTodayStatusEmbeds(
  config: AppConfig,
  dateKey: string,
  review: DailyReviewResult,
  updatedAt: Date,
) {
  return [
    new EmbedBuilder()
      .setTitle(`📅 Today Status · ${formatLocalDayLabel(dateKey, config.timezone)}`)
      .setDescription(`Live day card in ${config.timezone}`)
      .addFields(
        buildTaskField('⏰ Overdue', review.overdueTasks, 'Nothing overdue.'),
        buildTaskField('📝 Tasks', review.dueTodayTasks, 'No tasks due today.'),
        buildCompletedTaskField('✅ Completed', review.completedTodayTasks, 'Nothing completed yet.'),
        buildEventField('🗓 Events', review.todayEvents, 'No events today.'),
        buildProviderStatusField(review.todoistStatus, review.googleCalendarStatus),
      )
      .setColor(
        getSummaryColor({
          overdueCount: review.overdueTasks.length,
          primaryCount: review.dueTodayTasks.length + review.todayEvents.length,
          completedCount: review.completedTodayTasks.length,
        }),
      )
      .setFooter({ text: `Updated ${formatLocalTime(updatedAt, config.timezone)}` }),
  ];
}

export function buildWeekStatusEmbeds(
  config: AppConfig,
  periodKey: string,
  review: PeriodReviewResult,
  updatedAt: Date,
) {
  return buildLivePeriodEmbeds(
    `📆 Week Status · ${formatLocalDayLabel(periodKey, config.timezone)}`,
    config.timezone,
    review,
    updatedAt,
    true,
  );
}

export function buildMonthStatusEmbeds(
  config: AppConfig,
  periodKey: string,
  review: PeriodReviewResult,
  updatedAt: Date,
) {
  return buildLivePeriodEmbeds(
    `🗓 Month Status · ${periodKey}`,
    config.timezone,
    review,
    updatedAt,
    false,
  );
}

export function buildHabitsStatusEmbeds(
  config: AppConfig,
  periodKey: string,
  review: HabitReviewResult,
  updatedAt: Date,
) {
  return buildHabitEmbeds(
    `🌱 Habit Status · ${formatLocalDayLabel(periodKey, config.timezone)}`,
    config.timezone,
    review,
    updatedAt,
    true,
  );
}

export function buildUpcomingStatusEmbeds(
  config: AppConfig,
  _periodKey: string,
  review: UpcomingTaskReviewResult,
  updatedAt: Date,
) {
  const totalTasks = review.dayGroups.reduce((count, group) => count + group.tasks.length, 0);
  const color = getSummaryColor({ primaryCount: totalTasks });
  const header = new EmbedBuilder()
    .setTitle('📌 Upcoming Tasks · Next 14 Days')
    .setDescription(`Rolling 14-day task view in ${config.timezone}`)
    .addFields(buildProviderStatusField(review.todoistStatus))
    .setColor(color)
    .setFooter({ text: `Last changed at ${formatLocalTime(updatedAt, config.timezone)}` });

  const sections = review.dayGroups.map((group) => renderDayGroup(group, { taskOnly: true }));
  const chunks = chunkSections(sections, 3500);

  if (chunks.length === 0) {
    header.addFields({
      name: '📌 Upcoming',
      value: 'No upcoming tasks in the next 14 days.',
      inline: false,
    });

    return [header];
  }

  const embeds = [header];

  for (const [index, chunk] of chunks.entries()) {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? '📌 Upcoming Schedule' : '📌 Upcoming Schedule (cont.)')
        .setDescription(chunk)
        .setColor(color)
        .setFooter({ text: `Updated ${formatLocalTime(updatedAt, config.timezone)}` }),
    );
  }

  return embeds;
}

function buildLivePeriodEmbeds(
  title: string,
  timezone: string,
  review: PeriodReviewResult,
  updatedAt: Date,
  includeCompleted: boolean,
) {
  const color = getSummaryColor({
    overdueCount: review.overdueTasks.length,
    primaryCount: review.dayGroups.reduce((count, group) => count + group.tasks.length + group.events.length, 0),
    completedCount: review.completedTasks?.length ?? 0,
  });
  const header = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`Current planning window in ${timezone}`)
    .addFields(
      buildTaskField('⏰ Overdue', review.overdueTasks, 'Nothing overdue.'),
      ...(includeCompleted
        ? [buildCompletedTaskField('✅ Completed', review.completedTasks ?? [], 'Nothing completed yet.')]
        : []),
      buildProviderStatusField(review.todoistStatus, review.googleCalendarStatus),
    )
    .setColor(color)
    .setFooter({ text: `Updated ${formatLocalTime(updatedAt, timezone)}` });

  const sections = review.dayGroups.map((group) => renderDayGroup(group));
  const chunks = chunkSections(sections, 3500);

  if (chunks.length === 0) {
    header.addFields({
      name: '📌 Upcoming',
      value: 'No upcoming tasks or events in this period.',
      inline: false,
    });

    return [header];
  }

  const embeds = [header];

  for (const [index, chunk] of chunks.entries()) {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? `${title} Schedule` : `${title} Schedule (cont.)`)
        .setDescription(chunk)
        .setColor(color)
        .setFooter({ text: `Last changed at ${formatLocalTime(updatedAt, timezone)}` }),
    );
  }

  return embeds;
}

function buildPeriodEmbeds(
  title: string,
  windowLabel: string,
  timezone: string,
  review: PeriodReviewResult,
) {
  const color = getSummaryColor({
    overdueCount: review.overdueTasks.length,
    primaryCount: review.dayGroups.reduce((count, group) => count + group.tasks.length + group.events.length, 0),
  });
  const header = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`${windowLabel} in ${timezone}`)
    .addFields(
      buildTaskField('⏰ Overdue', review.overdueTasks, 'Nothing overdue.'),
      buildProviderStatusField(review.todoistStatus, review.googleCalendarStatus),
    )
    .setColor(color)
    .setTimestamp(new Date());

  const sections = review.dayGroups.map((group) => renderDayGroup(group));
  const chunks = chunkSections(sections, 3500);

  if (chunks.length === 0) {
    header.addFields({
      name: '📌 Upcoming',
      value: 'No upcoming tasks or events in this period.',
      inline: false,
    });

    return [header];
  }

  const embeds = [header];

  for (const [index, chunk] of chunks.entries()) {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? `${title} Schedule` : `${title} Schedule (cont.)`)
        .setDescription(chunk)
        .setColor(color)
        .setTimestamp(new Date()),
    );
  }

  return embeds;
}

function buildHabitEmbeds(
  title: string,
  timezone: string,
  review: HabitReviewResult,
  updatedAt: Date,
  isLive: boolean,
) {
  const color = getSummaryColor({
    overdueCount: review.overdueHabits.length,
    primaryCount: review.dueTodayHabits.length,
    completedCount: review.completedTodayHabits.length,
  });

  const header = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`Daily habit tracker in ${timezone}`)
    .addFields(
      buildMetricField('Tracked', String(review.stats.trackedHabitCount)),
      buildMetricField('Done Today', String(review.stats.completedTodayCount)),
      buildMetricField('Left Today', String(review.stats.remainingTodayCount)),
      buildMetricField('Best Streak', String(review.stats.longestCurrentStreak)),
      buildTaskField('⏰ Overdue Habits', review.overdueHabits, 'No overdue habits.'),
      buildTaskField('🌱 Habits Left Today', review.dueTodayHabits, 'All habits are done for today.'),
      buildCompletedTaskField('✅ Done Today', review.completedTodayHabits, 'No completed habits yet.'),
      {
        name: '🔥 Streaks',
        value: truncateField(
          review.streaks.length > 0
            ? review.streaks
                .map(
                  (streak) =>
                    `${streak.completedToday ? '✅' : '⬜'} ${streak.title} · ${streak.currentStreak} day${streak.currentStreak === 1 ? '' : 's'}`,
                )
                .join('\n')
            : 'No tracked habit history yet.',
        ),
        inline: false,
      },
      buildProviderStatusField(review.todoistStatus),
    )
    .setColor(color);

  if (isLive) {
    header.setFooter({ text: `Updated ${formatLocalTime(updatedAt, timezone)}` });
  } else {
    header.setTimestamp(updatedAt);
  }

  return [header];
}
