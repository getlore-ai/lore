/**
 * Lore - Insight Extraction
 *
 * Generates summaries for source content. Keeps it simple - the agent
 * does the real analysis at query time with full context.
 */

import OpenAI from 'openai';
import type { Quote, Theme } from './types.js';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export interface ExtractedInsights {
  summary: string;
  themes: Theme[];  // Kept for compatibility, but empty
  quotes: Quote[];  // Kept for compatibility, but empty
}

export async function extractInsights(
  content: string,
  title: string,
  sourceId: string,
  options: {
    contentType?: string;
    model?: string;
  } = {}
): Promise<ExtractedInsights> {
  const { contentType = 'document', model = 'gpt-4o-mini' } = options;
  const openai = getOpenAI();

  // Simple, content-type aware summary prompt
  const contextHint = {
    interview: 'This is a user interview or research call.',
    meeting: 'This is a meeting transcript.',
    conversation: 'This is an AI conversation (Claude, ChatGPT, etc.).',
    analysis: 'This is a research or competitor analysis document.',
    survey: 'This is survey results or user feedback data.',
    document: 'This is a document or notes.',
    note: 'This is a note or memo.',
  }[contentType] || 'This is a document.';

  const systemPrompt = `You generate concise, information-dense summaries.

${contextHint}

Write a 2-4 sentence summary that captures:
- What this content is about
- The key takeaways or findings
- Any important decisions, insights, or action items

Be specific and factual. Include names, numbers, and concrete details when present.
Return only the summary text, no JSON or formatting.`;

  const userPrompt = `Title: ${title}

${content.substring(0, 30000)}`;

  // Retry logic for transient errors
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const summary = response.choices[0]?.message?.content?.trim();
      if (!summary) {
        throw new Error('No content in OpenAI response');
      }

      return {
        summary,
        themes: [],  // Agent extracts at query time
        quotes: [],  // Agent extracts at query time
      };
    } catch (error) {
      lastError = error as Error;
      const isRetryable =
        lastError.message?.includes('Connection') ||
        lastError.message?.includes('timeout') ||
        lastError.message?.includes('ECONNRESET') ||
        lastError.message?.includes('rate limit');

      if (isRetryable && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      break;
    }
  }

  // All retries failed - use first 200 chars as fallback
  console.error(`Error generating summary for "${title}":`, lastError);
  return {
    summary: content.substring(0, 200).trim() + '...',
    themes: [],
    quotes: [],
  };
}

export async function extractInsightsBatch(
  documents: Array<{
    id: string;
    title: string;
    content: string;
    contentType?: string;
  }>,
  options: {
    model?: string;
    concurrency?: number;
    onProgress?: (completed: number, total: number, title: string) => void;
  } = {}
): Promise<Map<string, ExtractedInsights>> {
  const { model = 'gpt-4o-mini', concurrency = 3, onProgress } = options;
  const results = new Map<string, ExtractedInsights>();

  for (let i = 0; i < documents.length; i += concurrency) {
    const batch = documents.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (doc) => {
        const insights = await extractInsights(doc.content, doc.title, doc.id, {
          contentType: doc.contentType,
          model,
        });
        onProgress?.(i + batch.indexOf(doc) + 1, documents.length, doc.title);
        return { id: doc.id, insights };
      })
    );

    for (const { id, insights } of batchResults) {
      results.set(id, insights);
    }

    // Delay between batches
    if (i + concurrency < documents.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}
