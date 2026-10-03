# Dismiss reviews if stale

This GitHub Action compares the reviewed code with the current pull request. It
keeps approvals when a rebase or force push leaves the code unchanged, and
dismisses them when the code changes or the action can't compare it.

## Configure the workflows

Use the included workflows together:

1. [cache-approved-diff.yml](.github/workflows/cache-approved-diff.yml) saves the
   approved diff and commit metadata when a reviewer approves a pull request.
2. [dismiss-if-stale-review.yml](.github/workflows/dismiss-if-stale-review.yml)
   runs when a pull request opens, updates, or changes its base branch. The action
   checks for stale approvals after branch updates or base changes.

The action has two modes:

- `check-for-approvals` returns the latest approved commit SHA in `approved_sha`
  and its review ID in `review_id`. Both outputs are empty when the pull request
  has no approval.
- `dismiss-stale-reviews` compares the approved diff with the current pull
  request diff. Run this mode only when `review_id` is non-empty.

The included cache workflow needs `contents: read` and `pull-requests: read`. The
dismissal workflow needs `contents: read` and `pull-requests: write`. The action's
`token` input defaults to `github.token`. See [action.yml](action.yml) for all
inputs and outputs.

The example workflows use `./` because they run from this repository. In another
repository, set `uses` to a released `owner/repository@ref` instead.

## Develop

Install dependencies:

```bash
npm ci
```

Build and package the action:

```bash
npm run build && npm run package
```

After changing files in `src/`, commit the rebuilt `dist/` with your changes.
The `check-dist` workflow verifies that the bundle matches the source.

Run the tests:

```bash
npm test
```

## Release

After testing, follow the [GitHub Actions versioning
guide](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md)
to create a stable tag for workflows to use.
