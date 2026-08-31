# GitHub Marketplace Listing

> **Read this first (2026-08-24).** A GitHub *Action* listing has no editable Short/Long
> Description or category fields; those belong to GitHub *App* listings. The live page
> https://github.com/marketplace/actions/publish-to-deploylog renders `action.yml`'s `description`
> as the tagline and `README.md` as the body, verified by fetching the page. So this file is a copy
> workbook, not a form to paste from: `action.yml` and `README.md` are the listing.

## Short Description (max 80 characters)

Publish changelogs from Releases. Check your manual still matches the code.

## Primary Category

Continuous Integration

## Secondary Category

Utilities

## Long Description

### Ship the update. Skip the busywork.

DeployLog turns your GitHub Releases into beautiful changelog entries on your product's website, automatically. When you publish a release, this Action creates a changelog entry on DeployLog, which then appears in your embeddable widget, hosted changelog page, and subscriber email digests.

Optionally, use AI to transform technical commit messages into user-friendly release notes your customers will actually read.

### Docs go stale quietly.

A constant changes, the sentence describing it does not, and nobody finds out until a customer reads the old number. Nothing fails. Nothing is flagged. The doc just stops being true.

Set `mode: verify` and this Action checks your DeployLog manual against the code it cites, on every pull request. When a cited value moves, the finding lands as an annotation on the changed line, next to the change that caused it.

It starts quiet. On the default setting the check stays green and the findings are informational, so adding it to a busy repository breaks nothing on day one. When you trust it, `fail-on: drift` makes stale docs fail the build.

### Features

- Trigger on `release.published` events
- Auto-generate user-facing notes from commits with Claude Haiku
- Notify email subscribers automatically
- Tag entries by type (feature, fix, improvement, breaking change)
- Zero configuration beyond an API key
- Verify your manual against the code it cites, on every pull request
- Findings appear inline on the changed line, not in a report nobody opens
- Green by default, so it cannot break an existing build the day you add it

### Quick Start

```yaml
name: Publish Changelog
on:
  release:
    types: [published]

jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: deploylogdev/action@v1
        with:
          api-key: ${{ secrets.DEPLOYLOG_API_KEY }}
          project: your-project-slug
          ai-summarize: true
          notify-subscribers: true
```

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | Yes | | Your DeployLog API key |
| `project` | Yes | | Project slug from your DeployLog dashboard |
| `mode` | No | `publish` | `publish` a release as a changelog entry, or `verify` your manual against the code |
| `ai-summarize` | No | `false` | Publish mode. Use AI to rewrite release notes for end users |
| `notify-subscribers` | No | `false` | Publish mode. Send email digest to subscribers on publish |
| `entry-type` | No | `feature` | Publish mode. feature, fix, improvement, breaking |
| `fail-on` | No | `none` | Verify mode. `none`, `drift`, or `any` |
| `github-token` | No | | Verify mode. Scopes the check to a pull request's changed files |
| `skip-prerelease` | No | `false` | Publish mode. Skip GitHub prereleases |
| `api-url` | No | | Override the API base URL for staging or self-hosted |

### Requirements

- A free DeployLog account. Sign up at [deploylog.dev](https://deploylog.dev)
- A DeployLog API key stored as a GitHub Secret (`DEPLOYLOG_API_KEY`)

### How It Works

1. You publish a GitHub Release (with a tag, title, and release notes)
2. This Action sends the release data to your DeployLog project
3. If `ai-summarize` is enabled, the release notes are rewritten for non-technical users
4. A changelog entry is created and published automatically
5. The entry appears on your embeddable widget, hosted changelog page, and RSS feed
6. If `notify-subscribers` is enabled, confirmed email subscribers receive a digest

### Links

- **Documentation:** [github.com/deploylogdev/action](https://github.com/deploylogdev/action#readme)
- **Support:** [github.com/deploylogdev/action/issues](https://github.com/deploylogdev/action/issues)
- **Privacy Policy:** [deploylog.dev/privacy](https://deploylog.dev/privacy)
- **Terms of Service:** [deploylog.dev/terms](https://deploylog.dev/terms)

---

## Marketplace Metadata

- **Logo:** `icon.png` (200x200px, solid background)
- **Background color:** `#FFFFFF`
- **Support URL:** `https://github.com/deploylogdev/action/issues`
- **Privacy Policy URL:** `https://deploylog.dev/privacy`
- **Terms of Service URL:** `https://deploylog.dev/terms`
