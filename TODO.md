# Google Drive integration

Google Cloud configuration is saved in project `concept-maddock-world`: Drive
API enabled, `.concept` associated with `application/vnd.concept+json`, and
`drive.file`, `drive.install`, `openid`, `userinfo.email`, and `userinfo.profile`
declared on the OAuth consent screen. Production and staging OAuth origins and
callbacks were verified on October 23, 2026.

## App launch support

- [x] Request `https://www.googleapis.com/auth/drive.install` when connecting the
      Drive UI integration. Declaring it in Google Cloud does not request it for users;
      existing connections can use Connect to authorize both required scopes.
- [ ] Implement `/open` for Drive's **Open with Concept** action. Parse and validate
      the JSON `state` query parameter, including `action`, file IDs, Google user ID,
      and resource keys. Authorize the matching account and open the existing Drive
      file without making a copy.
- [ ] Handle Drive's `create` action on `/new`. Parse the launch `state`, authorize
      the matching Google account, and create a Drive-backed document in the requested
      folder, including its resource key when present. Keep ordinary `/new` visits
      accountless and local by default.
- [ ] Preserve launch details through sign-in and Drive authorization, and handle
      account mismatches, denied access, invalid launch parameters, and read-only
      files without losing the requested action.
- [ ] Test the complete flow with the configured test account: connect Concept,
      open a `.concept` file from Drive, create one from Drive's **New** menu, edit it,
      and verify that changes update the same Drive file.

## Deployment and public availability

- [ ] Resolve the Cloudflare Access login requirement for testing the production
      launch URLs. Decide on public access before a public release; changing the
      access policy is a separate action.
- [ ] Publish public privacy-policy and terms-of-service pages, then add their
      URLs to Google Auth Platform branding. Deferred for now because these pages do
      not exist.
- [ ] Complete the remaining branding requirements and move OAuth out of
      **Testing** when ready. At the last check, publishing was disabled and only
      `notmaddock@gmail.com` was registered as a test user.
- [ ] Review Google Workspace Marketplace configuration and complete listing and
      verification requirements if public Marketplace installation is desired. The
      SDK is enabled, but listing readiness was not verified.

## References

- [Configure a Drive UI integration](https://developers.google.com/workspace/drive/api/guides/enable-sdk)
- [Handle Open with](https://developers.google.com/workspace/drive/api/guides/integrate-open)
- [Handle New](https://developers.google.com/workspace/drive/api/guides/integrate-create)
