---
name: replit-migrate
description: Main replit-migrate entry. Dispatches to a subcommand based on your request, or lists options if unclear. Use `replit-migrate:<subcommand>` to target a specific action directly.
argument-hint: "[what you want to do]"
---

# /replit-migrate — Router

Route this request to the appropriate replit-migrate subcommand or skill based on the user's intent.

**Raw user input**: $ARGUMENTS

## Routing logic

1. If `$ARGUMENTS` is empty or only whitespace: list the available subcommands below and ask the user what they want to do.
2. Otherwise: match the user's natural-language request against the subcommand intents below and invoke the best match.
3. If the request clearly doesn't fit any subcommand but matches a `replit-migrate` skill (listed in your available skills), load the skill and follow its guidance instead.
4. If nothing fits, say so and list the subcommands. Do NOT guess.

## Available subcommands

- **`/replit-migrate:migrate`** — Generate and begin executing a migration plan
- **`/replit-migrate:scan`** — Scan a Replit project for migration readiness


## Examples

- User types `/replit-migrate` alone → list subcommands, ask for direction
- User types `/replit-migrate <free-form request>` → match intent, invoke subcommand
- User types `/replit-migrate:<specific>` → bypass this router entirely (direct invocation)

## Rules

- Prefer the most specific subcommand match. If two could fit, ask which.
- Never invent a new subcommand. Only route to ones listed above.
- If the user is describing a workflow that spans multiple subcommands, outline the sequence and ask whether to proceed.
