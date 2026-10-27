import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as auditApi from './audit-api.js';
import { AdminAuditPage } from './AdminAuditPage.js';

describe('AdminAuditPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(auditApi, 'getAdminAuditFilterOptions').mockResolvedValue({
      admin: { uiEnabled: true, apiEnabled: true },
      actors: [{ value: 'admin@example.gov', label: 'Admin (admin@example.gov)' }],
      definitionKeys: ['api.search']
    });
  });

  it('lists a page, changes page size, and opens detail', async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(auditApi, 'listAdminAudit').mockResolvedValue({
      admin: { uiEnabled: true, apiEnabled: true },
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: 2,
          eventId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          eventType: 'FEATURE_FLAG_CHANGED',
          occurredAt: '2026-10-23T12:00:00.000Z',
          actorId: 'admin@example.gov',
          actorName: 'Admin',
          sessionId: null,
          correlationId: 'c-2',
          sourceService: 'api-server',
          entityType: 'FEATURE_FLAG',
          entityTrackingId: 'api.search',
          definitionKey: 'api.search',
          definitionVersion: null,
          stageKey: null,
          actionKey: null,
          previousHash: null,
          eventHash: 'hash-2',
          createdAt: '2026-10-23T12:00:00.000Z'
        }
      ]
    });
    vi.spyOn(auditApi, 'getAdminAuditEvent').mockResolvedValue({
      id: 2,
      eventId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      eventType: 'FEATURE_FLAG_CHANGED',
      occurredAt: '2026-10-23T12:00:00.000Z',
      actorId: 'admin@example.gov',
      actorName: 'Admin',
      sessionId: null,
      correlationId: 'c-2',
      sourceService: 'api-server',
      entityType: 'FEATURE_FLAG',
      entityTrackingId: 'api.search',
      definitionKey: 'api.search',
      definitionVersion: null,
      stageKey: null,
      actionKey: null,
      previousHash: null,
      eventHash: 'hash-2',
      createdAt: '2026-10-23T12:00:00.000Z',
      eventData: { eventType: 'FEATURE_FLAG_CHANGED', payload: { enabled: false } }
    });

    render(<AdminAuditPage />);
    await waitFor(() => expect(screen.getByText('FEATURE_FLAG_CHANGED')).toBeInTheDocument());
    expect(screen.getByLabelText('Rows per page')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1–1 of 1/)).toBeInTheDocument();

    await user.click(screen.getByRole('row', { name: /FEATURE_FLAG_CHANGED/i }));
    await waitFor(() =>
      expect(auditApi.getAdminAuditEvent).toHaveBeenCalledWith('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    );

    listSpy.mockResolvedValueOnce({
      admin: { uiEnabled: true, apiEnabled: true },
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: 2,
          eventId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          eventType: 'FEATURE_FLAG_CHANGED',
          occurredAt: '2026-10-23T12:00:00.000Z',
          actorId: 'admin@example.gov',
          actorName: 'Admin',
          sessionId: null,
          correlationId: 'c-2',
          sourceService: 'api-server',
          entityType: 'FEATURE_FLAG',
          entityTrackingId: 'api.search',
          definitionKey: 'api.search',
          definitionVersion: null,
          stageKey: null,
          actionKey: null,
          previousHash: null,
          eventHash: 'hash-2',
          createdAt: '2026-10-23T12:00:00.000Z'
        }
      ]
    });
    await user.selectOptions(screen.getByLabelText('Rows per page'), '10');
    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 10 }))
    );
  });
});
