# deploylog-action

The GitHub Action that publishes a changelog entry to DeployLog when a GitHub Release
is published. Ships as `deploylogdev/action@v1` on the GitHub Marketplace. One of three
satellites around `../deploylog`; the others are `../deploylog-cli` and `../deploylog-widget`.

## Run it

```bash
npm run typecheck
npm test
npm run build      # esbuild bundle
npm run package    # what actually ships - see the dist rule below
```

## Shape

`action.yml` is the public contract: inputs, defaults, and the `dist/` entry point.
`src/` is the TypeScript; `dist/` is the committed bundle GitHub actually executes.

## Decisions

- **`dist/` is committed on purpose.** GitHub Actions runs the checked-in bundle - it
  does not install dependencies. A change to `src/` that is not rebuilt into `dist/`
  ships nothing.
- **Always rebuild clean before committing `dist/`.** esbuild's `__toESM` interop helper
  has differed between CI and local, producing a diff that is noise on a good day and a
  behaviour change on a bad one.
- **Marketplace requires a real `LICENSE` file.** The `license` field in `package.json`
  is not sufficient; the listing is rejected without the file.
- **`gh release` pins to a tag ref, not a SHA.** Re-tagging a release without
  `gh release delete --cleanup-tag` first leaves consumers on the old commit.

## Conventions

Match the sibling repos: strict TypeScript, `vitest`, one concern per commit, and a
test that fails without the change. Version bumps move the `v1` major tag as well as
the point tag, or existing workflows never see the fix.
