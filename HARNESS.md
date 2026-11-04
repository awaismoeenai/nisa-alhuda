# Release harness

`main` is production. It serves **https://nisaalhuda.org** to real students, right now.

The rebuild does not go near it. The rebuild lives on **`rebuild-staging`**.

## The one rule

> Only Awais pushes to `main`, by hand, from `rebuild-staging`, after he has asked for it.

Nobody else, and nothing automatic. Not the tech lead, not a developer agent, not a
script, not a CI job.

## How it is enforced

**On GitHub** — a ruleset on `main` refuses pushes, force-pushes and deletions from
every account except `awaismoeenai`. That is what keeps other collaborators off it.

**On this machine** — a `pre-push` hook at
`~/product-team/harness/nisa-alhuda/pre-push`, installed with `core.hooksPath`, refuses
every push to `main` regardless of which account is logged in. That is what keeps the
agents off it, because the agents sign in as Awais and GitHub cannot tell them apart
from him. The hook covers every worktree and every branch, because the path is absolute.

The hook stands down only when this file exists:

    ~/product-team/harness/nisa-alhuda/ALLOW-MAIN-ONCE

## Releasing (Awais only)

```sh
touch ~/product-team/harness/nisa-alhuda/ALLOW-MAIN-ONCE
git push origin rebuild-staging:main
```

The unlock is spent by that single push. It does not stay open, and it does not
survive a mistake: if the branch is anything other than `rebuild-staging`, the push is
refused and the unlock is left untouched.

## For agents

Do not create `ALLOW-MAIN-ONCE`. Do not pass `--no-verify`. Do not change
`core.hooksPath`. Do not edit or delete the GitHub ruleset. If something needs to reach
production, put a release item in the inbox and keep working on something else.
