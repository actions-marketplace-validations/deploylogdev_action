---
number: "06"
title: "GitHub"
---

# GitHub

The Action has two modes. Publish turns a GitHub Release, the tagged artifact GitHub creates when you cut a version, into a changelog entry on your DeployLog project. Verify checks a DeployLog manual, the prose whose sentences carry claims pointing at code, against the code it cites.

**Set `mode` yourself.** It is never inferred from the event. The default is `publish`, and any other spelling fails the run with `Invalid mode`, listing the two it accepts.

## Inputs

| Input | Default | What it does |
|-------|---------|--------------|
| `api-key` | required | Your DeployLog API key. Store it as a repository secret. |
| `project` | required | Project slug from your dashboard. |
| `mode` | `publish` | `publish` or `verify`. |
| `entry-type` | `feature` | Publish mode. The entry's type. |
| `ai-summarize` | `false` | Publish mode. Rewrite the release body for end users. |
| `notify-subscribers` | `false` | Publish mode. Publish immediately so subscribers get a digest. |
| `skip-prerelease` | `false` | Publish mode. Skip GitHub prereleases instead of filing them. |
| `fail-on` | `none` | Verify mode. Which findings fail the check. |
| `github-token` | empty | Verify mode. Scopes the check to the pull request's changed files. |
| `api-url` | `https://deploylog.dev` | Override the API base URL. |

The five entry types are `feature`, `fix`, `improvement`, `breaking`, and `announcement`. Anything else fails the run with `Invalid entry-type`.

The key must start with `dk_`. A key that does not fails the run with `Keys issued by DeployLog start with "dk_".` before anything is sent.

Booleans take `true`, `1`, `yes`, `false`, `0`, or `no`, in any case. Anything else fails the run with `Expected true or false.`

## Publish

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
          project: my-app
          entry-type: fix
          ai-summarize: true
          notify-subscribers: true
```

The Action reads the release title, tag, and body. With `ai-summarize` on, the body is rewritten into user-facing release notes. The entry appears on your widget, hosted changelog page, and RSS feed. With `notify-subscribers` on, email subscribers receive a digest.

The entry's title is the release name, or the tag when the release has no name, or the word `Release` when it has neither.

### Versions from tags

`v1.4.0` files under 1.4.0. Build metadata is dropped: `1.0.0+build.42` is version 1.0.0.

**A prerelease tag yields no version.** `v2.0.0-beta.1` is not 2.0.0, so the entry publishes with its title and body and no version number. To keep release candidates out of the changelog entirely, set `skip-prerelease: true`; those releases are then skipped rather than filed.

### Outputs

Publish mode sets `entry-id`, `entry-slug`, `entry-published`, `ai-used`.

## Verify

The manual being checked is the one DeployLog holds for the project whose slug you pass; the Action reads nothing from files in the workflow. What a manual is, and what a claim is, is chapter 10. Drift is a claim whose cited value moved: the manual says one thing, the code says another. An annotation is a finding GitHub draws inline on a changed line of the pull request.

```yaml
name: Manual check
on: pull_request

permissions:
  contents: read
  pull-requests: read

jobs:
  manual:
    runs-on: ubuntu-latest
    steps:
      - uses: deploylogdev/action@v1
        with:
          api-key: ${{ secrets.DEPLOYLOG_API_KEY }}
          project: my-app
          mode: verify
          github-token: ${{ github.token }}
```

No `actions/checkout` step is needed. The check runs on DeployLog, which reads your repository through the DeployLog GitHub App you installed when you connected it; the workflow itself never touches the code. Without a token, the run verifies the whole manual instead of just what the pull request touched.

### What `fail-on` does

| Value | The check fails when |
|-------|----------------------|
| `none` | Never. Findings are annotated and summarised, and the check stays green. |
| `drift` | A cited value moved. |
| `any` | Also when the run could not vouch for the manual. |

The drift count is the number of confirmed drifted claims, and nothing else folds into it. Claims that could not be read, chapters with no claims, chapters with thin coverage, and claims in a repository nothing watches are reported separately, and only `fail-on: any` fails on them.

A value outside those three fails the run with `Invalid value for fail-on`.

`fail-on` selects which findings fail the check, not whether the check can fail. If the run cannot reach DeployLog at all, it fails at every setting, `none` included.

A run in one repository can only check the claims that cite that repository; claims citing the manual's other repositories count as untriggered on that run. So a manual citing four repositories reports three untriggered from any one of them, and fail-on: any would fail a manual with no drift at all until every cited repository runs the Action. Use fail-on: drift until they do.

### How drift surfaces on a pull request

Findings land as annotations on the changed lines. GitHub caps how many it draws per run; past that cap, the job summary, the Summary tab of the workflow run on GitHub names the count shown, the total, and lists every finding it dropped with its file, line, and message, so the cap never reads as coverage.

Findings with no line to attach to, every unreadable claim with its reason code, and every reason the run is not clean go in the job summary too. On a clean run, the summary is empty, and nothing is written.

Verify mode sets `drift-count` (claims whose cited value moved), `error-count` (claims that could not be read), `unanchored-count` (chapters with no claims), `untriggered-count` (claims citing a repository this run did not check), `low-coverage-chapters` (chapters whose sentences with concrete values mostly carry no claim), and `check-failed`.

Every run checks from scratch; a run changes nothing in the manual and remembers nothing from earlier runs.

### Pull requests from forks

GitHub withholds repository secrets from fork pull requests, so the key arrives empty, and the run fails with `Input required and not supplied: api-key`. Gate the job on the head repository until that changes.

## Getting the project and the key

1. Create a project in the dashboard and copy the project slug.
2. Generate an API key from the dashboard.
3. Add it as a repository secret named `DEPLOYLOG_API_KEY`.

The publish workflow triggers on `types: [published]`, so it never touches releases you published before the workflow landed. Add those entries from the dashboard, where existing GitHub Releases can be brought in and filed against the same project.

Chapter 10 covers writing the manual the check reads. Chapter 05 covers running the same check outside CI.

