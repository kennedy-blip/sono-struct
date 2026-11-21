# APK release artifacts

`sonostruct-release.apk` and its `sonostruct-release.json` manifest are produced
by `.github/workflows/build-and-bundle-apk.yml`:

```
npm run build            # web bundle
npx cap sync android     # copy into the Capacitor shell
./gradlew assembleRelease  # signed with android/keystore/sonostruct-release.p12
node scripts/postbuild-apk.mjs <apk>   # verify + hash + publish here
```

The workflow then commits both files back to `main`, so the Vercel deployment
serves a real APK from the app's one-tap download button.

The app reads `sonostruct-release.json` for the true size, SHA-256 and build
date. If the manifest is absent the APK Center says so explicitly instead of
handing out a fake file.
