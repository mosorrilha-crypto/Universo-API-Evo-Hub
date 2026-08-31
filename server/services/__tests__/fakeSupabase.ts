/**
 * Cliente Supabase falso, em memória, só com a fatia da API do
 * supabase-js que os stores de server/services/*.ts realmente usam
 * (from/select/insert/update/upsert/delete/eq/order/single/maybeSingle).
 * Existe só pra testar isolamento entre tenants sem precisar de um Postgres
 * real — ver server/services/__tests__/tenantIsolation.test.ts.
 */
import { randomUUID } from 'crypto';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

class FakeQueryBuilder {
  private filters: Array<['eq' | 'ilike' | 'gte' | 'lt' | 'lte' | 'in', string, any]> = [];
  private wantSelect = false;
  private maximumRows: number | null = null;

  constructor(
    private rows: Row[],
    private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    private payload?: Row | Row[],
    private upsertOpts?: { onConflict?: string }
  ) {}

  eq(column: string, value: any) {
    this.filters.push(['eq', column, value]);
    return this;
  }

  /** Simplificado pra caso de uso real (match exato case-insensitive, sem wildcard "%") — suficiente pros testes de login por e-mail. */
  ilike(column: string, value: any) {
    this.filters.push(['ilike', column, value]);
    return this;
  }

  /** Comparação simples (string/número) — suficiente pra filtro de janela de tempo por created_at ISO. */
  gte(column: string, value: any) {
    this.filters.push(['gte', column, value]);
    return this;
  }

  /** Comparação simples (string/número) — suficiente pra filtro "mais antigo que X" por created_at ISO. */
  lt(column: string, value: any) {
    this.filters.push(['lt', column, value]);
    return this;
  }

  /** Comparação simples (string/número) — suficiente pra filtro "na hora marcada ou antes" por scheduled_at ISO. */
  lte(column: string, value: any) {
    this.filters.push(['lte', column, value]);
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push(['in', column, values]);
    return this;
  }

  order() {
    return this;
  }

  limit(count: number) {
    this.maximumRows = count;
    return this;
  }

  select(_columns?: string) {
    this.wantSelect = true;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([kind, column, value]) => {
      if (kind === 'ilike') return String(row[column] ?? '').toLowerCase() === String(value ?? '').toLowerCase();
      if (kind === 'gte') return row[column] >= value;
      if (kind === 'lt') return row[column] < value;
      if (kind === 'lte') return row[column] <= value;
      if (kind === 'in') return (value as any[]).includes(row[column]);
      return row[column] === value;
    });
  }

  private run(): { data: Row[] | null; error: null } {
    if (this.op === 'select') {
      const matching = this.rows.filter((row) => this.matches(row));
      return { data: this.maximumRows === null ? matching : matching.slice(0, this.maximumRows), error: null };
    }
    if (this.op === 'insert') {
      const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
      const newRows = payloads.map((payload) => ({ id: randomUUID(), ...payload }));
      this.rows.push(...newRows);
      return { data: newRows, error: null };
    }
    if (this.op === 'update') {
      const matched = this.rows.filter((row) => this.matches(row));
      matched.forEach((row) => Object.assign(row, this.payload));
      return { data: matched, error: null };
    }
    if (this.op === 'delete') {
      const matched = this.rows.filter((row) => this.matches(row));
      matched.forEach((row) => this.rows.splice(this.rows.indexOf(row), 1));
      return { data: matched, error: null };
    }
    // upsert
    const conflictCols = (this.upsertOpts?.onConflict || '').split(',').filter(Boolean);
    const existing = conflictCols.length
      ? this.rows.find((row) => conflictCols.every((col) => row[col] === (this.payload as Row | undefined)?.[col]))
      : undefined;
    if (existing) {
      Object.assign(existing, this.payload as Row);
      return { data: [existing], error: null };
    }
    const newRow: Row = { ...(this.payload as Row) };
    this.rows.push(newRow);
    return { data: [newRow], error: null };
  }

  async maybeSingle() {
    const { data, error } = this.run();
    return { data: data?.[0] ?? null, error };
  }

  async single() {
    const { data, error } = this.run();
    if (!data?.[0]) return { data: null, error: { message: 'not found' } };
    return { data: data[0], error };
  }

  then(resolve: (v: { data: Row[] | null; error: null }) => any, reject?: (e: any) => any) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

function buildConversationListSummaries(tables: Tables): Row[] {
  const conversations = tables.conversations || [];
  const messages = tables.messages || [];
  return conversations.map((conversation) => {
    const conversationMessages = messages
      .filter((message) => message.tenant_id === conversation.tenant_id && message.conversation_id === conversation.id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
    const last = conversationMessages[0];
    const unreadCount = conversationMessages.filter((message) =>
      message.sender === 'lead' && String(message.created_at) > String(conversation.last_read_at || '')
    ).length;
    return {
      ...conversation,
      last_message_id: last?.id || null,
      last_message_sender: last?.sender || null,
      last_message_type: last?.type || null,
      last_message_text: last?.text || null,
      last_message_created_at: last?.created_at || null,
      last_message_reply_to_message_id: last?.reply_to_message_id || null,
      last_message_forwarded_from_message_id: last?.forwarded_from_message_id || null,
      last_message_reactions: last?.reactions || null,
      last_message_sent_by: last?.sent_by || null,
      unread_count: unreadCount,
    };
  });
}

export function createFakeSupabase(seed: Tables = {}) {
  const tables: Tables = seed;
  let rpcTenantId: string | null = null;
  return {
    from(table: string) {
      const rows = table === 'conversation_list_summaries'
        ? buildConversationListSummaries(tables)
        : (tables[table] || (tables[table] = []));
      return {
        select: (columns?: string) => new FakeQueryBuilder(rows, 'select').select(columns),
        insert: (payload: Row | Row[]) => new FakeQueryBuilder(rows, 'insert', payload),
        update: (payload: Row) => new FakeQueryBuilder(rows, 'update', payload),
        delete: () => new FakeQueryBuilder(rows, 'delete'),
        upsert: (payload: Row, opts?: { onConflict?: string }) => new FakeQueryBuilder(rows, 'upsert', payload, opts),
      };
    },
    rpc(functionName: string, args: Record<string, any>) {
      if (!rpcTenantId) {
        return {
          async single() {
            return { data: null, error: { code: '42501', message: 'Contexto de tenant ausente no fake RPC' } };
          },
        };
      }
      if (functionName === 'save_knowledge_base_document_draft') {
        const documents = tables.knowledge_base_documents || (tables.knowledge_base_documents = []);
        const events = tables.knowledge_base_document_events || (tables.knowledge_base_document_events = []);
        const matchingDocuments = documents.filter((row) => row.tenant_id === rpcTenantId && row.document_type === args.p_document_type);
        const draft = matchingDocuments.find((row) => row.status === 'draft');
        return {
          async single() {
            const now = new Date().toISOString();
            const saved = draft || {
              id: randomUUID(),
              tenant_id: rpcTenantId,
              document_type: args.p_document_type,
              version: Math.max(0, ...matchingDocuments.map((row) => Number(row.version) || 0)) + 1,
              status: 'draft',
              created_at: now,
              created_by: args.p_actor_id,
            };
            Object.assign(saved, { data: args.p_data, updated_at: now, updated_by: args.p_actor_id });
            if (!draft) documents.push(saved);
            events.push({
              id: randomUUID(),
              tenant_id: saved.tenant_id,
              document_id: saved.id,
              document_type: saved.document_type,
              version: saved.version,
              event_type: draft ? 'draft_updated' : 'draft_created',
              actor_id: args.p_actor_id,
              created_at: now,
            });
            return { data: saved, error: null };
          },
        };
      }

      if (functionName !== 'publish_knowledge_base_document') {
        return {
          async single() {
            return { data: null, error: { message: `RPC não suportado no fake: ${functionName}` } };
          },
        };
      }

      const documents = tables.knowledge_base_documents || (tables.knowledge_base_documents = []);
      const events = tables.knowledge_base_document_events || (tables.knowledge_base_document_events = []);
      const draft = documents.find((row) => row.tenant_id === rpcTenantId && row.document_type === args.p_document_type && row.status === 'draft');
      if (!draft) {
        return {
          async single() {
            return { data: null, error: { code: 'P0002', message: 'Não existe rascunho para publicar' } };
          },
        };
      }

      return {
        async single() {
          const now = new Date().toISOString();
          for (const document of documents) {
            if (document.tenant_id === draft.tenant_id && document.document_type === draft.document_type && document.status === 'published') {
              Object.assign(document, { status: 'archived', updated_at: now, updated_by: args.p_actor_id });
            }
          }
          Object.assign(draft, { status: 'published', updated_at: now, updated_by: args.p_actor_id, published_at: now, published_by: args.p_actor_id });
          events.push({
            id: randomUUID(),
            tenant_id: draft.tenant_id,
            document_id: draft.id,
            document_type: draft.document_type,
            version: draft.version,
            event_type: 'published',
            actor_id: args.p_actor_id,
            created_at: now,
          });
          return { data: draft, error: null };
        },
      };
    },
    /** Modela o tenant derivado do JWT que os RPCs reais leem via RLS. */
    __setRpcTenant(tenantId: string | null) {
      rpcTenantId = tenantId;
    },
    __tables: tables,
  } as any;
}
