-- Estados explícitos para o pipeline de mídia de mensagens.
-- Mensagens antigas permanecem compatíveis com o estado 'stored'; novas
-- imagens/arquivos recebidos entram como 'pending' e são atualizados pelo
-- worker de persistência após download e upload concluídos.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_status text NOT NULL DEFAULT 'stored',
  ADD COLUMN IF NOT EXISTS media_error text,
  ADD COLUMN IF NOT EXISTS media_mime_type text,
  ADD COLUMN IF NOT EXISTS media_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_media_status_check'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_media_status_check
      CHECK (media_status IN ('pending', 'stored', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS messages_media_status_idx
  ON public.messages (tenant_id, media_status, media_updated_at)
  WHERE type IN ('image', 'file');
