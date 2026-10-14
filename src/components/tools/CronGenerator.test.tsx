import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CronGenerator } from '@/components/tools/CronGenerator';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageRemove } from '@/lib/persistentStore';

/** Quartz's trailing year field is optional, so the default 6-field Quartz expression must validate. */

function setup() {
  const view = render(<AppConfigProvider><CronGenerator /></AppConfigProvider>);
  const input = () => view.container.querySelector('#cron-expression') as HTMLInputElement;
  return { input };
}

const status = () => document.body.textContent ?? '';

beforeEach(() => {
  for (const k of ['mode', 'fields', 'expression']) storageRemove(`devtool:cron-generator:cron:${k}`);
});
afterEach(() => cleanup());

describe('CronGenerator — Quartz field count', () => {
  it('accepts its own 6-field default (year omitted)', () => {
    const { input } = setup();
    fireEvent.click(screen.getByText('Quartz'));
    expect(input().value.split(' ')).toHaveLength(6);
    expect(status()).toContain('Valid quartz cron');
    expect(status()).not.toContain('Invalid expression');
    expect(screen.getByText('Next runs')).toBeTruthy();
  });

  it('accepts the 7-field form with a year', () => {
    const { input } = setup();
    fireEvent.click(screen.getByText('Quartz'));
    fireEvent.change(input(), { target: { value: '0 0 12 ? * MON 2099' } });
    expect(status()).toContain('Valid quartz cron');
  });

  it('still rejects too few fields', () => {
    const { input } = setup();
    fireEvent.click(screen.getByText('Quartz'));
    fireEvent.change(input(), { target: { value: '0 0 12' } });
    expect(status()).toContain('Invalid expression');
  });
});

describe('inferMode — a 6-field expression keeps the chosen flavour', () => {
  it('Quartz stays Quartz, Spring stays Spring; from Linux it guesses by Quartz-only syntax', async () => {
    const { inferMode } = await import('@/components/tools/CronGenerator');
    expect(inferMode('0 0 9 ? * 2', 'quartz')).toBe('quartz');
    expect(inferMode('0 0 9 * * MON', 'quartz')).toBe('quartz');
    expect(inferMode('0 0 9 * * 1', 'spring')).toBe('spring');
    expect(inferMode('0 0 9 ? * 2', 'linux')).toBe('quartz');
    expect(inferMode('0 0 9 * * 1', 'linux')).toBe('spring');
    expect(inferMode('0 0 9 * * 1 2027', 'spring')).toBe('quartz');
    expect(inferMode('0 9 * * 1', 'quartz')).toBe('linux');
  });
});

describe('CronGenerator — Quartz input stays Quartz', () => {
  it('a Quartz day-of-week (2 = Monday) keeps the Quartz flavour and its meaning', () => {
    const { input } = setup();
    fireEvent.click(screen.getByText('Quartz'));
    fireEvent.change(input(), { target: { value: '0 0 9 ? * 2' } });
    expect(status()).toContain('Valid quartz cron');
    expect(status()).not.toContain('Valid Spring');
    expect(status()).toMatch(/Next runs[^]*Mon \d{4}-/);
    expect(status()).not.toMatch(/Next runs[^]*Tue \d{4}-/);
  });

  it('a day restriction is part of the explanation', () => {
    const { input } = setup();
    fireEvent.click(screen.getByText('Quartz'));
    fireEvent.change(input(), { target: { value: '0 */5 * ? * MON' } });
    expect(status()).not.toMatch(/Every 5 minutes\./);
  });
});
