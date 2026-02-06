/**
 * Lore - Theme Definitions
 *
 * Pre-defined themes for insight extraction from sources.
 * Adapted from granola-extractor.
 */

export interface ThemeDefinition {
  id: string;
  name: string;
  prompt: string;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'pain-points',
    name: 'Pain Points',
    prompt: 'Problems, frustrations, difficulties, blockers, challenges, risks identified',
  },
  {
    id: 'feature-requests',
    name: 'Feature Requests',
    prompt: 'Desired features, wishlist items, suggestions, improvements, capabilities needed',
  },
  {
    id: 'positive-feedback',
    name: 'Positive Feedback',
    prompt: 'Strengths, what works well, advantages, praise, value delivered',
  },
  {
    id: 'pricing',
    name: 'Pricing & Value',
    prompt: 'Cost, pricing, value perception, ROI, budget, willingness to pay, financial considerations',
  },
  {
    id: 'competition',
    name: 'Competition',
    prompt: 'Competitors, alternatives, market comparison, competitive advantages/disadvantages',
  },
  {
    id: 'workflow',
    name: 'Workflow & Process',
    prompt: 'How things work, processes, workarounds, current state, tools and methods used',
  },
  {
    id: 'decisions',
    name: 'Decisions',
    prompt: 'Key decisions, conclusions, action items, next steps, agreements, choices made',
  },
  {
    id: 'questions',
    name: 'Open Questions',
    prompt: 'Unanswered questions, uncertainties, things needing clarification, follow-ups',
  },
  {
    id: 'requirements',
    name: 'Requirements',
    prompt: 'Must-haves, specifications, constraints, acceptance criteria, needs, dependencies',
  },
  {
    id: 'insights',
    name: 'Key Insights',
    prompt: 'Important learnings, discoveries, observations, patterns, strategic insights',
  },
  {
    id: 'data-points',
    name: 'Data & Metrics',
    prompt: 'Statistics, numbers, measurements, KPIs, benchmarks, quantitative findings',
  },
  {
    id: 'opportunities',
    name: 'Opportunities',
    prompt: 'Market opportunities, growth areas, untapped potential, strategic openings',
  },
];

export function getThemeById(id: string): ThemeDefinition | undefined {
  return THEMES.find((t) => t.id === id);
}

export function getThemeNames(): string[] {
  return THEMES.map((t) => t.id);
}

export function getThemePromptList(): string {
  return THEMES.map((t) => `- ${t.id}: ${t.prompt}`).join('\n');
}
