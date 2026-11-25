// grok.com, chatgpt.com, claude.ai로만 보낸다(다른 주소로 넘기는 통로가 되지 않게 질문 글과 서비스 이름만 받는다).
// 누름과 이어지지 않게 잠깐 뒤에 넘긴다.
(function () {
  var params = new URLSearchParams(location.search);
  var q = params.get('q') || '';
  var bases = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new' };
  var base = bases[params.get('to')] || 'https://grok.com/';
  var target = base + (q ? '?' + new URLSearchParams({ q: q.slice(0, 4000) }).toString() : '');
  // 이 페이지가 Grok·ChatGPT·Claude 앱으로 넘어가고 나면 돌아왔을 때 이 페이지가 남아 있으므로 돌아오면 이 페이지가 남아 있으므로
  // 다른 앱에 다녀온 것을 알아채면 피드엑스로 되돌아간다(새 창이면 닫고, 아니면 앞 화면으로 간다).
  var away = false, returning = false;
  function back() {
    if (returning) return;
    returning = true;
    try { window.close(); } catch (error) { /* 닫을 수 없는 창이면 아래로 되돌아간다. */ }
    setTimeout(function () { if (history.length > 1) history.back(); else location.replace('/'); }, 150);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) away = true; else if (away) back(); });
  window.addEventListener('pageshow', function (event) { if (event.persisted) back(); });
  var link = document.getElementById('back');
  if (link) link.addEventListener('click', function (event) { event.preventDefault(); back(); });
  setTimeout(function () { location.replace(target); }, 60);
})();
