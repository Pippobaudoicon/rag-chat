# Contributing to ChatLDS

Start with the [README](README.md) for setup and
[docs/PROJECT_INFO.md](docs/PROJECT_INFO.md) for architecture and operational
context. Follow [AGENTS.md](AGENTS.md) when changing the repository.

## Before making a change

Search [existing issues](https://github.com/Pippobaudoicon/rag-chat/issues).
For a feature or substantial change, open an issue describing the problem and
proposed behavior before starting. Small documentation corrections can go
directly into a pull request.

Keep changes focused. Match surrounding conventions, prefer concrete code, and
avoid unrelated refactors, new abstractions, or dependencies.

## Development workflow

1. Create a branch from the current default branch.
2. Make the smallest change that solves the agreed problem.
3. Run `pnpm run docs:guard` and `pnpm run check`.
4. For application changes, also run `pnpm run build` and describe any manual
   verification performed.
5. Open a pull request explaining the problem, resulting behavior, and validation.

Next.js APIs in this project may differ from older versions. Read the relevant
guide in `node_modules/next/dist/docs/` before changing Next.js code.
Authenticated browser/UI verification is manual; do not automate it against
ChatLDS.

## Documentation and versions

- Bump the third version component in `package.json` and add an entry in
  [CHANGELOG.md](CHANGELOG.md) for each change.
- Update [docs/PROJECT_INFO.md](docs/PROJECT_INFO.md) when architecture, APIs,
  integrations, environment requirements, or major user flows change.
- For changes affecting the native client, update [docs/MOBILE.md](docs/MOBILE.md)
  and the relevant code in the sibling `chatlds-mobile` project when needed.
- Maintainers also keep the linked Obsidian project wiki in sync with behavior,
  corpus contracts, and operational changes.

## Pull request checklist

- The description explains what users or developers will experience differently.
- Changes stay within the requested scope.
- Relevant checks pass, or failures are clearly identified.
- Version, changelog, and affected documentation are updated.
- No credentials, private conversations, or generated local files are included.

## License

Contributions are covered by the project's [Apache License 2.0](LICENSE),
subject to its contribution terms. Preserve existing third-party notices.

Use [SUPPORT.md](SUPPORT.md) for help and [SECURITY.md](SECURITY.md) for
vulnerability reporting.
