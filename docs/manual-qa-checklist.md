# Manual QA Checklist

- Log in to `knight-devs-platform` in the same Chrome profile.
- Load unpacked extension from `knight-devs-autofill-extension`.
- Open extension popup and verify expert profiles are listed.
- Select active profile and confirm selection persists after popup reopen.
- On Greenhouse page:
  - Click in-page `Autofill with Knight Devs` button.
  - Verify name/email/phone/location fields are populated.
- On Lever page:
  - Click popup `Fill now` action.
  - Verify common fields are populated.
- Set trigger mode to `auto_on_load` and refresh page:
  - Confirm form fills automatically.
- Set submit mode to `fill_and_submit`:
  - In manual trigger mode, ensure submit confirmation appears.
  - In auto mode, ensure submission only occurs when required mapped fields are present.
- Validate telemetry endpoint receives events without blocking autofill.
