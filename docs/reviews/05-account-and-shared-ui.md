# Account and shared UI review

Scope: all non-generated implementation files in src/components/account/, src/components/ui/, src/components/reui/, theme-provider.tsx and app-toaster.tsx. Read installed Base UI and Better Auth implementations to check primitive behavior. No production files changed.

## Critical

None identified.

## High

None identified.

## Medium

1. Account state survives session loss or user changes — src/components/account/use-account-settings.ts:52-81; src/components/account/AccountManager.tsx:28. Status: FIXED. Triage confirmed: session loss left open=true and retained prior accounts/errors; switching users left previous accounts actionable if the new load failed; and in-flight actions completed across session changes. Fixed by resetting open, accounts, loading, error, and accountsError on session loss; clearing user-scoped state whenever session.user.id changes; keying load effects by userId; and ignoring stale action completions if the active userId or action generation changed. Validated with unit tests in AccountManager.test.tsx covering session loss dialog reset, user-switching state clearance, and stale action error suppression.

2. One Tap is not cancelled when its owner becomes inactive — src/components/account/OneTapPrompt.tsx:10-34. The effect has no cleanup. A visible prompt or in-flight script load survives unmount/session changes; a late initialization can also show the prompt after explicit passkey sign-in already called cancelOneTapPrompt. Cancel the prompt on teardown/session acquisition and put the asynchronous initialization behind a cancellation/generation guard. A cancellation call alone cannot stop initialization after script loading finishes.

3. Consumer pointer callbacks replace color-picker behavior — src/components/reui/color-picker.tsx:1993-1994, 2101-2102. ColorPickerArea and ColorPickerSlider spread internal drag handlers before remaining props. Passing onPointerDown for analytics replaces capture/start/update; passing onPointerUp replaces commit/drag cleanup. Extract and compose pointer callbacks, respecting defaultPrevented, instead of allowing props to overwrite them.

4. EyeDropper can commit through stale editable state — src/components/reui/color-picker.tsx:2286-2295. The asynchronous handler retains context.change and its editable flag from the initiating render. If disabled/readOnly changes or the picker unmounts while sampling, its eventual result can still emit a value and call the old consumer callback. Abort the sampler with AbortController on teardown/state changes and verify current editable state and request generation before applying its result.

5. Mobile Sidebar drops DOM props — src/components/ui/sidebar.tsx:166-185. Props typed for a div are spread onto Sheet (Dialog.Root), which renders no DOM node; id, aria-label, style, DOM handlers and refs do not reach the visible mobile sidebar. className is also discarded in this branch. Forward DOM props and className to SheetContent or a documented content wrapper; keep dialog-root state props separate.

## Low

6. Theme bootstrap fails entirely when storage access throws — src/components/theme-provider.tsx:17-20, 48-65. localStorage.getItem shares a try block with initial DOM theme application. When storage is blocked, the bootstrap exits without applying defaultTheme/system preference; React only repairs this in a post-mount effect, permitting a wrong-theme first paint. Catch the storage read separately and always resolve/apply the fallback theme before hydration.

7. Theme preferences do not synchronize across tabs — src/components/theme-provider.tsx:48-82. Storage is read on mount, but no storage-event listener updates the mounted provider. Changing theme in one tab leaves other open tabs using the previous theme until reload. Add a cleaned-up storage listener filtered to storageKey, validating values and using defaultTheme when the preference is removed.

8. Command input suppresses its only focus indicator — src/components/ui/command.tsx:75-80; src/components/ui/input-group.tsx:17. CommandPrimitive.Input has outline-hidden but uses data-slot=command-input. InputGroup only draws its focus ring for data-slot=input-group-control, so focusing the search field does not trigger the wrapper ring either. Mark the input as an input-group control or extend the selector/add an explicit focus-visible indicator.

## Validation and limits

Existing AccountManager, OneTapPrompt and ThemeProvider suites pass: 20 tests across 3 files. These tests do not cover the races and prop-composition cases above. Review was static plus targeted existing unit tests; no live browser, screen reader, real OAuth or WebAuthn validation. No confirmed unhandled promise rejection in application-owned account mutation paths; their run/update helpers catch rejections. Theme media-query listeners and color-picker Escape/reset listeners have cleanup. AlertDialogAction intentionally renders a plain Button, so it does not auto-close before account mutations finish. AppToaster explicitly overrides the shared Sonner wrapper theme with the app theme.
