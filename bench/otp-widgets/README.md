# OTP widget bench

Renders real OTP widgets in headless Chromium and runs the extension's own `detectTargets` + `fillTarget` against each one. A widget passes when its own change handler receives the code. Negative cases pass when nothing is detected.

```sh
cd bench/otp-widgets
npm install
npx playwright install chromium
npm run bench            # all widgets
npm run bench -- mantine # one widget
```

## Adding a site that fails

1. On the site's code page, find the widget in DevTools (search the JS for `one-time-code` or `otp`).
2. Copy its markup and handlers into `widgets.tsx` as a `hand-rolled:` entry. Report the value the site would submit with `report(value)`.
3. Run `npm run bench -- <name>` and fix `src/otp/` until it passes.
