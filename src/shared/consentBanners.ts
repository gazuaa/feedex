// 널리 쓰이는 동의 관리 도구의 최상위 요소: OneTrust, Cookiebot, Didomi, Quantcast, TrustArc,
// Sourcepoint, Usercentrics, Osano, Termly, CookieYes, Complianz.
const MANAGERS = '#onetrust-consent-sdk,#onetrust-banner-sdk,#onetrust-pc-sdk,.onetrust-pc-dark-filter,#ot-sdk-btn-floating,#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,#didomi-host,.didomi-popup-backdrop,.qc-cmp2-container,#qc-cmp2-container,#truste-consent-track,.truste_overlay,.truste_box_overlay,[id^="sp_message_container"],#usercentrics-root,.osano-cm-window,#termly-code-snippet-support,.cky-consent-container,.cky-overlay,#cmplz-cookiebanner-container';
// textContent에서는 버튼 이름이 붙어 버리므로("AcceptReject") 단어 앞쪽 경계만 본다.
const ASKS = /\b(?:cookie|consent|privacy)/i;
const ANSWERS = /\b(?:accept|reject|agree|allow|decline|manage)/i;

/**
 * 렌더링된 페이지에는 스크립트가 띄운 쿠키 창이 남아 있을 수 있다. 사본은 그 스크립트를
 * 돌리지 않고 쿠키도 설정하지 않으며 창을 닫을 수도 없으므로, 창은 기사를 가리기만 한다.
 * 알려진 동의 관리 도구와 쿠키를 묻는 작은 고정 대화창을 뺀다.
 */
export function dropConsentBanners(root: ParentNode) {
  root.querySelectorAll(MANAGERS).forEach((node) => node.remove());
  for (const dialog of Array.from(root.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]'))) {
    const text = (dialog.textContent || '').replace(/\s+/g, ' ');
    if (dialog.isConnected && text.length < 2000 && ASKS.test(text) && ANSWERS.test(text)) dialog.remove();
  }
}
