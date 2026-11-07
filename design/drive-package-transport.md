# Drive package transport

Status: implemented in `src/lib/documents/drive/api.ts`.

Version 2 packages use `application/vnd.concept+zip`. Legacy
`application/vnd.concept+json` files remain discoverable, including files whose
Drive names no longer have a `.concept` extension. The picker also accepts generic
binary and ZIP uploads when their names have the `.concept` extension.

The binary adapter keeps the existing Drive v2 conditional multipart write. It
sends the new MIME type and complete ZIP media in the same `If-Match` request;
the media part has no text charset. Drive v2 documents that `mimeType` can change
on an update that uploads new content. Reads retain metadata checks before and
after media download so bytes are acknowledged against a stable validator.
Media is streamed into a bounded buffer; both declared and observed lengths are
checked against the customizable package limit.

## Resumable upload evaluation

Drive recommends resumable uploads for files over 5 MB or unreliable networks.
Its v2 update method supports resumable uploads, but the current reference does
not specify when an `If-Match` precondition is applied relative to session
creation and final publication. Switching to a multi-request session without
verifying that contract could overwrite a concurrent edit between initiation and
commit. This implementation therefore retains the existing single-request
conditional publication, including for larger packages. Interrupted uploads are
reconciled through the save queue before retrying; they do not imply a failed
remote commit. A future resumable adapter must test conflicts during an active
session and lost final responses against Drive before replacing this path.

This choice means a failed upload can require retransmitting the complete
package. The configurable package limit bounds memory and request size; it is
not a promise of resumable transfer. Automated adapter tests verify binary
preservation, MIME migration requests, shared-drive parameters, stable-validator
reads, authentication replay, conflicts, and size bounds. Live account tests
remain necessary to verify provider behavior and sharing permissions in rollout.

Sources checked during implementation:

- [Drive v2 files resource](https://developers.google.com/workspace/drive/api/reference/rest/v2/files)
- [Drive v2 files.update](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update)
- [Drive upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
