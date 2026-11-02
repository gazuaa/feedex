-- 구독자는 구독을 끊지 않고 피드의 새 글만 그만 받을 수 있다.
-- paused_at 뒤에 처음 저장된 글은 그 구독자에게 보이지 않는다.
ALTER TABLE subscriptions ADD COLUMN paused_at TEXT;
