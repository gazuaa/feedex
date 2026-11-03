// X 글 웹 사본의 모양. 서버가 만든 사본과 기기가 먼저 그리는 미리보기가 같이 쓴다.
export const X_THREAD_STYLE = `
*{box-sizing:border-box}body{margin:0;background:#fff;color:#0f1419;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:640px;margin:0 auto;padding:8px 16px 32px}a{color:#1d9bf0;text-decoration:none}a:hover{text-decoration:underline}
.quote,.card,.photo{text-decoration:none!important}
.post{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #eff3f4}.post.main{padding:16px 0}.post.main .text{font-size:19px;line-height:1.4}
.thread .post+.post{border-top:0}.thread{border-bottom:1px solid #eff3f4}.thread .post{border-bottom:0}
.avatar{width:40px;height:40px;border-radius:50%;flex:none;background:#eff3f4;object-fit:cover}.body{min-width:0;flex:1}
.who{margin:0 0 2px;color:#536471;font-size:14px;overflow-wrap:anywhere}.who b{color:#0f1419}.who a{color:#536471}
.replying{margin:0 0 4px;color:#536471;font-size:14px}.text{white-space:pre-wrap;overflow-wrap:anywhere}
.media{display:grid;gap:4px;margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}.media img,.media video{width:100%;max-height:520px;object-fit:cover;border-radius:14px;border:1px solid #eff3f4;display:block}
.photo{position:relative;display:block}.photo.video span{position:absolute;left:10px;bottom:10px;background:rgba(0,0,0,.7);color:#fff;font-size:12px;padding:4px 8px;border-radius:99px}
.card{display:block;margin-top:10px;border:1px solid #cfd9de;border-radius:14px;overflow:hidden;color:#0f1419}.card img{width:100%;max-height:320px;object-fit:cover;display:block}
.card span{display:flex;flex-direction:column;gap:2px;padding:10px 12px}.card small{color:#536471}.card em{color:#536471;font-style:normal;font-size:13px}
.quote{display:block;margin-top:10px;border:1px solid #cfd9de;border-radius:14px;padding:10px 12px;color:#0f1419}.quote .who{font-size:14px}.quote .text{display:block}.quote img{width:100%;margin-top:8px;border-radius:10px}
.stats{margin:8px 0 0;color:#536471;font-size:13px}h2{font-size:17px;margin:20px 0 4px}.empty{color:#536471}
.loading::before{content:"";display:inline-block;width:12px;height:12px;margin-right:8px;vertical-align:-2px;border:2px solid #cfd9de;border-top-color:#1d9bf0;border-radius:50%;animation:sfeed-spin .8s linear infinite}@keyframes sfeed-spin{to{transform:rotate(360deg)}}
.more{margin:20px 0 0;text-align:center}.more a{display:inline-block;padding:10px 16px;border:1px solid #cfd9de;border-radius:99px;font-weight:600}
`;
