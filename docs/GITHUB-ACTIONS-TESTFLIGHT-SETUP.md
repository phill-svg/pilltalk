# Shipping to TestFlight with GitHub Actions (no Mac required)

This is the Mac-free alternative to `docs/TESTFLIGHT-CLOUD-MAC-SETUP.md`.
Instead of renting a cloud Mac every time you want to ship a build, GitHub's
`macos-latest` Actions runners do the archiving, signing, and uploading —
the same runners this repo's tests already build on
(`.github/workflows/swift-tests.yml`). Once the one-time setup below is
done, shipping a new build is: push "Run workflow" in the Actions tab, wait.

Everything in this one-time setup — including generating a code-signing
certificate — is done through Apple's web portals and OpenSSL on Windows.
No Mac, rented or otherwise, is needed at any point.

## What you'll need

- An Apple ID
- Apple Developer Program membership — US$99/yr, enroll at
  [developer.apple.com/programs](https://developer.apple.com/programs/enroll/)
  (activation can take a few hours to a day or two — do this step first)
- Git Bash on Windows (already installed, ships with Git for Windows) for
  the OpenSSL commands below
- About 30-45 minutes of hands-on time for the one-time setup

## Step 1: Register the App ID and App Group

This repo's `Configs/Release.xcconfig` already fixes the bundle identifier
at `chat.pilltalk` and the App Group at `group.chat.pilltalk` — you're
registering those exact values under your own Apple Developer account, not
choosing new ones.

1. Go to [developer.apple.com/account](https://developer.apple.com/account/)
   → **Certificates, Identifiers & Profiles** → **Identifiers** → **+**.
2. Choose **App IDs** → **App** → Continue.
3. Description: anything (e.g. "PillTalk"). Bundle ID: **Explicit**,
   `chat.pilltalk`.
4. Under Capabilities, check **App Groups**. Save.
5. Back on **Identifiers**, switch the type dropdown to **App Groups** → **+**.
   Description: anything. Identifier: `group.chat.pilltalk`. Save.
6. Go back to the `chat.pilltalk` App ID you created in step 3-4, open its
   App Groups capability, and associate it with the `group.chat.pilltalk`
   group you just made.
7. Note your **Team ID**, shown on the account's **Membership** page — you'll
   need it for the `APPLE_TEAM_ID` secret in Step 6.

## Step 2: Generate a distribution certificate (OpenSSL, no Mac)

In Git Bash on Windows:

```bash
mkdir -p ~/pilltalk-signing && cd ~/pilltalk-signing
openssl genrsa -out ios_distribution.key 2048
openssl req -new -key ios_distribution.key -out ios_distribution.csr \
  -subj "/emailAddress=you@example.com/CN=Your Name/C=US"
```

(Replace the email and name — country code `C=US` is fine regardless of
where you live; it's just a certificate-request field, not tied to App
Store availability.)

1. Go to **Certificates, Identifiers & Profiles** → **Certificates** → **+**.
2. Choose **Apple Distribution** (the single cert type covering both App
   Store and Ad Hoc distribution) → Continue.
3. Upload `ios_distribution.csr` from the folder above.
4. Download the resulting certificate as `ios_distribution.cer`, saved
   into the same `~/pilltalk-signing` folder.

Combine the downloaded cert with your private key into a password-protected
`.p12` (pick your own password — you'll store it as the
`IOS_DIST_CERTIFICATE_PASSWORD` secret in Step 6):

```bash
cd ~/pilltalk-signing
openssl x509 -in ios_distribution.cer -inform DER -out ios_distribution.pem -outform PEM
openssl pkcs12 -export \
  -inkey ios_distribution.key \
  -in ios_distribution.pem \
  -out ios_distribution.p12 \
  -password pass:CHOOSE_A_PASSWORD_HERE
```

## Step 3: Create the App Store provisioning profile

1. Still on **Certificates, Identifiers & Profiles** → **Profiles** → **+**.
2. Choose **App Store** (under Distribution) → Continue.
3. Select the `chat.pilltalk` App ID → Continue.
4. Select the distribution certificate from Step 2 → Continue.
5. Name it (e.g. "PillTalk App Store") → Generate → Download.
   Save it into `~/pilltalk-signing` as `pilltalk.mobileprovision`.

## Step 4: Create the App Store Connect app record

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com/) →
   **My Apps** → **+** → **New App**.
2. Platform: iOS. Name: anything (only visible to you/testers unless you
   later publish publicly). Bundle ID: select `chat.pilltalk` from the
   dropdown (it appears here once Step 1 is done). SKU: any unique string,
   e.g. `pilltalk-001`.
3. No pricing, screenshots, or description needed for internal TestFlight
   testing — only a public App Store release requires those.

## Step 5: Create an App Store Connect API key

1. In App Store Connect: **Users and Access** → **Integrations** tab →
   **App Store Connect API** → **Generate API Key** (or the **+** button).
2. Name: anything. Role: **App Manager** (sufficient to upload builds).
3. Download the `.p8` file **immediately** — Apple only lets you download
   it once. Save it into `~/pilltalk-signing` as `AuthKey.p8`.
4. Note the **Key ID** and **Issuer ID** shown on that page next to the key
   — you'll need both in Step 6.

## Step 6: Add the GitHub Actions secrets

Base64-encode the three binary files from Git Bash:

```bash
cd ~/pilltalk-signing
base64 -w0 ios_distribution.p12 > ios_distribution.p12.b64
base64 -w0 pilltalk.mobileprovision > pilltalk.mobileprovision.b64
base64 -w0 AuthKey.p8 > AuthKey.p8.b64
```

In your GitHub repo: **Settings** → **Secrets and variables** → **Actions**
→ **New repository secret**, one at a time:

| Secret name | Value |
|---|---|
| `APPLE_TEAM_ID` | Team ID from Step 1.7 |
| `IOS_DIST_CERTIFICATE_P12` | contents of `ios_distribution.p12.b64` |
| `IOS_DIST_CERTIFICATE_PASSWORD` | the password you chose in Step 2 |
| `CI_KEYCHAIN_PASSWORD` | any random string — e.g. output of `openssl rand -base64 24` |
| `IOS_PROVISIONING_PROFILE` | contents of `pilltalk.mobileprovision.b64` |
| `ASC_API_KEY_P8` | contents of `AuthKey.p8.b64` |
| `ASC_API_KEY_ID` | Key ID from Step 5.4 |
| `ASC_API_ISSUER_ID` | Issuer ID from Step 5.4 |

Once done, delete the `~/pilltalk-signing` folder — the secrets are safely
stored in GitHub, you don't need the local copies (the private key inside
`ios_distribution.key`/`.p12` is sensitive; don't commit any of these files).

## Step 7: Run it

1. In GitHub, go to the **Actions** tab → **Release iOS to TestFlight**
   (from `.github/workflows/testflight-release.yml`) → **Run workflow**.
2. Watch the run log. It archives, signs, and uploads in one job — no
   manual steps once it's running.
3. In App Store Connect → your app → **TestFlight** tab, the build appears
   once Apple finishes processing it (a few minutes up to ~30 minutes,
   unrelated to how the build was produced).
4. Add yourself as an **internal tester** (App Store Connect Users → your
   own Apple ID) and install via the TestFlight app on your iPhone — same
   as Step 6 in `docs/TESTFLIGHT-CLOUD-MAC-SETUP.md`.

From here on, shipping an update is just Step 7.1-7.2 — everything else on
this page is one-time.

## Troubleshooting

- **"Provisioning profile doesn't match the entitlements file" / a specific
  capability named in the archive error**: the App ID needs that capability
  enabled on the developer portal (Step 1.4) to match what the Xcode
  project's entitlements request. App Groups is the only one this project
  currently needs; if Xcode's error names a different one, enable it there
  and regenerate the provisioning profile (Step 3).
- **Upload rejected as a duplicate build number**: shouldn't happen —
  `CURRENT_PROJECT_VERSION` is set to the GitHub Actions run number, which
  only increases. If you ever also upload manually (e.g. via the cloud-Mac
  path), make sure that path's build number doesn't collide with a run
  number already used here.
- **API key upload fails with an authentication error**: double check the
  `ASC_API_KEY_ID` secret matches the filename suffix Apple shows for the
  key, and that the `.p8` file wasn't corrupted by base64 line-wrapping —
  `base64 -w0` (no wrapping) is required, not the default wrapped output.
