# School Buddy 🎒

Een maatje op de MacBook van een middelbare scholier: haalt het rooster en
huiswerk uit Somtoday, vraagt op het juiste moment "heb je huiswerk gekregen?",
en toont alles op een lokale weekpagina. Zie `RESEARCH.md` voor de research en
architectuurbeslissingen.

## Onderdelen

- **`apps/daemon`** — Bun + Effect v4 (RC) daemon: Somtoday-sync (OAuth PKCE +
  roterende refresh tokens in de Keychain), SQLite-opslag, scheduler,
  vraag-planning, HTTP API + weekpagina op `http://127.0.0.1:4823`.
- **`apps/web`** — React + Effect weekoverzicht (rooster, huiswerk afvinken,
  huiswerk toevoegen, chat), gebundeld met Bun en geserveerd door de daemon.
- **`packages/shared`** — Effect Schema domeinmodellen, gedeeld door beide.
- **`hammerspoon/`** — macOS-companion: menubalk-icoon, lid open/dicht
  detectie (wake/sleep/lock/unlock), popupvragen met tekstinvoer.
- **`launchd/` + `install.sh`** — deployment zonder Apple Developer-account.

## Installatie (op de laptop van de scholier)

### Via een GitHub-release (aanbevolen — geen Bun/Node nodig)

Download de nieuwste `school-buddy-<versie>-darwin-arm64.tar.gz` (Apple Silicon)
of `...-darwin-x64.tar.gz` (Intel) van de
[releases-pagina](https://github.com/joepjoosten/school-buddy/releases), en:

```sh
tar -xzf school-buddy-*.tar.gz && cd school-buddy-*/
./install.sh
# daarna, eenmalig Somtoday koppelen (Microsoft-login in de browser):
~/.school-buddy/app/school-buddy setup "<schoolnaam>"
```

Een release maken: push een tag (`git tag v0.1.0 && git push --tags`) — de
`Release`-workflow compileert de binaries en publiceert de tarballs.

### Updaten

- Handmatig: `~/.school-buddy/app/school-buddy update` (of `update --check`),
  of via het 🎒-menu → "Update installeren".
- Automatisch: de daemon checkt dagelijks op nieuwe releases en meldt het met
  een popup + in de weekpagina; de update zelf start je via het menu.
- **Privé repo?** Zet dan een fine-grained read-only token op de laptop:
  `security add-generic-password -s school-buddy -a github.token -w <token>`
  (zonder token werkt updaten alleen bij een publieke repo).

### Vanuit de repo (development)

```sh
git clone git@github.com:joepjoosten/school-buddy.git && cd school-buddy
./install.sh
cd apps/daemon && bun run setup "<schoolnaam>"
```

## Ontwikkelen

```sh
bun install
bun run --filter @school-buddy/daemon dev   # daemon met watch
(cd apps/web && bun run build)              # frontend bundelen
bun run typecheck                           # tsc over alle packages
```
