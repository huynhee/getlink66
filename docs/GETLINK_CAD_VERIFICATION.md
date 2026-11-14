# CAD Without A Source URL Signature

This exception is limited to HTTPS `cad.3d66.com/reshtmla/cad/items/.../...html`.
3D, SketchUp and other resources retain their source `sign` requirement. Empty or
duplicate signatures cannot enter the unsigned CAD exception.

## Evidence

CAD follows source-first history in `footprint`, `rewritten_footprint` and
`hybrid`. It opens only the exact history entry for the configured account and
complete asset identity. An unsigned history link is provisional, never proof.

After the model loads, the backend checks all of:

- `#detail_data` is a successful CAD response, `res_type=8`, not deleted.
- Page SOF, `res.ll_id`, source `origin_ll_url`, account marker and complete
  SOF asset suffix agree. CAD's numeric `res.ll_id_out` is a separate public ID,
  not the SOF suffix; it must be present and remain unchanged during verification.
  The canonical resource cannot cross hosts or models.
- The fixed, no-redirect account API authenticates the exact effective cookie;
  its user ID matches `sof_user_id` and the configured account marker.
- The fixed, read-only download-pop API returns the same full SOF, CAD type,
  deletion status and base price.
- The document, credential and configuration do not change during the check.

CAPTCHA remains a manual handoff of the same context. Verification does not buy
or download a file and never synthesizes an upstream `sign`.

## Backend Receipt

The verified source URL carries an opaque `cad_verified` fragment. This is an
AES-256-GCM backend receipt, with a domain-separated key derived from the existing
cookie-encryption secret, not a 3D66 signature. It binds the canonical URL, full
SOF, public asset ID, source account, credential fingerprint, configuration and
verification time. Do not log or publish receipt contents.

The fragment survives existing cache/history records without a migration. It is
always stripped from source navigation, API bodies, referrers and file requests.
Copying it onto another URL or changing its claims cannot authorize that URL.

New purchases re-verify the source page and require a fresh receipt (two-minute
maximum), matching credential/configuration, a current metadata response and the
confirmed price/format. Purchases use the API only; an error never retries via a
browser purchase click or another format. Existing app ownership, credit
transactions and idempotency checks are unchanged.

Historical receipt validation establishes provenance for already purchased
files; it does not itself grant ownership or permit a new purchase. Rotating the
encryption key invalidates old receipts, so plan source re-verification before
rotation. Do not roll back to a backend that cannot validate stored CAD receipts
after customers have purchased unsigned CAD resources.

## Verification

`3d66-cad-verification.test.js` covers forgery, identity mismatch, expiry, account
checks and source races. The rewritten-footprint integration suite covers all
three modes, mock purchases, selected formats, price changes and proof-free
upstream requests. `qa-3d66-cad.js` exercises real Chromium with fully mocked
source/API responses and a closed loopback proxy, including desktop/mobile and
wrong-account/asset rejection. Live acceptance is preview-only unless a real
purchase is separately authorized.
