# GitHub Actions TestFlight Release Pipeline — Design Spec

Date: 2026-07-27
Status: Approved by user, pending implementation plan

## 1. Purpose

`docs/TESTFLIGHT-CLOUD-MAC-SETUP.md` documents renting a cloud Mac to archive,
sign, and upload PillTalk to TestFlight, because the maintainer doesn't own a
Mac and Xcode only runs on macOS. That doc's own closing note flags a cheaper
follow-up: this repo's CI already runs on GitHub's `macos-latest` runners
(`.github/workflows/swift-tests.yml`), so the archive/sign/upload steps can
run there instead of on a rented Mac. This spec defines that pipeline.

The result: shipping a new TestFlight build never touches a Mac, cloud or
otherwise — GitHub's macOS runner *is* "the Mac side of things." The one-time
signing setup (certificate, provisioning profile, API key) is also done
Mac-free, via Apple's web portals plus OpenSSL on Windows.

## 2. Goals / Non-Goals

**Goals**
- A GitHub Actions workflow that archives, signs, and uploads the
  `pilltalk (iOS)` scheme to TestFlight on demand.
- Every upload gets a unique build number automatically, with no manual
  version bumping.
- A complete one-time setup walkthrough covering Apple Developer Program
  enrollment through to adding GitHub secrets, assuming the reader has never
  done any of it and has no Mac.

**Non-Goals (this pass)**
- macOS app distribution (App Store or notarized DMG) — out of scope per the
  scope decision; iOS/TestFlight only.
- Automatic triggers (tag push, merge to main) — manual `workflow_dispatch`
  only, by choice.
- Fastlane or any signing-management tool (match, gym, pilot) — raw
  `xcodebuild`, consistent with this repo's existing CI style, which uses
  plain `xcodebuild` invocations with no such dependency.
- Changes to app code, entitlements, or `Configs/*.xcconfig` — the existing
  `PRODUCT_BUNDLE_IDENTIFIER = chat.pilltalk` / `APP_GROUP_ID =
  group.chat.pilltalk` in `Configs/Release.xcconfig` are used as-is; this is
  the project owner's own repo, not a fork needing a distinct bundle ID (that
  parametrization only applies to `Local.xcconfig`, which Release builds
  never include).

## 3. Architecture

```
Manual trigger (Actions tab → "Run workflow")
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ macos-latest runner                                        │
│                                                              │
│  1. Checkout                                                │
│  2. Import distribution cert (.p12 secret) → temp keychain  │
│  3. Install provisioning profile (.mobileprovision secret)  │
│     → extract UUID for signing                              │
│  4. xcodebuild archive                                       │
│       scheme "pilltalk (iOS)", Release, manual signing       │
│       CURRENT_PROJECT_VERSION = $GITHUB_RUN_NUMBER           │
│  5. Write App Store Connect API key (.p8 secret)             │
│  6. xcodebuild -exportArchive, destination=upload             │
│       → uploads straight to App Store Connect/TestFlight,     │
│         no altool/notarytool/fastlane needed                  │
│  7. always(): delete temp keychain + API key file              │
└───────────────────────────────────────────────────────────┘
```

No separate "export IPA then upload" step: Xcode 13+'s
`-exportArchive` supports `destination: upload` in the export-options plist,
performing the App Store Connect upload as part of the export when given API
key credentials. This avoids `altool` (deprecated) entirely.

## 4. Workflow file

New file: `.github/workflows/testflight-release.yml`

- Trigger: `workflow_dispatch` only, no inputs needed.
- Single job, `runs-on: macos-latest`, generous timeout (archiving +
  upload + Apple processing queue time; the job itself just needs to survive
  submission, not wait for Apple's processing).
- Steps as diagrammed above. Keychain and API key cleanup run in a step
  guarded by `if: always()` so a failed upload never leaves secrets sitting
  in the runner's filesystem (moot for ephemeral runners, but cheap and
  correct).
- Certificate import follows the standard GitHub Actions pattern: create a
  throwaway keychain scoped to the job, unlock it, import the `.p12`, set
  `security set-key-partition-list` so `codesign` can use the key
  non-interactively, and add it to the keychain search list.
- Provisioning profile UUID is extracted at install time
  (`security cms -D` + `plutil`) and exported via `$GITHUB_ENV`, so the
  archive step can reference it as `PROVISIONING_PROFILE_SPECIFIER` — this
  avoids needing a separate "profile name" secret.

## 5. Secrets (GitHub repo → Settings → Secrets and variables → Actions)

| Secret | Contents |
|---|---|
| `APPLE_TEAM_ID` | Apple Developer Team ID (developer.apple.com/account → Membership) |
| `IOS_DIST_CERTIFICATE_P12` | base64 of the distribution cert's `.p12` |
| `IOS_DIST_CERTIFICATE_PASSWORD` | password the `.p12` was exported/created with |
| `CI_KEYCHAIN_PASSWORD` | arbitrary random password for the job's throwaway keychain |
| `IOS_PROVISIONING_PROFILE` | base64 of the App Store `.mobileprovision` |
| `ASC_API_KEY_P8` | base64 of the App Store Connect API `.p8` key |
| `ASC_API_KEY_ID` | that API key's Key ID |
| `ASC_API_ISSUER_ID` | App Store Connect Issuer ID (same for all keys on the account) |

## 6. One-time Apple-side setup doc

New file: `docs/GITHUB-ACTIONS-TESTFLIGHT-SETUP.md`, a from-scratch
walkthrough (reader has no Mac and hasn't done any Apple Developer setup
yet):

1. Enroll in the Apple Developer Program (developer.apple.com/programs,
   US$99/yr) — same step as the existing cloud-Mac doc, do this first since
   activation can take up to a day or two.
2. Register the `chat.pilltalk` App ID on the web portal (Certificates,
   Identifiers & Profiles → Identifiers → +), enabling the App Groups
   capability, and register the `group.chat.pilltalk` App Group, associating
   it with the App ID — matching what's already committed in the
   entitlements files, no code changes needed.
3. Generate a CSR and private key with OpenSSL on Windows (Git Bash):
   `openssl genrsa` + `openssl req -new`. Upload the `.csr` to the portal
   (Certificates → + → Apple Distribution) to get a `.cer`, then combine
   private key + `.cer` into a password-protected `.p12` with
   `openssl pkcs12 -export`. All command-line, no Mac.
4. Create an App Store distribution provisioning profile on the portal
   (Profiles → + → App Store), selecting the App ID and the certificate from
   step 3; download the `.mobileprovision`.
5. Create the App Store Connect app record (appstoreconnect.apple.com → My
   Apps → +), bundle ID `chat.pilltalk`.
6. Create an App Store Connect API key (Users and Access → Integrations →
   App Store Connect API → Generate), role "App Manager"; download the
   `.p8` (only downloadable once), note the Key ID and Issuer ID shown next
   to it.
7. Base64-encode the `.p12`, `.mobileprovision`, and `.p8` files and paste
   into the GitHub secrets from section 5.
8. Run the workflow from the Actions tab; watch it in the Actions log; once
   it succeeds, the build shows up in App Store Connect → TestFlight within
   a few minutes to ~30 minutes (Apple's processing time, unchanged from the
   cloud-Mac path) — add yourself as an internal tester and install via the
   TestFlight app exactly as in the existing doc's Step 6.

Includes a short troubleshooting note: if archiving fails on an entitlements/
capability mismatch, the error names which capability needs enabling on the
App ID in the portal — this can happen for capabilities beyond App Groups
that Xcode expects that aren't relevant on this project.

## 7. Change to the existing doc

Add a short note near the top of `docs/TESTFLIGHT-CLOUD-MAC-SETUP.md`
pointing at the new doc as the preferred path (no Mac rental at all), keeping
the cloud-Mac walkthrough as a documented fallback (e.g. if Apple ever
requires interactive account verification that an API key can't satisfy).

## 8. Testing / Verification

This is CI/infra, not app code — "testing" means a successful end-to-end
dry run:
- `xcodebuild archive` and `-exportArchive` steps must be validated by
  actually running the workflow once the user has completed the one-time
  Apple setup and added all 8 secrets. This can't be verified without those
  real Apple credentials, so it isn't part of automated CI — the existing
  `swift-tests.yml` unsigned build jobs remain the automated safety net that
  every push still gets. The new workflow's own first real run *is* its
  test.
- No existing workflow, app code, or config file changes — nothing to
  regression-test beyond the new workflow itself.
