import type { Env } from './types';
import { decodeHtmlEntities } from './rssParser';

export interface SummarizeResult {
  summary: string;
  provider: 'cloudflare-workers-ai' | 'extractive-fallback';
  model: string;
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function buildExtractiveSummary(title: string, plainText: string, feedTitle: string): string {
  const sentences = plainText
    .split(/(?<=[.!?다요음])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 240);

  const topPoints = sentences.slice(0, 3);
  while (topPoints.length < 3) {
    if (topPoints.length === 0) {
      topPoints.push(`${feedTitle}에서 발행된 "${title}" 아티클의 핵심 내용을 다룹니다.`);
    } else if (topPoints.length === 1) {
      topPoints.push('주요 기술 배경과 실무 적용 시 고려해야 할 아키텍처 및 인사이트를 정리하고 있습니다.');
    } else {
      topPoints.push('원문 보기를 통해 상세 코드 예제와 전체 맥락을 확인하실 수 있습니다.');
    }
  }

  // 키워드를 뽑는다
  const words = `${title} ${plainText}`
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(and|the|for|with|that|this|from|have|있다|있는|하는|위한|통해|대한)$/i.test(w));

  const freq = new Map<string, number>();
  for (const w of words) {
    const key = w.toLowerCase();
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  const topKeywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => `#${k}`);

  return [
    `📌 **한줄 핵심 요약**`,
    `${topPoints[0]}`,
    ``,
    `💡 **주요 포인트**`,
    ...topPoints.map((pt) => `• ${pt}`),
    ``,
    `🏷️ **키워드:** ${topKeywords.length > 0 ? topKeywords.join(' ') : `#${feedTitle.replace(/\s+/g, '')} #테크트렌드`}`,
  ].join('\n');
}

export async function summarizeArticleWithAI(
  env: Env,
  article: {
    title: string;
    feedTitle: string;
    summary: string | null;
    contentHtml: string | null;
    fullContentHtml: string | null;
  }
): Promise<SummarizeResult> {
  const rawBody =
    article.fullContentHtml || article.contentHtml || article.summary || article.title;
  const plainText = htmlToPlainText(rawBody).slice(0, 4500);
  const preferredModel = env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';

  if (env.AI && typeof env.AI.run === 'function') {
    const modelsToTry = [
      preferredModel,
      '@cf/meta/llama-3-8b-instruct',
      '@cf/qwen/qwen1.5-7b-chat-awq',
    ];

    for (const model of modelsToTry) {
      try {
        const aiRes = await env.AI.run(model, {
          messages: [
            {
              role: 'system',
              content:
                '당신은 전문 기술/뉴스 에디터입니다. 주어진 RSS 아티클을 한국어로 명확하고 읽기 쉽게 요약하세요. 반드시 다음 형식을 지키세요:\n📌 **한줄 핵심 요약**\n(1~2문장 요약)\n\n💡 **주요 포인트**\n• (핵심 내용 1)\n• (핵심 내용 2)\n• (핵심 내용 3)\n\n🏷️ **키워드:** #키워드1 #키워드2 #키워드3',
            },
            {
              role: 'user',
              content: `출처: ${article.feedTitle}\n제목: ${article.title}\n\n본문:\n${plainText}`,
            },
          ],
          max_tokens: 550,
          temperature: 0.3,
        });

        const text =
          aiRes?.response ||
          (aiRes?.result && typeof aiRes.result === 'object' ? aiRes.result.response : '');

        if (text && text.trim().length > 30) {
          return {
            summary: text.trim(),
            provider: 'cloudflare-workers-ai',
            model,
          };
        }
      } catch {
        // 다음 대체 모델을 쓰거나, 기기 쪽 추출식 요약으로 대신한다
      }
    }
  }

  return {
    summary: buildExtractiveSummary(article.title, plainText, article.feedTitle),
    provider: 'extractive-fallback',
    model: 'Smart Extractive Summarizer (Local Fallback)',
  };
}
