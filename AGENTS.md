# AGENTS.md

## Scope

This package is a custom fork of the London Ghost theme (https://github.com/TryGhost/London).

## Commands

Use pnpm, pinned by `package.json`.

```bash
pnpm install
pnpm dev
pnpm test
pnpm zip
```


## Boundaries

- Edit source CSS in `assets/css/`, source JavaScript in `assets/js/`, and templates/partials as `.hbs` files.
- Keep generated `assets/built/` files in sync when source assets change.
- Do not commit `node_modules/`, secrets, or local Ghost content.
- Translation changes normally belong in `TryGhost/Themes/packages/theme-translations`; package-local locale overrides should be intentional and rebuilt.
