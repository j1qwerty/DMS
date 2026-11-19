# Command Palette / Global Search

Fuzzy search + navigation dialog for the record room. Custom-built on the
shared `Modal` (focus trap, Escape, body scroll lock) — no `cmdk` dependency.

## Entry points

### 1. Top-bar trigger — visible on every page (round 5)

`src/layouts/Topbar.tsx` renders a button styled like a search field between
the back button and the status controls. It is always mounted, on every
route (the old inline topbar search, which hid itself on `/files`, is gone).

```tsx
<button
  type="button"
  onClick={() => setPaletteOpen(true)}
  aria-label="Open search and commands"
  className="focus-ring flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-base bg-[var(--rr-bg)] pl-3.5 pr-3 text-left md:max-w-xl"
>
  <MagnifyingGlass size={17} className="muted shrink-0" />
  <span className="muted min-w-0 flex-1 truncate text-sm">Search or jump to…</span>
  <kbd className="muted hidden shrink-0 rounded border border-base px-1.5 text-[11px] sm:inline">
    Ctrl K
  </kbd>
</button>
```

The palette mounts next to it: `<CommandPalette open={paletteOpen} onClose={…} />`.

### 2. Keyboard shortcuts (window listener in `Topbar.tsx`)

| Shortcut | Effect |
|---|---|
| `Ctrl+K` / `Cmd+K` | Opens the palette from anywhere (`preventDefault`, even inside inputs) |
| `/` | Opens the palette when the focus is not in an input/textarea/select |
| `Esc` | Closes (handled by `Modal`) |
| Type / ↑↓ / Enter | Filter, move the highlight, run the highlighted item |

## How the palette is built (`src/components/CommandPalette.tsx`)

- `Modal` shell with title "Find a file, a search or a page".
- One input (autofocus), a single flat list, arrow-key highlight state.
- File results come from the same service search the registry uses:
  `service.files.list({ search, pageSize: 8 })`, debounced 220 ms, gated on
  the palette being open.
- Each file row shows which metadata field matched (`matchContext`:
  barcode / file number / subject / location / e-office / department).
- Recent searches (`lib/recent.ts`) replay into the registry; recent files
  jump straight to `/files/:id`.
- Empty result with a typed term → Enter still searches the full registry.
- Footer hint: `↑↓ to move · Enter to open · Esc to close`.

## Command list

`COMMANDS` in the same file — destinations filtered by role (`permission`) and
feature (`barcode`). Labels and routes (round 5):

| Label | `to` | Gate |
|---|---|---|
| Registry | `/files` | — |
| Search the registry | `/search` | — |
| Overview dashboard | `/overview` | — |
| Issue desk | `/issue` | — |
| Return desk | `/return` | — |
| Movement log | `/movement` | — |
| Digitization worklist | `/digitization` | — |
| Review queue | `/review` | `digitization.view` |
| Reports | `/reports` | — |
| Locations | `/rooms` | — |
| Barcodes | `/barcodes` | `barcode` feature |
| Scan desk | `/scan` | `barcode` feature |
| Maps | `/maps` | `files.view` |
| Employees | `/admin/employees` | `employees.view` |
| Locations designer | `/admin/locations` | `locations.view` |
| Logins | `/admin/users` | `users.view` |
| Audit trail | `/admin/audit` | `audit.view` |
| Settings | `/settings` | — |
| Support | `/support` | — |

The sidebar shows the same destinations; the palette is the keyboard shortcut
to them.

## Product note

This app deliberately uses **no `?` info tags / InfoTip** anywhere — the
palette's placeholder and row labels carry the explanation instead.
