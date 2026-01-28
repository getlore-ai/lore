# Lore Data Repository

This is a template for your Lore knowledge data repository.

## Setup

1. Copy this template to your desired location:
   ```bash
   cp -r /path/to/lore/data-repo-template ~/lore-data
   cd ~/lore-data
   git init
   git add . && git commit -m "Initial lore data repo"
   ```

2. Set `LORE_DATA_DIR` to point here:
   ```bash
   export LORE_DATA_DIR=~/lore-data
   ```

3. (Optional) Push to a private remote for cross-machine sync:
   ```bash
   git remote add origin git@github.com:you/lore-data.git
   git push -u origin main
   ```

## Structure

```
.
├── sources/              # Ingested documents (auto-created)
├── retained/             # Explicitly saved insights (auto-created)
├── lore.lance/           # Vector index (git-ignored)
├── archived-projects.json # Archived projects list
└── .gitignore
```

## Syncing Across Machines

The Lore MCP server auto-syncs every 5 minutes:
1. `git pull` to fetch new sources
2. Indexes any new sources found

Set `LORE_AUTO_GIT_PULL=false` to disable auto-pull.
Set `LORE_AUTO_INDEX=false` to disable auto-indexing (saves API costs).
