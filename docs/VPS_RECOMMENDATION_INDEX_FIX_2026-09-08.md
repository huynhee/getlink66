# Recommendation index intervention

Two additive indexes were built online on the production marketplace database:
`recommendation_categorySourceId_rank` and
`recommendation_parentCategorySourceId_rank`.
Their definitions are retained in `backend/src/models/MarketplaceModel.js`.
No existing indexes or records were deleted; no services were restarted.

Before the build, verified backup timestamps were 2026-09-07T18:00:39Z
(core) and 2026-09-07T18:35:01Z (marketplace).

## Verification

The same public, ready, complete Pro recommendation query, filtering category
or parent category and sorting by downloads, source ID and creation date,
returned 240 records in both explains:

| Metric | Before | After |
| --- | ---: | ---: |
| Documents examined | 65,189 | 240 |
| Index keys examined | 75,830 | 278 |
| Execution time, ms | 16,991 | 103 |

These are individual executionStats samples under changing production load,
not an API latency percentile or a controlled benchmark. Earlier slow logs
also showed this query scanning 65,189 documents in approximately 550 ms.
The post-build plan uses the new sorted indexes and an early limit.

Direct backend search for `archedoor` returned HTTP 200 in 107 ms after the
build. Backend, frontend and Mongo containers remained healthy.

## Remaining issues

- `cabildo 2`: cover and all three preview sources failed Sharp decoding;
  their first 20 bytes were zero. The complete files were not proven all-zero.
  Supply valid original images before retrying cover generation. No Drive
  files were changed during diagnosis.
- Drive Changes had approximately 6,500 pending jobs at the last inspection;
  throughput needs a separate investigation. Do not reset its checkpoint.
- Production already has these indexes. No deployment is required to activate
  this intervention; retain the schema changes in the next code release.
