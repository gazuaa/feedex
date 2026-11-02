/**
 * The key a shortcut is bound to. A letter is the one typed on a Latin layout; under a
 * Hangul (or other non-Latin) layout the browser types ㅁ, or reports "Process" while an
 * input method holds the key, so the letter comes from the key's place instead (KeyA).
 * Every other key keeps its name: "Escape", "ArrowDown".
 */
export function shortcutKey(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  const letter = /^Key([A-Z])$/.exec(event.code);
  return letter ? letter[1].toLowerCase() : event.key;
}
