import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "https://engihub.xyz").replace(/\/$/, "");
const MODE = __ENV.MODE || "live";
const IS_LIVE_SITE = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE);

const PROFILES = {
  smoke: { stages: [{ duration: "20s", target: 2 }], p95: 3000 },
  live: {
    stages: [
      { duration: "30s", target: 5 },
      { duration: "1m", target: 20 },
      { duration: "30s", target: 20 },
      { duration: "30s", target: 0 },
    ],
    p95: 1500,
  },
  stress: {
    stages: [
      { duration: "1m", target: 50 },
      { duration: "2m", target: 150 },
      { duration: "1m", target: 300 },
      { duration: "30s", target: 0 },
    ],
    p95: 2000,
  },
};

const profile = PROFILES[MODE];
if (!profile) throw new Error(`unknown MODE "${MODE}" (use smoke, live or stress)`);
if (MODE === "stress" && IS_LIVE_SITE) {
  throw new Error("MODE=stress is for a local copy only (set BASE_URL to http://127.0.0.1:...)");
}

export const options = {
  stages: profile.stages,
  setupTimeout: "3m",
  thresholds: {
    "http_req_failed{kind:api}": ["rate<0.01"],
    "http_req_failed{kind:page}": ["rate<0.01"],
    [`http_req_duration{kind:api}`]: [`p(95)<${profile.p95}`],
    [`http_req_duration{kind:page}`]: ["p(95)<1000"],
    checks: ["rate>0.99"],
    rate_limited: ["rate<0.05"],
    "http_req_duration{name:api catalog}": ["p(95)<5000"],
    "http_req_duration{name:api home}": ["p(95)<5000"],
    "http_req_duration{name:api settings}": ["p(95)<5000"],
    "http_req_duration{name:api course}": ["p(95)<5000"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "max"],
};

const rateLimited = new Rate("rate_limited");
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

function get(path, name, kind, params = {}) {
  const res = http.get(`${BASE}${path}`, { ...params, tags: { name, kind } });
  rateLimited.add(res.status === 429);
  return res;
}

export function setup() {
  for (let i = 0; i < 12; i++) {
    const r = http.get(`${BASE}/api/settings`, { timeout: "90s", tags: { name: "warmup", kind: "warmup" } });
    if (r.status === 200) break;
    sleep(5);
  }
  const cat = http.get(`${BASE}/api/catalog`, { timeout: "60s", tags: { name: "warmup", kind: "warmup" } }).json();
  const courses = cat.courses.filter((c) => c.resource_count > 0).sort((a, b) => b.resource_count - a.resource_count);
  if (!courses.length) throw new Error("no courses with resources found");
  return { ids: courses.map((c) => c.id), biggest: courses[0].id };
}

export default function (data) {
  group("home", () => {
    const page = get("/", "home page", "page");
    check(page, { "home page 200": (r) => r.status === 200 });
    const cat = get("/api/catalog", "api catalog", "api");
    check(cat, { "catalog ok": (r) => r.status === 429 || (r.status === 200 && r.json("courses").length > 0) });
    check(get("/api/home", "api home", "api"), { "home stats ok": (r) => r.status === 200 || r.status === 429 });
    check(get("/api/settings", "api settings", "api"), { "settings ok": (r) => r.status === 200 || r.status === 429 });
  });
  sleep(1 + Math.random() * 2);

  group("course", () => {
    const id = Math.random() < 0.33 ? data.biggest : data.ids[Math.floor(Math.random() * data.ids.length)];
    const res = get(`/api/courses/${id}`, "api course", "api");
    check(res, { "course ok": (r) => r.status === 429 || (r.status === 200 && Array.isArray(r.json("resources"))) });

    if (!IS_LIVE_SITE && res.status === 200) {
      const resources = res.json("resources");
      if (resources.length) {
        const rid = resources[Math.floor(Math.random() * resources.length)].id;
        const open = get(`/api/resources/${rid}/open`, "api open resource", "api", { redirects: 0 });
        check(open, { "open redirects": (r) => r.status === 302 || r.status === 200 || r.status === 429 });
      }
    }
  });
  sleep(2 + Math.random() * 3);
}
