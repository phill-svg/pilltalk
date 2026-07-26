# Building PillTalk for iOS without owning a Mac

You don't have a Mac. Xcode only runs on macOS. This guide gets PillTalk onto
your iPhone anyway, using a rented cloud Mac plus TestFlight — no physical
Mac, no USB cable, ever.

## Why this specific path

The *free* way to run your own app on your own iPhone (Xcode's "sideload to
a device it's plugged into") requires an actual USB (or same-Wi-Fi) cable
between your iPhone and the Mac running Xcode. A cloud Mac can't physically
touch your phone, so that route is closed regardless of provider.

TestFlight sidesteps this entirely: the cloud Mac builds the app and
uploads it to Apple's servers; your iPhone downloads it from Apple via the
TestFlight app, over the internet, no cable involved. The cost is the
Apple Developer Program membership (US$99/yr, ≈AU$149/yr) that TestFlight
requires — see the earlier discussion in this project's history for why the
free tier can't do this.

## What you'll need

- An Apple ID (can be your existing one)
- Apple Developer Program membership — US$99/yr, enroll at
  [developer.apple.com/programs](https://developer.apple.com/programs/enroll/)
  (takes a few hours to a day or two to activate — do this first, before
  renting the cloud Mac, so you're not paying for idle Mac time while
  waiting)
- A credit card for the cloud Mac rental
- About 1–2 hours of hands-on time for the first setup (mostly Xcode/build
  wait time, not active work)

## Step 1: Rent a cloud Mac

**[MacinCloud](https://www.macincloud.com/) Pay-As-You-Go is the cheapest
practical option for a one-off session like this**: roughly US$1/hour (or a
~$4/day bundle) with no minimum commitment, and Xcode comes preinstalled —
see [macincloud.com/pages/payg.html](https://www.macincloud.com/pages/payg.html)
for current rates before buying, pricing pages change. Budget 2-4 hours of
actual use (~$2-4 total).

[Scaleway's Apple Silicon instances](https://www.scaleway.com/en/pricing/apple-silicon/)
advertise a cheaper headline rate (€0.11-0.24/hour) but Apple's licensing
terms force a **24-hour minimum lease** regardless of how long you actually
use it, and the Mac ships bare (no Xcode preinstalled) — so your real
minimum cost is ~€2.64-5.76 and part of that rented day goes to downloading
Xcode yourself. Only worth it if you expect to need many hours of Mac time
within that 24-hour window. Skip MacStadium (monthly dedicated rental,
priced for teams) and AWS EC2 Mac instances (also a 24-hour minimum, more
CI, not a single hobby build.

After signing up, MacinCloud emails you connection details — typically a
Microsoft Remote Desktop (RDP) profile. Install the **Microsoft Remote
Desktop** app on your Windows machine (it's on the Microsoft Store) and use
the provided credentials to connect. You'll be looking at a real macOS
desktop inside a window.

## Step 2: Set up the cloud Mac

Once connected:

1. Confirm Xcode is already installed (Managed plans ship with it — check
   Applications). If it's an older version, update it via the App Store
   app first; this can take a while, so kick it off and do other things
   while it downloads.
2. Open **Terminal** and confirm git is available: `git --version`
   (Xcode's command-line tools include it; if missing, `xcode-select --install`).
3. Sign your Apple ID into Xcode itself: **Xcode → Settings → Accounts →
   +** → add your Apple ID (the one enrolled in the Developer Program).

## Step 3: Get the code and configure signing

```bash
git clone https://github.com/phill-svg/pilltalk.git
cd pilltalk
open pilltalk.xcodeproj
```

In Xcode:

1. Follow the project's own setup note in `README.md` under **Setup →
   Option 1**:
   ```bash
   cp Configs/Local.xcconfig.example Configs/Local.xcconfig
   ```
   Open `Configs/Local.xcconfig` and add your Apple Developer **Team ID**
   (find it at [developer.apple.com/account](https://developer.apple.com/account/) →
   Membership details). This file is gitignored on purpose — it's meant to
   stay local to whichever machine builds the app, never committed.
2. Your bundle ID becomes `chat.pilltalk.<your_team_id>` automatically once
   the Team ID is set (unless you override it). Note that value — you'll
   need it in Step 4.
3. The README flags one manual step that isn't automated yet: search the
   project for `group.chat.pilltalk` (the App Group identifier, used for
   sharing data between the main app and its Share Extension) and replace
   it with `group.<your_bundle_id>` (e.g. `group.chat.pilltalk.ABC123`),
   in both targets' entitlements files.
4. Select the **pilltalk** target → **Signing & Capabilities** → check
   **Automatically manage signing** → pick your Team from the dropdown.
   Do the same for the **pilltalkShareExtension** target.
5. At the top of Xcode's toolbar, next to the scheme selector, choose
   **Any iOS Device (arm64)** as the build destination (not a simulator —
   simulator builds can't be archived for distribution).

## Step 4: Create the App Store Connect record

Before you can upload a build, Apple needs somewhere for it to land:

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com/) →
   **My Apps** → **+** → **New App**.
2. Platform: iOS. Name: anything you like (this is only visible to you and
   your testers unless you later publish publicly). Bundle ID: select the
   `chat.pilltalk.<your_team_id>` one from the dropdown (it appears here
   once Xcode has registered it via automatic signing in Step 3 — if it's
   missing, go back to Xcode and let it finish provisioning, or register it
   manually under **Certificates, Identifiers & Profiles** on the developer
   portal first).
3. SKU: any unique string (e.g. `pilltalk-001`). You do not need to fill in
   pricing, screenshots, or a description for internal TestFlight testing —
   only public App Store release requires that.

## Step 5: Archive and upload

Back in Xcode, on the cloud Mac:

1. **Product → Archive** (top menu bar). This builds a release binary —
   takes a few minutes.
2. When it finishes, the **Organizer** window opens automatically showing
   your archive. Click **Distribute App**.
3. Choose **App Store Connect** → **Upload** → follow the prompts (defaults
   are fine — automatic signing, no re-signing needed since you already
   configured it).
4. Wait for the upload to finish, then wait again — Apple takes anywhere
   from a few minutes to ~30 minutes to "process" an uploaded build before
   it's usable.

## Step 6: Install it on your phone via TestFlight

1. On your iPhone, install the **TestFlight** app from the App Store (this
   one's free, no developer account needed on the phone side).
2. Back in App Store Connect → your app → **TestFlight** tab → once your
   build shows as processed, add yourself as an **internal tester** (your
   own Apple ID email, under **App Store Connect Users** → internal
   testing group). Internal testing doesn't require Apple review — it's
   available within minutes of the build finishing processing.
3. You'll get an email/notification inviting you to test. Open it on your
   iPhone, tap through to TestFlight, and install PillTalk.

From here on, whenever you want to push an updated build: repeat Steps 5–6
only (archive → upload → wait → TestFlight auto-notifies you of the new
build) — Steps 1–4 are one-time setup. If you keep iterating regularly,
it's worth looking at wiring GitHub Actions (already building the macOS
scheme for this repo's CI) to also build and upload the iOS scheme
automatically via `xcodebuild` + Apple's `altool`/App Store Connect API,
removing the cloud-Mac rental from the loop entirely except for the very
first signing setup — ask if you want that scoped out as a follow-up.

## Rough cost/time budget

- Apple Developer Program: US$99/yr / AU$149/yr (recurring, required
  regardless of build method)
- Cloud Mac (MacinCloud PAYG): ~US$2–4 for the first session at ~US$1/hour,
  2-4 hours of actual use — Xcode's already installed, so nearly all your
  paid time goes to the actual archive/upload, not environment setup.
  Check current pricing before buying, quoted numbers go stale.
- Time: budget 1–2 hours end-to-end the first time (mostly waiting on
  archive/upload/Apple processing, not active clicking); subsequent
  updates are much faster since signing is already configured

Sources checked while writing this: [MacinCloud Pay-As-You-Go](https://www.macincloud.com/pages/payg.html), [MacinCloud PAYG support docs](https://support.macincloud.com/support/solutions/articles/8000044698-what-is-macincloud-s-pay-as-you-go-server-plan-), [Scaleway Apple Silicon pricing](https://www.scaleway.com/en/pricing/apple-silicon/).
