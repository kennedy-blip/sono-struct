# APK release artifacts

`sonostruct-release.apk` is produced by `.github/workflows/build-and-bundle-apk.yml`
(Gradle `assembleRelease` after `npx cap sync android`) and committed / uploaded here.

The in-app APK Download Center probes this file with a `HEAD` request; when it is
missing or too small it falls back to streaming a signed installer manifest so the
one-tap download never 404s.
