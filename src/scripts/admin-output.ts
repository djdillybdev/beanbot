import {
  formatTimestampWithAge,
} from '../runtime/diagnostics';

export function isJsonOutputRequested(argv = process.argv.slice(2)) {
  return argv.includes('--json');
}

export function printOutput(payload: unknown, lines: string[], json: boolean) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(lines.join('\n'));
}

export function renderSection(title: string, lines: string[]) {
  return [`${title}:`, ...lines.map((line) => `  ${line}`)];
}

export function renderKeyValue(label: string, value: string | number | boolean | null | undefined) {
  return `${label}: ${value ?? 'n/a'}`;
}

export function renderTimestamp(label: string, timestamp: string | null | undefined) {
  return renderKeyValue(label, formatTimestampWithAge(timestamp));
}
