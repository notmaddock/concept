# Account and shared UI review

Scope: all non-generated implementation files in src/components/account/, src/components/ui/, src/components/reui/, theme-provider.tsx and app-toaster.tsx. Read installed Base UI and Better Auth implementations to check primitive behavior. No production files changed.

## Critical

None identified.

## High

None identified.

## Medium

1. Account state survives session loss or user changes — src/components/account/use-account-settings.ts:52-81; src/components/account/AccountManager.tsx:28. Status: FIXED. Triage confirmed: session loss left open=true and retained prior accounts/errors; switching users left previous accounts actionable if the new load failed; and in-flight actions completed across session changes. Fixed by resetting open, accounts, loading, error, and accountsError on session loss; clearing user-scoped state whenever session.user.id changes; keying load effects by userId; and ignoring stale action completions if the active userId or action generation changed. Validated with unit tests in AccountManager.test.tsx covering session loss dialog reset, user-switching state clearance, and stale action error suppression.

2. One Tap is not cancelled when its owner becomes inactive — src/components/account/OneTapPrompt.tsx:10-34. Status: FIXED. Triage confirmed: OneTapPrompt had no teardown/session-acquisition cleanup, allowing prompts or in-flight script initialization to show prompts after unmount or after login. Fixed by cancelling One Tap on teardown and upon session acquisition, and guarding asynchronous settlement with an active cancellation flag that cancels Google Identity if script loading or prompt setup settles after teardown. Validated with unit tests in OneTapPrompt.test.tsx covering teardown cancellation, session acquisition cancellation, and late async settlement cancellation.

3. Consumer pointer callbacks replace color-picker behavior — src/components/reui/color-picker.tsx:1993-1994, 2101-2102. Status: FIXED. Triage confirmed: ColorPickerArea and ColorPickerSlider spread internal drag handlers before props, causing consumer onPointerDown/onPointerUp/etc. to replace drag tracking and cleanup. Fixed by extracting consumer pointer callbacks (onPointerDown, onPointerMove, onPointerUp, onPointerCancel) and composing them with internal drag handlers, respecting defaultPrevented so consumers can optionally intercept or monitor pointer events without clobbering color picker interactions. Validated with unit tests in color-picker.test.tsx covering callback composition and defaultPrevented handling for both area and slider.

4. EyeDropper can commit through stale editable state — src/components/reui/color-picker.tsx:2286-2295. Status: FIXED. Triage confirmed: ColorPickerEyeDropper invoked EyeDropper.open() with no AbortSignal and retained a stale context reference across asynchronous sampling, allowing changes to commit after unmount or after the picker transitioned to disabled/readOnly. Fixed by managing an AbortController aborted on unmount and whenever editable becomes false, passing its signal to EyeDropper.open({ signal }), and guarding completion with request generation and live editable checks via context ref. Validated with unit tests in color-picker.test.tsx covering signal passing, teardown abort, editable-change abort, and suppression of late results.

5. Mobile Sidebar drops DOM props — src/components/ui/sidebar.tsx:166-185. Status: FIXED. Triage confirmed: Sidebar spread HTML div props onto Sheet (Dialog.Root, which renders no DOM element), causing className, id, aria-label, custom style properties, and DOM handlers to be completely discarded on mobile. Fixed by separating dialog-root props (open, onOpenChange) from DOM element props and forwarding className, style (merging with mobile width), and remaining HTML props directly to SheetContent. Validated with unit tests in sidebar.test.tsx asserting proper propagation of id, aria-label, custom className, style, and event listeners in both mobile and desktop modes.

## Low

6. Theme bootstrap fails entirely when storage access throws — src/components/theme-provider.tsx:17-20, 48-65. Status: FIXED. Triage confirmed: localStorage.getItem and DOM theme class/style application shared a single try block in getThemeScript. When storage access was blocked, an exception aborted script execution before documentElement received any theme class, resulting in unstyled/wrong-theme flash before React hydration. Fixed by isolating localStorage.getItem in its own try/catch block and always resolving and applying the fallback or system theme to documentElement in a dedicated try block. Validated with unit test in theme-provider.test.tsx ensuring bootstrap script applies dark/light theme to documentElement when localStorage.getItem throws SecurityError.

7. Theme preferences do not synchronize across tabs — src/components/theme-provider.tsx:48-82. Status: FIXED. Triage confirmed: ThemeProvider only read localStorage once on mount, omitting any window storage event listener. Changing theme or clearing preferences in one tab left all other concurrent tabs out of sync until a manual page refresh. Fixed by attaching a cleaned-up window storage event listener filtered to storageKey, validating values ('light', 'dark', 'system'), ignoring invalid values, and falling back to defaultTheme when the stored preference is deleted (newValue === null). Validated with unit test in theme-provider.test.tsx testing cross-tab storage events for value updates, preference removal, key filtering, and invalid value rejection.

8. Command input suppresses its only focus indicator — src/components/ui/command.tsx:75-80; src/components/ui/input-group.tsx:17. CommandPrimitive.Input has outline-hidden but uses data-slot=command-input. InputGroup only draws its focus ring for data-slot=input-group-control, so focusing the search field does not trigger the wrapper ring either. Mark the input as an input-group control or extend the selector/add an explicit focus-visible indicator.

## Validation and limits

Existing AccountManager, OneTapPrompt and ThemeProvider suites pass: 20 tests across 3 files. These tests do not cover the races and prop-composition cases above. Review was static plus targeted existing unit tests; no live browser, screen reader, real OAuth or WebAuthn validation. No confirmed unhandled promise rejection in application-owned account mutation paths; their run/update helpers catch rejections. Theme media-query listeners and color-picker Escape/reset listeners have cleanup. AlertDialogAction intentionally renders a plain Button, so it does not auto-close before account mutations finish. AppToaster explicitly overrides the shared Sonner wrapper theme with the app theme.
