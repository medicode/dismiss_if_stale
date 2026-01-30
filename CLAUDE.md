# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GitHub Action (TypeScript) that automatically dismisses stale pull request reviews when code changes. Unlike GitHub's built-in dismiss-if-stale functionality, this action correctly handles rebased or force-pushed branches by comparing actual diffs rather than just commit SHAs.

## Build Commands

```bash
npm run build      # Compile TypeScript (src/ → lib/)
npm run package    # Bundle for distribution (lib/ → dist/index.js)
npm run lint       # Run ESLint on src/**/*.ts
npm run format     # Auto-format with Prettier
npm test           # Run Jest tests
npm run all        # Run build, format, lint, package, and test
```

The `dist/index.js` bundle is what GitHub Actions executes. After making changes to source files, run `npm run build && npm run package` to update the distribution.

## Architecture

The action operates in two modes controlled by the `mode` input parameter:

1. **check-for-approvals**: Checks if a PR has approvals and returns the approved commit SHA and review ID
2. **dismiss-stale-reviews**: Compares the currently approved diff with the latest PR diff and dismisses reviews if they differ

### Source Files

- **src/main.ts**: Entry point that routes to the appropriate mode handler
- **src/check-for-approvals.ts**: Retrieves approval status, commit SHA, and review ID
- **src/dismiss-if-stale.ts**: Core logic for diff comparison and stale detection. Handles both three-dot and two-dot diffs, and supports cached diffs for when base branches are deleted
- **src/pull-request.ts**: GitHub API wrapper for fetching reviews, events, and comparing commits

### Key Concepts

- **Three-dot diff**: GitHub's default comparison showing changes between branches (what GitHub UI shows)
- **Two-dot diff**: Direct commit-to-commit comparison, generated via git when needed
- **Diff normalization**: Removes metadata (timestamps, line numbers) to compare only actual code changes
- **Cached diffs**: Workflow can cache the approved diff to handle branch deletion scenarios
- **Review ID cache key**: Cache is keyed by review ID (not commit SHA) because GitHub updates the review's `commit_id` field after force pushes, but review IDs are immutable

## Testing Locally

The action uses `@actions/core` and `@actions/github` which expect GitHub Actions environment variables. Tests are minimal (placeholder only). To test changes, the recommended approach is to use the action in a real workflow.

## Workflow Integration

See `.github/workflows/` for example workflows:
- `cache-approved-diff.yml`: Caches diff and metadata when PR is approved (keyed by review ID)
- `dismiss-if-stale-review.yml`: Runs on PR sync/edit to dismiss stale reviews (looks up cache by review ID)
