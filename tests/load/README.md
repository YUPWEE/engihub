# Load tests (k6)

`site.js` simulates students browsing: home page, catalog, home stats, then course pages (a third of the time the
biggest course). Install k6 (`winget install GrafanaLabs.k6`, or the portable zip from
https://github.com/grafana/k6/releases), then from the repo root:

```bash
k6 run -e MODE=smoke tests/load/site.js        # 2 users, 20 s: checks the script
k6 run tests/load/site.js                      # live (default): up to 20 users for ~2.5 min, read-only
k6 run -e MODE=stress -e BASE_URL=http://127.0.0.1:5173 tests/load/site.js   # up to 300 users, LOCAL copy only
```

- Live mode never writes, never records opens/downloads, and never calls `/api/search` (it would spend the free
  Gemini quota). Stress mode refuses to run against a non-local URL.
- All traffic comes from your one IP, so the API's per-visitor rate limits may answer 429; those are reported as
  `rate_limited`, not as errors.
- The free Render instance sleeps; `setup()` wakes it first so the cold start isn't measured.
- Add `--summary-export tests/load/results/summary.json` to keep the numbers (`results/` is git-ignored).

## Baseline (2026-11-14, live, 20 users)

822 requests, 0 errors, no rate limiting. Static page p95 71 ms. API p95 2.39 s (target 1.5 s): settings 0.47 s,
catalog 0.95 s, course 1.6 s, home stats 2.35 s on average, the same at 1 user as at 20, so the time is a fixed
per-request cost (sequential database round trips between Render and Atlas), not load.
