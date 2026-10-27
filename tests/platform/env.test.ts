import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const keys = [
  'DATABASE_PORT',
  'DATABASE_HOST',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
  'FEATURE_ADMIN_UI',
  'FEATURE_ADMIN_API',
  'SCHEDULER_ENABLED',
  'SCHEDULER_BATCH_SIZE',
  'SCHEDULER_LEASE_MS',
  'SCHEDULER_MAX_ATTEMPTS',
  'OUTBOX_PUBLISHER_ENABLED',
  'OUTBOX_BATCH_SIZE',
  'OUTBOX_LEASE_MS',
  'OUTBOX_MAX_ATTEMPTS'
] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = previous[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('loadConfig', () => {
  it('defaults to Docker MySQL on 3307 when DATABASE_PORT is unset', () => {
    delete process.env.DATABASE_PORT;
    const config = loadConfig();
    expect(config.database.port).toBe(3307);
    expect(config.database.host).toBe('127.0.0.1');
  });

  it('disables the scheduler by default in test and enables it otherwise', () => {
    delete process.env.SCHEDULER_ENABLED;
    delete process.env.SCHEDULER_BATCH_SIZE;
    delete process.env.SCHEDULER_LEASE_MS;
    delete process.env.SCHEDULER_MAX_ATTEMPTS;
    const config = loadConfig();
    expect(config.scheduler.enabled).toBe(process.env.NODE_ENV === 'test' ? false : true);
    expect(config.scheduler.batchSize).toBe(10);
    expect(config.scheduler.leaseMs).toBe(30_000);
    expect(config.scheduler.defaultMaxAttempts).toBe(5);
  });

  it('disables the outbox publisher by default in test and enables it otherwise', () => {
    delete process.env.OUTBOX_PUBLISHER_ENABLED;
    delete process.env.OUTBOX_BATCH_SIZE;
    delete process.env.OUTBOX_LEASE_MS;
    delete process.env.OUTBOX_MAX_ATTEMPTS;
    const config = loadConfig();
    expect(config.outboxPublisher.enabled).toBe(process.env.NODE_ENV === 'test' ? false : true);
    expect(config.outboxPublisher.batchSize).toBe(25);
    expect(config.outboxPublisher.leaseMs).toBe(30_000);
    expect(config.outboxPublisher.defaultMaxAttempts).toBe(5);
  });

  it('enables feature admin outside production by default', () => {
    delete process.env.FEATURE_ADMIN_UI;
    delete process.env.FEATURE_ADMIN_API;
    const config = loadConfig();
    const expectEnabled = process.env.NODE_ENV !== 'production';
    expect(config.featureAdmin.uiEnabled).toBe(expectEnabled);
    expect(config.featureAdmin.apiEnabled).toBe(expectEnabled);
  });

  it('honors FEATURE_ADMIN_UI and FEATURE_ADMIN_API overrides', () => {
    process.env.FEATURE_ADMIN_UI = 'false';
    process.env.FEATURE_ADMIN_API = 'true';
    const config = loadConfig();
    expect(config.featureAdmin.uiEnabled).toBe(false);
    expect(config.featureAdmin.apiEnabled).toBe(true);
  });
});
