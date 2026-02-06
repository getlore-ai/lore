# Releasing a New Version

## Quick Release

```bash
# 1. Bump version (patch/minor/major)
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0

# 2. Publish (builds automatically via prepublishOnly)
npm publish

# 3. Push the version commit and tag
git push && git push --tags
```

That's it. `npm version` updates `package.json`, creates a git commit, and tags it. `npm publish` runs `npm run build` automatically before publishing.

## Step by Step

### 1. Make sure you're on a clean main branch

```bash
git status          # No uncommitted changes
git pull            # Up to date
```

### 2. Bump the version

```bash
npm version patch   # Bug fixes
npm version minor   # New features
npm version major   # Breaking changes
```

This does three things automatically:
- Updates `version` in `package.json`
- Creates a git commit: `v0.1.1`
- Creates a git tag: `v0.1.1`

### 3. Publish to npm

```bash
npm publish
```

The `prepublishOnly` script runs `npm run build` before publishing, so you don't need to build manually.

### 4. Push to GitHub

```bash
git push && git push --tags
```

## Verify

```bash
# Check the published version
npm view @getlore/cli version

# Test install
npx @getlore/cli --version
```

## What Gets Published

Only these files are included (controlled by `files` in `package.json`):

```
dist/           # Compiled JavaScript
plugins/        # Agent platform plugins (Claude Code, Gemini, Codex)
skills/         # Agent skill files (OpenClaw, generic)
README.md       # Package readme
LICENSE         # License
package.json    # Auto-included
```

Everything else (source code, site, docs, tests, config) is excluded.

## Deploying the Website

The `site/` directory deploys to Vercel separately. Push to `main` and Vercel auto-deploys (once connected).
