
## Code in Main

> First, you'll need to have `node` v16.

Install the dependencies
```bash
$ npm install
```

Build the typescript and package it for distribution
```bash
$ npm run build && npm run package
```

Run the tests :heavy_check_mark:
```bash
$ npm test

 PASS  __tests__/range-diff.test.ts
 PASS  __tests__/range-diff-integration.test.ts

...
```

## Publishing

Actions run straight from the repo, so the bundled `dist/` is checked in. After
changing anything in `src/`, rebuild it with [ncc](https://github.com/vercel/ncc)
and commit the result with your change:
```bash
$ npm run build && npm run package
$ git add dist
```

The `check-dist` workflow fails any PR whose `dist/` doesn't match a fresh build.

## Validate

You can now validate the action by referencing `./` in a workflow in your repo (see [test.yml](.github/workflows/test.yml))

```yaml
uses: ./
with:
  mode: check-for-approvals
```

See [cache-approved-diff.yml](.github/workflows/cache-approved-diff.yml) and [dismiss-if-stale-review.yml](.github/workflows/dismiss-if-stale-review.yml) for the full `dismiss-stale-reviews` setup.

## Usage:

After testing you can [create a v1 tag](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md) to reference the stable and latest V1 action
