import { execFile } from 'child_process';

/**
 * Short date and time patterns in Windows / .NET notation (`dd.MM.yyyy`, `HH:mm`, `h:mm tt`).
 * VS Code webviews format dates in the editor's display language, which often differs from the
 * regional format the user picked in the OS, so the patterns are resolved here from the OS.
 */
export interface DateFormat {
  date: string;
  time: string;
}

/**
 * Formats `date` with a Windows-style pattern. Self-contained (no outside references) because its
 * source is also injected into the dashboard webview script.
 */
export function formatPattern(date: Date, pattern: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const h = date.getHours();
  const h12 = h % 12 || 12;
  return pattern.replace(/'([^']*)'|yyyy|yy|y|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt|t/g, (tok, lit) => {
    if (lit !== undefined) { return lit; }
    switch (tok) {
      case 'yyyy': return pad(date.getFullYear(), 4);
      case 'yy': return pad(date.getFullYear() % 100);
      case 'y': return String(date.getFullYear() % 100);
      case 'MMMM': return date.toLocaleString(undefined, { month: 'long' });
      case 'MMM': return date.toLocaleString(undefined, { month: 'short' });
      case 'MM': return pad(date.getMonth() + 1);
      case 'M': return String(date.getMonth() + 1);
      case 'dddd': return date.toLocaleString(undefined, { weekday: 'long' });
      case 'ddd': return date.toLocaleString(undefined, { weekday: 'short' });
      case 'dd': return pad(date.getDate());
      case 'd': return String(date.getDate());
      case 'HH': return pad(h);
      case 'H': return String(h);
      case 'hh': return pad(h12);
      case 'h': return String(h12);
      case 'mm': return pad(date.getMinutes());
      case 'm': return String(date.getMinutes());
      case 'ss': return pad(date.getSeconds());
      case 's': return String(date.getSeconds());
      case 'tt': return h < 12 ? 'AM' : 'PM';
      default: return h < 12 ? 'A' : 'P';
    }
  });
}

/** Day + month only (for chart labels): drops the year and its separator, keeping the OS order. */
export function dayMonthPattern(datePattern: string): string {
  const stripped = datePattern
    .replace(/^y+[^dMy']*/, '')
    .replace(/[^dMy']*y+$/, '')
    .replace(/[^dMy']*y+/, '');
  return /d/.test(stripped) && /M/.test(stripped) ? stripped : 'dd.MM';
}

/** Derives patterns from an Intl locale (e.g. `de-DE` → `dd.MM.yyyy` / `HH:mm`). */
export function intlDateFormat(locale?: string): DateFormat {
  const sample = new Date(2006, 0, 2, 15, 4);
  const lit = (v: string) => /[A-Za-z']/.test(v) ? `'${v.replace(/'/g, '')}'` : v;
  let date = 'yyyy-MM-dd';
  let time = 'HH:mm';
  try {
    date = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(sample)
      .map(p => p.type === 'year' ? 'yyyy' : p.type === 'month' ? 'MM' : p.type === 'day' ? 'dd' : lit(p.value)).join('');
    const tf = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    const hour12 = tf.resolvedOptions().hour12;
    time = tf.formatToParts(sample)
      .map(p => p.type === 'hour' ? (hour12 ? 'h' : 'HH') : p.type === 'minute' ? 'mm' : p.type === 'dayPeriod' ? 'tt' : lit(p.value))
      .join('');
  } catch { /* unknown locale: keep ISO */ }
  return { date, time };
}

/** Parses `reg query` output for one value of `HKCU\Control Panel\International`. */
export function parseRegValue(output: string, name: string): string | undefined {
  const m = new RegExp(`^\\s*${name}\\s+REG_SZ\\s+(.+?)\\s*$`, 'mi').exec(output);
  return m?.[1] || undefined;
}

/** POSIX locale (`de_DE.UTF-8`, `en_GB@euro`) → BCP 47 tag (`de-DE`), if Intl knows it. */
export function posixToBcp47(value: string | undefined): string | undefined {
  const tag = value?.split(/[.@]/)[0].replace(/_/g, '-');
  if (!tag || tag === 'C' || tag === 'POSIX') { return undefined; }
  try { return Intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : undefined; } catch { return undefined; }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** Resolves the OS regional date / time format, falling back to the process locale. */
export async function systemDateFormat(platform = process.platform, env = process.env): Promise<DateFormat> {
  const envLocale = posixToBcp47(env.LC_ALL || env.LC_TIME || env.LANG);
  if (platform === 'win32') {
    const key = 'HKCU\\Control Panel\\International';
    const [date, time, locale] = await Promise.all(['sShortDate', 'sShortTime', 'LocaleName']
      .map(v => run('reg', ['query', key, '/v', v]).then(out => parseRegValue(out, v))));
    const fallback = intlDateFormat(locale);
    return { date: date ?? fallback.date, time: time ?? fallback.time };
  }
  if (platform === 'darwin') {
    const [appleLocale, force24] = await Promise.all([
      run('defaults', ['read', '-g', 'AppleLocale']),
      run('defaults', ['read', '-g', 'AppleICUForce24HourTime']),
    ]);
    const fmt = intlDateFormat(envLocale ?? posixToBcp47(appleLocale.trim()));
    if (force24.trim() === '1') { fmt.time = 'HH:mm'; }
    return fmt;
  }
  return intlDateFormat(envLocale);
}
