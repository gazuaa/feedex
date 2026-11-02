-- SFeed가 예전에 만들어 넣은 환영 글과 하드코딩된 예시만 지운다.
-- 실제 글·피드·구독·폴더는 그대로 둔다.
-- 딸린 읽음·북마크 행은 글 외래 키의 연쇄 삭제를 따른다.
DELETE FROM articles WHERE id IN (
  SELECT a.id FROM articles a JOIN feeds f ON f.id = a.feed_id
  WHERE (
    a.guid = f.xml_url || '-welcome-1'
    AND instr(a.title, ' - 최신 업데이트 및 주요 기술 트렌드 아티클') > 0
    AND instr(a.content_html, '피드가 성공적으로 구독되었습니다.') > 0
    AND instr(a.content_html, '클라우드플레어 배포 환경 및 인터넷 연결 상태') > 0
  )
  OR (f.xml_url = 'https://news.hada.io/rss/news' AND a.guid IN ('gn-cloudflare-d1-workers-2026', 'gn-local-first-rss-2026'))
  OR (f.xml_url = 'https://toss.tech/rss.xml' AND a.guid = 'toss-react-19-ux-pattern')
  OR (f.xml_url = 'https://blog.cloudflare.com/rss/' AND a.guid = 'cf-workers-ai-d1-2026')
  OR (f.xml_url = 'https://hnrss.org/frontpage' AND a.guid = 'hn-sqlite-at-scale-2026')
  OR (f.xml_url = 'https://www.smashingmagazine.com/feed/' AND a.guid = 'smashing-reading-experience-2026')
);
