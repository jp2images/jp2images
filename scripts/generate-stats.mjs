#!/usr/bin/env node
// Generates a static GitHub stats SVG card.
// Zero dependencies: uses Node's built-in fetch. Run by .github/workflows/stats.yml.
//
//   GITHUB_TOKEN=<token> node scripts/generate-stats.mjs
//
// Env:
//   GITHUB_TOKEN  required, used to query the GitHub GraphQL/REST API
//   GH_USER       username to report on (default: jp2images)

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const USER = process.env.GH_USER || "jp2images";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = "assets/github-stats.svg";

if (!TOKEN) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "jp2images-stats",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error("GraphQL: " + JSON.stringify(json.errors));
  return json.data;
}

// --- Fetch profile, contributions, PR/issue totals -------------------------
const profileQuery = `
query ($login: String!) {
  user(login: $login) {
    name
    login
    location
    followers { totalCount }
    following { totalCount }
    createdAt
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    pullRequests { totalCount }
    issues { totalCount }
  }
}`;

// --- Fetch owned repos for stars + language aggregation --------------------
const reposQuery = `
query ($login: String!, $cursor: String) {
  user(login: $login) {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, privacy: PUBLIC,
                 orderBy: {field: STARGAZERS, direction: DESC}, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount
        languages(first: 12, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

function computeStreak(weeks) {
  // Flatten calendar to a date->count map, walk backwards from today.
  const days = [];
  for (const w of weeks) for (const d of w.contributionDays) days.push(d);
  days.sort((a, b) => a.date.localeCompare(b.date));
  let current = 0;
  // Allow today to be 0 (day not over) without breaking the streak.
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else if (i === days.length - 1) continue; // today still has 0
    else break;
  }
  let longest = 0, run = 0;
  for (const d of days) {
    if (d.contributionCount > 0) { run++; longest = Math.max(longest, run); }
    else run = 0;
  }
  return { current, longest };
}

const data = await gql(profileQuery, { login: USER });
const u = data.user;
const cc = u.contributionsCollection;

let totalStars = 0;
const langTotals = new Map(); // name -> { size, color }
let cursor = null;
do {
  const page = await gql(reposQuery, { login: USER, cursor });
  const repos = page.user.repositories;
  for (const r of repos.nodes) {
    totalStars += r.stargazerCount;
    for (const e of r.languages.edges) {
      const k = e.node.name;
      const prev = langTotals.get(k) || { size: 0, color: e.node.color || "#888" };
      prev.size += e.size;
      langTotals.set(k, prev);
    }
  }
  cursor = repos.pageInfo.hasNextPage ? repos.pageInfo.endCursor : null;
} while (cursor);

const { current: streak, longest } = computeStreak(cc.contributionCalendar.weeks);

const accountAgeYears = (
  (Date.now() - new Date(u.createdAt)) / (365.25 * 24 * 3600 * 1000)
).toFixed(1);

const langArr = [...langTotals.entries()]
  .map(([name, v]) => ({ name, size: v.size, color: v.color }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 6);
const langSum = langArr.reduce((s, l) => s + l.size, 0) || 1;

const stats = {
  name: u.name || u.login,
  login: u.login,
  location: u.location,
  followers: u.followers.totalCount,
  repos: u.repositories.totalCount,
  accountAgeYears,
  stars: totalStars,
  commits: cc.totalCommitContributions,
  prs: u.pullRequests.totalCount,
  issues: u.issues.totalCount,
  reviews: cc.totalPullRequestReviewContributions,
  contribYear: cc.contributionCalendar.totalContributions,
  streak,
  longest,
};

// --- Render SVG ------------------------------------------------------------
const T = {
  bg: "#1a1b27",
  bg2: "#16161e",
  border: "#2a2c3f",
  title: "#70a5fd",
  text: "#a9b1d6",
  accent: "#bf91f3",
  good: "#9ece6a",
  muted: "#565f89",
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => n.toLocaleString("en-US");

const W = 860, H = 300;

function statRow(x, y, label, value, color) {
  return `
    <text x="${x}" y="${y}" class="lbl">${esc(label)}</text>
    <text x="${x + 215}" y="${y}" class="val" fill="${color}" text-anchor="end">${esc(value)}</text>`;
}

// Language bar
let langBar = "";
let lx = 0;
const barW = 360;
for (const l of langArr) {
  const w = (l.size / langSum) * barW;
  langBar += `<rect x="${lx}" y="0" width="${w.toFixed(2)}" height="10" fill="${l.color}"/>`;
  lx += w;
}
let langLegend = "";
langArr.forEach((l, i) => {
  const col = i % 2;
  const row = Math.floor(i / 2);
  const lxp = col * 175;
  const lyp = row * 24;
  const pct = ((l.size / langSum) * 100).toFixed(1);
  langLegend += `
    <circle cx="${lxp + 6}" cy="${lyp + 6}" r="5" fill="${l.color}"/>
    <text x="${lxp + 18}" y="${lyp + 10}" class="lang">${esc(l.name)} <tspan class="muted">${pct}%</tspan></text>`;
});

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub stats for ${esc(stats.login)}">
  <style>
    .title { font: 700 20px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${T.title}; }
    .sub   { font: 400 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${T.muted}; }
    .lbl   { font: 400 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${T.text}; }
    .val   { font: 700 14px 'Segoe UI', Ubuntu, Sans-Serif; }
    .lang  { font: 400 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${T.text}; }
    .muted { fill: ${T.muted}; }
    .hdr   { font: 700 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${T.accent}; letter-spacing: .5px; }
    .big   { font: 700 30px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${T.good}; }
    .biglbl{ font: 400 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${T.muted}; }
  </style>
  <rect x="0.5" y="0.5" rx="10" width="${W - 1}" height="${H - 1}" fill="${T.bg}" stroke="${T.border}"/>

  <!-- Header -->
  <text x="30" y="42" class="title">${esc(stats.name)}'s GitHub</text>
  <text x="30" y="62" class="sub">@${esc(stats.login)}${stats.location ? "  ·  " + esc(stats.location) : ""}  ·  ${stats.accountAgeYears} yrs on GitHub  ·  ${fmt(stats.followers)} followers  ·  ${fmt(stats.repos)} repos</text>
  <line x1="30" y1="78" x2="${W - 30}" y2="78" stroke="${T.border}"/>

  <!-- Left: core stats -->
  <g transform="translate(30, 108)">
    <text x="0" y="0" class="hdr">CORE STATS</text>
    ${statRow(0, 30, "Total stars earned", fmt(stats.stars), T.good)}
    ${statRow(0, 56, "Commits (this year)", fmt(stats.commits), T.good)}
    ${statRow(0, 82, "Pull requests", fmt(stats.prs), T.good)}
    ${statRow(0, 108, "Issues", fmt(stats.issues), T.good)}
    ${statRow(0, 134, "Code reviews (this year)", fmt(stats.reviews), T.good)}
    ${statRow(0, 160, "Contributions (this year)", fmt(stats.contribYear), T.good)}
  </g>

  <!-- Divider -->
  <line x1="430" y1="92" x2="430" y2="270" stroke="${T.border}"/>

  <!-- Right top: streak -->
  <g transform="translate(470, 108)">
    <text x="0" y="0" class="hdr">ACTIVITY</text>
    <g transform="translate(0, 14)">
      <text x="0" y="32" class="big">${fmt(stats.streak)}🔥</text>
      <text x="0" y="50" class="biglbl">current day streak</text>
    </g>
    <g transform="translate(180, 14)">
      <text x="0" y="32" class="big">${fmt(stats.longest)}</text>
      <text x="0" y="50" class="biglbl">longest streak (1y)</text>
    </g>
  </g>

  <!-- Right bottom: languages -->
  <g transform="translate(470, 192)">
    <text x="0" y="0" class="hdr">TOP LANGUAGES</text>
    <g transform="translate(0, 14)">
      <clipPath id="r"><rect width="${barW}" height="10" rx="5"/></clipPath>
      <g clip-path="url(#r)">${langBar}</g>
    </g>
    <g transform="translate(0, 36)">${langLegend}</g>
  </g>

  <text x="30" y="${H - 16}" class="sub">updated ${new Date().toISOString().slice(0, 10)}</text>
</svg>`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, svg, "utf8");
console.log(`Wrote ${OUT}`);
console.log(JSON.stringify(stats, null, 2));
