# Release harness

`main` is production. It serves **https://nisaalhuda.org** to real students, right now.

The rebuild does not go near it. The rebuild lives on **`rebuild-staging`**.

## The one rule

> Only Awais pushes to `main`, by hand, from `rebuild-staging`, after he has asked for it.

Nobody else, and nothing automatic. Not the tech lead, not a developer agent, not a
script, not a CI job.

## Why one lock was not enough

The agents sign in to GitHub as `awaismoeenai` — Awais's own account. GitHub cannot tell
an agent's push from Awais's, because they are the same account holding the same token.
So a GitHub rule alone would let every agent straight through, and a rule on this Mac
alone would do nothing about the four other people who can push.

Three locks, each covering what the others cannot.

### 1. GitHub — keeps other accounts off main

Ruleset **"main is production"** (`26571053`): updates, force-pushes and deletions of
`refs/heads/main` are refused for everyone except the repository **admin** role.
`awaismoeenai` is the only admin; `kareemunnisa`, `salmas233`, `muhammadawaismoeen` and
`muhammadawaismoeennaseeha` all hold plain `write`, so GitHub itself now refuses them.

Ruleset **"rebuild-staging is not disposable"** (`26571193`) does the same for deletion
and force-push on the rebuild branch, so months of work cannot be wiped by one bad
command.

### 2. The agent guard — keeps the agents off main, even with `--no-verify`

`~/product-team/team/hooks/guard.js`, registered as a `PreToolUse` hook in
`~/.claude/settings.json`. It inspects the command *before* git ever runs, so
`--no-verify` does not help. Any push to `main` is refused outright unless Awais has
answered a `release` item in the inbox **for this project** within the last twelve hours.

### 3. The git hook — the last catch

`~/product-team/harness/nisa-alhuda/pre-push`, installed with `core.hooksPath`, refuses
every push to `main` whatever account is logged in. The path is absolute, so it covers
every worktree and every branch, including ones that do not contain this file.

It stands down only when this file exists:

    ~/product-team/harness/nisa-alhuda/ALLOW-MAIN-ONCE

## Releasing (Awais only)

Create the unlock file above, then push `rebuild-staging` onto `main`:

    touch ~/product-team/harness/nisa-alhuda/ALLOW-MAIN-ONCE
    git push origin rebuild-staging:main

The unlock is spent by that single push. It does not stay open, and it does not survive a
mistake: if the source branch is anything but `rebuild-staging`, the push is refused and
the unlock is left where it was.

## For agents

Do not create `ALLOW-MAIN-ONCE`. Do not pass `--no-verify`. Do not change
`core.hooksPath`. Do not edit or delete either ruleset. If something needs to reach
production, put a release item in the inbox and go work on another card.
