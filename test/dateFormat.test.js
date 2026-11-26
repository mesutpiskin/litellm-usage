// Dates follow the OS regional format (e.g. dd.MM.yyyy + 24h), not VS Code's display language.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatPattern, dayMonthPattern, intlDateFormat, parseRegValue, posixToBcp47, systemDateFormat } = require('../out/dateFormat.js');

const d = new Date(2026, 10, 5, 14, 7, 9); // 5 Nov 2026, 14:07:09 local

test('formats Windows-style patterns', () => {
  assert.equal(formatPattern(d, 'dd.MM.yyyy HH:mm'), '05.11.2026 14:07');
  assert.equal(formatPattern(d, 'dd/MM/yyyy HH:mm:ss'), '05/11/2026 14:07:09');
  assert.equal(formatPattern(d, 'M/d/yyyy h:mm tt'), '11/5/2026 2:07 PM');
  assert.equal(formatPattern(d, "yyyy-MM-dd'T'HH"), '2026-11-05T14');
  assert.equal(formatPattern(new Date(2026, 0, 1, 0, 5), 'hh:mm tt'), '12:05 AM');
});

test('chart labels keep day/month order without the year', () => {
  assert.equal(dayMonthPattern('dd.MM.yyyy'), 'dd.MM');
  assert.equal(dayMonthPattern('dd/MM/yyyy'), 'dd/MM');
  assert.equal(dayMonthPattern('M/d/yyyy'), 'M/d');
  assert.equal(dayMonthPattern('yyyy-MM-dd'), 'MM-dd');
  assert.equal(dayMonthPattern('d. M. yyyy'), 'd. M');
});

test('derives patterns from an Intl locale', () => {
  assert.deepEqual(intlDateFormat('de-DE'), { date: 'dd.MM.yyyy', time: 'HH:mm' });
  assert.deepEqual(intlDateFormat('en-GB'), { date: 'dd/MM/yyyy', time: 'HH:mm' });
  assert.equal(intlDateFormat('en-US').date, 'MM/dd/yyyy');
  assert.match(intlDateFormat('en-US').time, /^h:mm\stt$/);
});

test('reads Windows regional values and POSIX locales', () => {
  const out = '\r\nHKEY_CURRENT_USER\Control Panel\International\r\n    sShortDate    REG_SZ    dd.MM.yyyy\r\n\r\n';
  assert.equal(parseRegValue(out, 'sShortDate'), 'dd.MM.yyyy');
  assert.equal(parseRegValue('', 'sShortDate'), undefined);
  assert.equal(posixToBcp47('de_DE.UTF-8'), 'de-DE');
  assert.equal(posixToBcp47('C'), undefined);
});

test('non-Windows platforms use LC_TIME / LANG', async () => {
  assert.deepEqual(await systemDateFormat('linux', { LANG: 'en_GB.UTF-8' }), { date: 'dd/MM/yyyy', time: 'HH:mm' });
});
