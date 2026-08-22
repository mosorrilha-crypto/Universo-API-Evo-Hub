import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { listOperationEvents, recordOperationEvent } from '../operationEventStore';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('operationEventStore', () => {
  beforeEach(() => initDb(createFakeSupabase()));

  it('persiste eventos e permite recuperar somente a linha do tempo da conversa solicitada', async () => {
    await recordOperationEvent({
      tenantId: TENANT_ID,
      phone: '595981111111',
      escalationId: 'esc-1',
      eventType: 'escalation_created',
      payload: { priority: 'high' },
    });
    await recordOperationEvent({
      tenantId: TENANT_ID,
      phone: '595982222222',
      eventType: 'ai_reply_status',
      payload: { status: 'sent' },
    });

    const events = await listOperationEvents(TENANT_ID, { phone: '595981111111' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ phone: '595981111111', escalation_id: 'esc-1', event_type: 'escalation_created' });
    expect(events[0].payload).toEqual({ priority: 'high' });
  });
});
