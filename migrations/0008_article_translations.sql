-- 글 번역 저장. 같은 글을 다시 열 때 DeepL 글자 수를 다시 쓰지 않는다.
-- 앱이 처음 번역할 때도 같은 표를 만든다(src/server/translator.ts의 TRANSLATION_TABLE).
CREATE TABLE IF NOT EXISTS article_translations (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_lang TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (article_id, target_lang, source_kind)
);
