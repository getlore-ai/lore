# Publishing Lore to Agent Platforms

How to publish Lore's plugins/extensions into each platform's registry so users can discover and install Lore directly from their agent.

## Overview

| Platform | Registry | Plugin Location | Status |
|----------|----------|----------------|--------|
| Claude Code | Official plugin directory + community marketplaces | `plugins/claude-code/` | Ready to submit |
| Gemini CLI | Extensions Gallery (geminicli.com) | `plugins/gemini/` | Ready to submit |
| Codex CLI | No central registry (filesystem-based) | `plugins/codex/` | Ships via npm |
| OpenClaw | ClawHub | `skills/openclaw.md` | Ready to submit |

## Local Installer (Already Working)

Users who already know about Lore can install locally:

```bash
lore skills install claude-code    # adds MCP + skill to current project
lore skills install gemini         # adds extension + GEMINI.md
lore skills install codex          # adds skill + AGENTS.md instructions
lore skills install openclaw       # adds SKILL.md to ~/.openclaw/skills/lore/
```

The `lore setup` wizard (Step 6) also offers interactive installation.

This works but requires users to already have Lore installed. The registries below give **discoverability** — users find Lore while browsing for tools.

---

## Claude Code

### What we ship

```
plugins/claude-code/
├── .claude-plugin/
│   └── plugin.json        # Plugin manifest (name, description, author, repo)
├── .mcp.json              # MCP server auto-start config
└── skills/lore/
    └── SKILL.md           # Agent instructions (when to ingest, search, etc.)
```

### How to publish

**Option A: Official Plugin Directory (recommended)**

1. Go to the plugin submission form at https://claude.com/plugins
2. Submit the GitHub repo URL (https://github.com/getlore-ai/lore)
3. Point to `plugins/claude-code/` as the plugin root
4. Anthropic runs automated review
5. Optionally request "Anthropic Verified" badge (additional quality/safety review)
6. Once approved, users install with `/plugin install lore`

**Option B: Self-hosted Marketplace**

You can create your own marketplace with a git repo containing a `marketplace.json`:

```json
{
  "plugins": [
    {
      "name": "lore",
      "repository": "https://github.com/getlore-ai/lore",
      "path": "plugins/claude-code",
      "description": "Research knowledge repository with semantic search and citations"
    }
  ]
}
```

Users add the marketplace: `/plugin marketplace add <repo-url>`

Then install: `/plugin install lore`

**Option C: Direct install from GitHub**

Users can install without any registry:

```
/plugin install https://github.com/getlore-ai/lore/tree/main/plugins/claude-code
```

### References

- Plugin format: https://code.claude.com/docs/en/plugins-reference
- Marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Discovery: https://code.claude.com/docs/en/discover-plugins

---

## Gemini CLI

### What we ship

```
plugins/gemini/
├── gemini-extension.json    # Extension manifest (name, version, mcpServers)
└── GEMINI.md                # Context file with tool usage instructions
```

### How to publish

1. Ensure `plugins/gemini/` is accessible in the GitHub repo
2. Test locally:
   ```bash
   gemini extensions install ./plugins/gemini
   ```
3. Submit to the Extensions Gallery at https://geminicli.com/extensions/
4. Takes a few days to appear
5. Once listed, users find it by browsing the gallery

**Direct install from GitHub** (works without gallery listing):

```bash
gemini extensions install https://github.com/getlore-ai/lore --path plugins/gemini
```

### Notes

- Google does NOT vet third-party extensions — they include a warning
- Extensions are ranked by GitHub stars in the gallery
- The `mcpServers` field in `gemini-extension.json` auto-starts Lore's MCP server

### References

- Extensions docs: https://geminicli.com/docs/extensions/
- Gallery: https://geminicli.com/extensions/browse/
- Codelab: https://codelabs.developers.google.com/getting-started-gemini-cli-extensions

---

## Codex CLI (OpenAI)

### What we ship

```
plugins/codex/
├── SKILL.md                 # Skill file with YAML frontmatter
└── agents/
    └── openai.yaml          # MCP server dependency declaration
```

### How to publish

**There is no official Codex skills registry.** Skills are filesystem-based — Codex discovers them from:

- `~/.codex/skills/**/SKILL.md` (global)
- `./.agent/skills/**/SKILL.md` (project-local)

**Distribution options:**

1. **Via npm** (already works) — our npm package (`@getlore/cli`) ships with `plugins/codex/` included. Users run `lore skills install codex` to copy the skill to the right location.

2. **Via community tools** — third-party skill managers exist:
   - `codex-skills`: `npx codex-skills install @getlore/cli`
   - `skild`: universal skill package manager
   - `openskills`: skills loader

3. **Via GitHub** — users clone/copy `plugins/codex/` to `~/.codex/skills/lore/`

4. **OpenAI skills catalog** — community-maintained at https://github.com/openai/skills. Can submit a PR to be included.

**MCP server setup** (separate from skills):

```bash
codex mcp add lore -- npx -y @getlore/cli mcp
```

### References

- Skills docs: https://developers.openai.com/codex/skills/
- Create skills: https://developers.openai.com/codex/skills/create-skill/
- Skills catalog: https://github.com/openai/skills

---

## OpenClaw

### What we ship

```
skills/openclaw.md    # SKILL.md with YAML frontmatter (name, description, metadata)
```

### How to publish to ClawHub

1. Ensure your GitHub account is at least 1 week old
2. Go to https://clawhub.ai/
3. Publish the skill bundle (SKILL.md + supporting files)
4. ClawHub assigns a version and makes it discoverable
5. Users install with `clawhub install lore`

**Direct install** (without ClawHub):

```bash
lore skills install openclaw
# copies SKILL.md to ~/.openclaw/skills/lore/
```

### Security warning

ClawHub had a major security incident in Jan/Feb 2026 — 400+ malicious skills were published. There is no review process. Consider whether ClawHub publishing is worthwhile given the reputational risk of being in the same registry.

### References

- ClawHub: https://clawhub.ai/
- Skills spec: https://docs.openclaw.ai/tools/skills
- ClawHub docs: https://docs.openclaw.ai/tools/clawhub

---

## Checklist

- [ ] **Claude Code** — Submit to official plugin directory
- [ ] **Claude Code** — Consider self-hosted marketplace repo
- [ ] **Gemini CLI** — Submit to Extensions Gallery
- [ ] **Codex CLI** — Submit PR to openai/skills catalog
- [ ] **OpenClaw** — Publish to ClawHub (evaluate security concerns first)
- [ ] **All** — Add install instructions to README.md
- [ ] **All** — Bump version in plugin manifests when publishing updates
