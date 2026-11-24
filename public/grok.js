// grok.com 웹으로만 보낸다(다른 주소로 넘기는 통로가 되지 않게 질문 글만 받는다).
// 누름과 이어지지 않게 잠깐 뒤에 넘겨서 iOS가 Grok 앱으로 가로채지 않게 한다.
(function () {
  var q = new URLSearchParams(location.search).get('q') || '';
  var target = 'https://grok.com/' + (q ? '?' + new URLSearchParams({ q: q.slice(0, 4000) }).toString() : '');
  setTimeout(function () { location.replace(target); }, 60);
})();
