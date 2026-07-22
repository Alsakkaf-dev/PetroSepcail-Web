# @petrospecial/ui — PC-08 design system

The single component source every system's `06-ui-ux-specification.md` references
(TC-PC08-004). Standalone React 18.3.1 library — **not yet wired into
`apps/store|admin|driver`** (those stay S00 placeholder scaffolds until their
owning consumer sessions land; see `platform-docs/MASTER-ROADMAP.md` S06).

## Tokens

`src/tokens/tokens.generated.css` is mechanically generated from
`assets/css/styles.css`'s `:root` block by `scripts/generate-ui-tokens.mjs` —
re-run `npm run tokens:generate -w @petrospecial/ui` after editing the site
stylesheet's tokens. Every component below references these custom properties
only; `src/a11y/tokenAudit.test.ts` (TC-PC08-001) fails the build on any
literal hex/px that duplicates a token's value.

`src/tokens/base.css` adds the minimal accessible baseline (focus-visible
ring, `prefers-reduced-motion`, the `.ps-ltr` numerals/phone/code isolate) so
components stay accessible even before a consumer imports the full site
stylesheet.

## Direction (RTL/LTR)

No component branches its markup on `dir`/`lang` — mirroring comes entirely
from CSS logical properties (`margin-inline`, `inset-inline`, `border-inline-*`,
`text-align: start`, etc.), driven by the ancestor `<html dir lang>` the
consuming app sets (PC-07 §2). Every component has a matching
`*.test.tsx` assertion (`testing/domSnapshot.ts`, TC-PC08-002) that renders it
once under `dir="rtl" lang="ar"` and once under `dir="ltr" lang="en"` and
diffs the resulting element tree — same tags/classes both times, only text
and inherited direction differ. The AR/EN usage snippets below are exactly
what those tests render.

## Components

### Badge
Status/label chip. `variant`: `neutral | gold | blue | flame`. Every variant
pairs its background with `--ink` foreground text (not the accent as
foreground) so contrast holds at any size.
```tsx
// AR (RTL)
<Badge variant="gold">شارة</Badge>
// EN (LTR)
<Badge variant="gold">Badge</Badge>
```

### Button
`variant`: `gold | ghost | dark | danger` · `size`: `sm | md | lg` · `busy`
shows a spinner + `aria-busy` and disables clicks. `danger` uses `--flame` as
a *background* (paired with `--ink` text), never as foreground text — see
Accessibility below.
```tsx
<Button variant="danger" onClick={onDelete}>حذف</Button>
<Button variant="danger" onClick={onDelete}>Delete</Button>
```

### Card
Surface container with optional `CardHeader`/`CardFooter` slots.
```tsx
<Card><CardHeader>عنوان</CardHeader>المحتوى<CardFooter>إجراءات</CardFooter></Card>
<Card><CardHeader>Title</CardHeader>Body<CardFooter>Actions</CardFooter></Card>
```

### TextField
Labelled input with hint/error states (PC-08 §3) and `forceLtr` for
numerals/email/phone fields that must stay LTR inside an RTL document
(PC-08 §1 site behavior).
```tsx
<TextField label="البريد الإلكتروني" forceLtr required error="خطأ" />
<TextField label="Email" forceLtr required error="Error" />
```

### Dialog
Accessible modal: `role="dialog"` + `aria-modal`, focus moves in on open and
returns to the trigger on close, Tab is trapped inside, Escape and
backdrop-click both close.
```tsx
<Dialog open onClose={close} title="تأكيد" closeLabel="إغلاق">هل أنت متأكد؟</Dialog>
<Dialog open onClose={close} title="Confirm" closeLabel="Close">Are you sure?</Dialog>
```

### Table
Generic `columns`/`rows` table wrapped in a horizontally-scrolling container
(wide content scrolls inside, the page never does — site convention). Folds
in the three non-ready universal states via `state="loading" | "error" | "empty"`.
```tsx
<Table columns={cols} rows={rows} getRowKey={(r) => r.id} caption="المنتجات" />
<Table columns={cols} rows={rows} getRowKey={(r) => r.id} caption="Products" />
```

### Toast (`ToastProvider` / `useToast` / `ToastViewport`)
`push({ title, description?, variant, duration })` from anywhere under
`ToastProvider`. The viewport is positioned `inset-block-start`/
`inset-inline-start` (PC-08 §3: "top-inline-start in RTL"), so it renders
top-right in AR/RTL and top-left in EN/LTR with no direction-specific code.
```tsx
const { push } = useToast();
push({ title: "تم الحفظ", variant: "success" });
push({ title: "Saved", variant: "success" });
```

### Header (Nav)
Site header: logo slot, nav links (`aria-current="page"` for the active
one), a language-toggle slot, an actions slot, and a menu button that
collapses the nav below the `--container` breakpoint (PC-08 §5).
```tsx
<Header logo={<Logo />} navItems={arItems} languageSlot={<LanguageToggle .../>} menuLabel="القائمة" />
<Header logo={<Logo />} navItems={enItems} languageSlot={<LanguageToggle .../>} menuLabel="Menu" />
```

### LanguageToggle
Mirrors the live static site's single toggle button exactly: it always shows
the *target* language's label ("EN" while the page is in Arabic, "عربي"
while in English), not a two-way segmented control.
```tsx
<LanguageToggle locale="ar" onToggle={setLocale} ariaLabel={{ ar: "تبديل اللغة", en: "Switch language" }} />
<LanguageToggle locale="en" onToggle={setLocale} ariaLabel={{ ar: "تبديل اللغة", en: "Switch language" }} />
```

### EmptyState / LoadingState / ErrorState
The three non-"ready" universal states every data-bearing screen must specify
(PC-08 §3). `LoadingState` renders skeleton lines on `--bg-warm` (never a
bare spinner for content areas). `ErrorState`/inline `TextField` errors
render their message in `--ink` with a `--flame` accent (dot/border), not
`--flame` text — see Accessibility.
```tsx
<EmptyState title="لا توجد طلبات" description="..." action={<Button>تسوق الآن</Button>} />
<EmptyState title="No orders yet" description="..." action={<Button>Shop now</Button>} />

<LoadingState lines={5} label="جارٍ التحميل" />
<LoadingState lines={5} label="Loading" />

<ErrorState message="SERVER_ERROR" onRetry={retry} retryLabel="إعادة المحاولة" />
<ErrorState message="SERVER_ERROR" onRetry={retry} retryLabel="Retry" />
```

## Accessibility (TC-PC08-003)

- `src/a11y/contrast.ts` + `contrast.test.ts` assert every token pair actually
  used as text meets WCAG AA (4.5:1). `--gold`, `--gold-700`, and `--flame`
  each fail AA at normal text size alone (1.55:1 / 3.75:1 / 3.37:1 on
  `--surface`) — per PC-08 §6's explicit "gold-on-white ... never small body"
  rule, extended here to `--flame` too (not spelled out in the spec, treated
  as a SPEC-GAP in the same spirit): all three are used only as **backgrounds**
  (paired with `--ink`, which passes) or non-text accents (icons, borders,
  dots), never as small/normal foreground text.
- Every interactive element is >= 44px in both dimensions (`contrast.test.ts`
  greps every component's CSS for this); `tokens/base.css` defines a 3px
  `--blue-600` `:focus-visible` ring inherited by every component.
