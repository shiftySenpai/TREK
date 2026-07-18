// server/tests/unit/services/adminService.googleDirections.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../src/db/database';
import { getGoogleDirections, updateGoogleDirections } from '../../../src/services/adminService';

beforeEach(() => {
  db.prepare("DELETE FROM app_settings WHERE key = 'directions_enabled'").run();
});

describe('getGoogleDirections / updateGoogleDirections', () => {
  it('ADMIN-SVC-GDIR-001: defaults to enabled when no row exists', () => {
    expect(getGoogleDirections()).toEqual({ enabled: true });
  });

  it('ADMIN-SVC-GDIR-002: updateGoogleDirections(false) persists and getGoogleDirections reflects it', () => {
    updateGoogleDirections(false);
    expect(getGoogleDirections()).toEqual({ enabled: false });
  });

  it('ADMIN-SVC-GDIR-003: updateGoogleDirections(true) re-enables it', () => {
    updateGoogleDirections(false);
    updateGoogleDirections(true);
    expect(getGoogleDirections()).toEqual({ enabled: true });
  });
});
