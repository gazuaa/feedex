/**
 * 단축키가 묶인 키. 영문 자판에서는 입력된 글자를 쓴다. 한글(또는 다른 비라틴) 자판에서는
 * 브라우저가 ㅁ을 입력하거나, 입력기가 키를 잡고 있을 때 "Process"를 알리므로 키 자리에서
 * 글자를 얻는다(KeyA). 글자가 아닌 키는 이름을 그대로 쓴다: "Escape", "ArrowDown".
 */
export function shortcutKey(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  const letter = /^Key([A-Z])$/.exec(event.code);
  return letter ? letter[1].toLowerCase() : event.key;
}
