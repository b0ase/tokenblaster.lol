import type { MetadataRoute } from 'next';

const SITE = 'https://www.tokenblaster.lol';
// AI crawlers and assistants are explicitly welcome; the AI-readable guide is /llms.txt.
const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Amazonbot', 'CCBot',
  'Meta-ExternalAgent', 'cohere-ai', 'DuckAssistBot', 'MistralAI-User',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/'] },
      { userAgent: AI_BOTS, allow: '/', disallow: ['/api/'] },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
