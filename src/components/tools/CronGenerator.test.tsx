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
