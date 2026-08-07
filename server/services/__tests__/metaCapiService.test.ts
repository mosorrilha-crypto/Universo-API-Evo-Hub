/**
 * Epic 4.5.6 — o disparo automático de CAPI no fechamento de agendamento
 * nunca pode mandar um evento de atribuição incompleta/inventada. Trava as
 * duas guardas: sem ctwa_clid real da conversa, e sem credencial de CAPI
 * configurada pro tenant, nunca chama a Meta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { fireMetaCapiEventForTenant } from '../metaCapiService';

const TENANT_WITH_CAPI = 'tenant-com-capi';
const TENANT_SEM_CAPI = 'tenant-sem-capi';

beforeEach(() => {
  initDb(
    createFakeSupabase({
      tenant_meta_credentials: [
        { tenant_id: TENANT_WITH_CAPI, capi_dataset_id: 'ds-1', capi_access_token: 'tok-1', capi_page_id: 'page-1' },
        { tenant_id: TENANT_SEM_CAPI, capi_dataset_id: null, capi_access_token: null, capi_page_id: null },
      ],
    })
  );
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events_received: 1 }) }) as any));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fireMetaCapiEventForTenant', () => {
  it('nunca chama a Meta sem ctwaClid', async () => {
    await fireMetaCapiEventForTenant(TENANT_WITH_CAPI, { eventName: 'Schedule', phone: '595981234567', ctwaClid: undefined });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('nunca chama a Meta sem credencial de CAPI configurada pro tenant', async () => {
    await fireMetaCapiEventForTenant(TENANT_SEM_CAPI, { eventName: 'Schedule', phone: '595981234567', ctwaClid: 'clid-real' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('chama a Meta quando tem ctwaClid real e credencial configurada', async () => {
    await fireMetaCapiEventForTenant(TENANT_WITH_CAPI, { eventName: 'Schedule', phone: '595981234567', ctwaClid: 'clid-real', value: 500000, contentName: 'Microlips' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (fetch as any).mock.calls[0];
    expect(url).toContain('ds-1/events');
    expect(url).toContain('access_token=tok-1');
    const body = JSON.parse(options.body);
    expect(body.data[0].event_name).toBe('Schedule');
    expect(body.data[0].user_data.ctwa_clid).toBe('clid-real');
    expect(body.data[0].user_data.page_id).toBe('page-1');
    expect(body.data[0].custom_data.value).toBe(500000);
  });
});
