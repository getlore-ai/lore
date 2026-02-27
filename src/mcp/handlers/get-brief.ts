/**
 * Get Brief Handler - Retrieve the living project brief
 */

import { getBriefWithStaleness, type BriefWithStaleness } from '../../core/brief.js';

interface GetBriefArgs {
  project: string;
  include_history?: boolean;
}

export async function handleGetBrief(
  dbPath: string,
  _dataDir: string,
  args: GetBriefArgs
): Promise<unknown> {
  const normalizedProject = args.project.toLowerCase().trim();

  const brief = await getBriefWithStaleness(dbPath, normalizedProject);

  if (!brief) {
    return {
      project: normalizedProject,
      exists: false,
      message: `No brief exists for project "${normalizedProject}". Run \`lore brief generate ${normalizedProject}\` from the CLI to create one.`,
    };
  }

  // Include history if requested
  let history: unknown[] | undefined;
  if (args.include_history) {
    const { getBriefHistory } = await import('../../core/brief.js');
    const versions = await getBriefHistory(dbPath, normalizedProject);
    history = versions.map((v) => ({
      version: v.version,
      generated_at: v.generated_at,
      source_count: v.source_count_at_generation,
      focus: v.focus || undefined,
    }));
  }

  return {
    project: brief.project,
    version: brief.version,
    generated_at: brief.generated_at,

    // Staleness
    stale: brief.stale,
    ...(brief.stale
      ? {
          staleness_info: {
            sources_at_generation: brief.source_count_at_generation,
            current_source_count: brief.current_source_count,
            new_sources: brief.sources_since,
            message: `Brief is stale — ${brief.sources_since} new source(s) added since generation. Run \`lore brief generate ${normalizedProject}\` from the CLI to refresh.`,
          },
        }
      : {}),

    // Content
    current_state: brief.current_state,
    key_evidence: brief.key_evidence,
    open_questions: brief.open_questions,
    trajectory: brief.trajectory,
    recent_changes: brief.recent_changes,

    // Metadata
    source_count_at_generation: brief.source_count_at_generation,
    focus: brief.focus || undefined,

    // Optional history
    ...(history ? { history } : {}),
  };
}
