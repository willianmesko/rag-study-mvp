-- Authorized product content is distinct from operational logs and 24h replay.
CREATE TABLE conversations (
  tenant_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  id UUID NOT NULL,
  title TEXT CHECK (length(title) BETWEEN 1 AND 120),
  next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence BETWEEN 1 AND 501),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '90 days',
  PRIMARY KEY(tenant_id,owner_id,id),
  FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX conversations_owner_page ON conversations(tenant_id,owner_id,created_at DESC,id DESC);
CREATE INDEX conversations_expiry ON conversations(expires_at);

-- A turn owns two immutable message IDs, one ordered user question and one
-- assistant result. The canonical input also acts as a durable admission outbox.
CREATE TABLE conversation_turns (
  tenant_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  run_id UUID NOT NULL,
  user_message_id UUID NOT NULL DEFAULT gen_random_uuid(),
  assistant_message_id UUID NOT NULL DEFAULT gen_random_uuid(),
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 500),
  mode TEXT NOT NULL CHECK (mode IN ('answer','comparison')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  request_hash BYTEA NOT NULL CHECK (octet_length(request_hash)=32),
  input JSONB NOT NULL CHECK (jsonb_typeof(input)='object' AND pg_column_size(input)<=32768),
  response JSONB CHECK (jsonb_typeof(response)='object' AND pg_column_size(response)<=262144),
  feedback TEXT CHECK (feedback IN ('up','down')),
  failure_code TEXT CHECK (length(failure_code)<=80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '2 minutes',
  PRIMARY KEY(tenant_id,owner_id,run_id),
  UNIQUE(tenant_id,owner_id,conversation_id,sequence),
  UNIQUE(tenant_id,owner_id,assistant_message_id),
  UNIQUE(tenant_id,owner_id,user_message_id),
  FOREIGN KEY(tenant_id,owner_id,conversation_id) REFERENCES conversations(tenant_id,owner_id,id) ON DELETE CASCADE,
  CHECK ((status='completed')=(response IS NOT NULL)),
  CHECK (feedback IS NULL OR status='completed')
);
CREATE UNIQUE INDEX conversation_one_active_turn ON conversation_turns(tenant_id,owner_id,conversation_id) WHERE status IN ('queued','running');
CREATE INDEX conversation_turns_outbox ON conversation_turns(created_at) WHERE status='queued';
CREATE INDEX conversation_turns_deadline ON conversation_turns(deadline_at) WHERE status IN ('queued','running');

ALTER TABLE chat_runs ADD COLUMN conversation_id UUID;
ALTER TABLE chat_runs ADD CONSTRAINT chat_runs_conversation_fk FOREIGN KEY(tenant_id,actor_id,conversation_id) REFERENCES conversations(tenant_id,owner_id,id) ON DELETE CASCADE;
CREATE INDEX chat_runs_conversation ON chat_runs(tenant_id,actor_id,conversation_id) WHERE conversation_id IS NOT NULL;
ALTER TABLE workflow_runs ADD COLUMN conversation_id UUID;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_conversation_fk FOREIGN KEY(tenant_id,actor_user_id,conversation_id) REFERENCES conversations(tenant_id,owner_id,id) ON DELETE CASCADE;
ALTER TABLE workflow_runs ADD CHECK (conversation_id IS NULL OR kind='chat');
CREATE INDEX workflow_runs_conversation ON workflow_runs(tenant_id,actor_user_id,conversation_id) WHERE conversation_id IS NOT NULL;

-- Terminal replay publication and product history commit in the same transaction,
-- including worker recovery, cancellation, deadline expiry and provider failure.
CREATE FUNCTION sync_conversation_chat_event() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE linked UUID; payload JSONB; kind TEXT;
BEGIN
  SELECT conversation_id INTO linked FROM public.chat_runs WHERE tenant_id=NEW.tenant_id AND actor_id=NEW.actor_id AND run_id=NEW.run_id;
  IF linked IS NULL THEN RETURN NEW; END IF;
  kind:=NEW.event->>'type';
  IF kind='completed' THEN
    payload:=NEW.event->'response';
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'sources','[]'::jsonb)||coalesce(payload->'contextSources','[]'::jsonb)) s
      WHERE NOT EXISTS(SELECT 1 FROM public.chunks c JOIN public.documents d ON d.id=c.document_id
        WHERE d.tenant_id=NEW.tenant_id AND c.id::text=s->>'chunkId' AND d.id::text=s->>'documentId'))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(payload->'citedChunkIds','[]'::jsonb)) citation
        WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'sources','[]'::jsonb)) s WHERE s->>'chunkId'=citation.value))
    THEN RAISE EXCEPTION 'Invalid conversation citations' USING ERRCODE='23514'; END IF;
    UPDATE public.conversation_turns SET status='completed',response=payload,completed_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.actor_id AND conversation_id=linked AND run_id=NEW.run_id AND status IN ('queued','running');
  ELSIF kind IN ('error','cancelled') THEN
    UPDATE public.conversation_turns SET status=CASE WHEN kind='cancelled' THEN 'cancelled' ELSE 'failed' END,
      failure_code=CASE WHEN kind='error' THEN NEW.event->>'code' ELSE NULL END,completed_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.actor_id AND conversation_id=linked AND run_id=NEW.run_id AND status IN ('queued','running');
  ELSE
    UPDATE public.conversation_turns SET status='running',updated_at=clock_timestamp()
      WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.actor_id AND conversation_id=linked AND run_id=NEW.run_id AND status='queued';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sync_conversation_chat_event() FROM PUBLIC;
CREATE TRIGGER conversation_chat_event AFTER INSERT ON chat_run_events FOR EACH ROW EXECUTE FUNCTION sync_conversation_chat_event();

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON conversations,conversation_turns FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON conversations,conversation_turns FROM %I',api_role);
    EXECUTE format('REVOKE ALL ON FUNCTION sync_conversation_chat_event() FROM %I',api_role);
  END LOOP;
END $$;
