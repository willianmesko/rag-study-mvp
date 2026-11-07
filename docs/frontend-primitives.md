# Frontend interaction primitives

The interface keeps React, TypeScript, Tailwind, native forms/dialogs and the
existing Radix controls. This is a consistency pass, not a new component library.

## Actions and semantic tokens

`styles.css` owns action surfaces, hover/active colors, text, borders, focus,
duration and target size. Semantic tokens reference the existing Tailwind palette;
resting colors and dimensions are preserved. Product components choose an action
variant rather than maintaining another copy of its state styles.

| Pattern | Use | States |
| --- | --- | --- |
| `primary-button` | Main action | Rest, hover, active, focus, disabled, busy |
| `secondary-button` | Supporting action | Same state contract |
| `danger-button` | Destructive confirmation | Same state contract, danger palette |
| `text-action` | Small button or link | Text hover/active/focus; disabled buttons stay inactive |
| `excerpt-action` | Native passage disclosure | Compact existing dimensions, shared link/focus colors |
| `menu-action` | Radix action items | Highlighted and disabled states |

Use native `disabled` for unavailable buttons. For a pending operation also set
`aria-busy`, directly or on its form/dialog; disabled actions retain their palette
and show a progress cursor. Labels describe the pending operation. CSS does not
make an `aria-disabled` anchor or an arbitrary element behaviorally disabled.

Focus uses `--action-focus-ring`; all controls preserve their box when focused.
`--action-duration` defines ordinary action transitions; the reduced-motion rule
continues to override motion throughout the interface.

## Modal ownership

`shared/ui/Overlay.tsx` is the only native `<dialog>` implementation. Compatible
centered dialogs and detail side panels use it, including creation, member edits,
original files, invitation, upload, demo libraries, the Milo guide and chat history.
Inline file details remain inline, avoiding another modal inside document details.

- Native `showModal()` supplies the browser's modal focus containment/inertness.
- A title, optional description, close control, size and optional initial focus
  establish a common accessible shell. Compact dialogs use the existing width.
- Escape and the close action respect `pending`. A native close is synchronized
  with controlled React state; cleanup does not call the close callback twice.
- Cleanup returns focus to the connected opener. If a destructive action removes
  that opener, `fallbackFocusRef` identifies a stable heading. No delayed focus
  timer or global DOM search is needed.
- A menu opening a modal restores its own trigger before mounting the modal.
  This avoids capturing a disappearing menu item as the return target.
- Radix Select and ActionMenu portals attach to the closest native dialog when
  present. Escape closes the active popup first and retains the parent dialog.
  Native option/item disabled semantics remain owned by Radix.

Sensitive actions still receive server-side authorization. A disabled button,
portal location or focus trap grants no security permission.

## Original-file lifetime

`features/open-original-document/model/use-original-file.ts` owns the authenticated
read, a 30-second deadline, the retry and the blob URL. Closing or changing the
resource aborts its read and revokes exactly the URL it created. A late response
after abort creates no URL. A document/workspace/session change displays loading
before exposing the new resource, rather than showing an old download link.

The API validates PDF/octet-stream content types and safe download names. Active
HTML is rejected. PDF opens in a separate tab with `noopener noreferrer`; other
files are downloaded. The inline and modal views share this lifetime policy.
Raw files, tokens and questions are not added to diagnostics or browser storage.

## Source presentation belongs to a domain slice

`entities/source/index.ts` exposes source previews, search results and RAG evidence.
These components use source contracts and belong to this entity, rather than
`shared/ui`. Internal excerpt disclosure and cosine formatting are reused inside
the slice. External consumers use its Public API; no global barrel is introduced.

Text remains React-escaped. Risk-blocked previews stay withheld. Similarity uses
the locale's decimal convention and remains a meaning match rather than a factual
confidence percentage. The explanation and distinction between cited/context
passages are retained.

## Verification

The existing full-product journeys exercise workspace creation, invitations,
member edits, uploads and file details. The focused primitives suite builds a
**test-only** browser entry with the existing Vite dependency and loads the real
production stylesheet; the entry is never imported by the product. It covers
nested Radix/native dialogs, pending dismissal, focus, blob lifetime, unsafe HTML,
escaped excerpts, contrast, reduced motion and viewport containment.

Desktop/tablet/mobile runs and existing Linux visual baselines remain release
gates. This does not claim exhaustive assistive-technology or real-account testing.
Publication evidence is recorded in the dated operations release document.
