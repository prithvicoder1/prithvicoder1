import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const username = process.env.GH_USERNAME || "prithvicoder1";
const token = process.env.GH_TOKEN;
const outputPath = process.env.OUTPUT_PATH || "dist/github-jet.svg";

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(from.getUTCFullYear() - 1);

async function loadCalendar() {
  if (!token) return { totalContributions: 0, weeks: [], preview: true };

  const query = `query($login:String!,$from:DateTime!,$to:DateTime!){
    user(login:$login){
      contributionsCollection(from:$from,to:$to){
        contributionCalendar{
          totalContributions
          weeks{contributionDays{contributionCount date weekday}}
        }
      }
    }
  }`;
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": `${username}-profile-rocket`
    },
    body: JSON.stringify({ query, variables: { login: username, from: from.toISOString(), to: now.toISOString() } })
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(`GitHub GraphQL request failed: ${JSON.stringify(payload.errors || payload)}`);
  }
  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error(`No contribution calendar found for ${username}`);
  return { ...calendar, preview: false };
}

function buildPreviewWeeks() {
  const weeks = [];
  const cursor = new Date(from);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
  for (let week = 0; week < 53; week += 1) {
    const contributionDays = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(cursor);
      date.setUTCDate(cursor.getUTCDate() + week * 7 + weekday);
      contributionDays.push({ contributionCount: 0, date: date.toISOString().slice(0, 10), weekday });
    }
    weeks.push({ contributionDays });
  }
  return weeks;
}

function renderSvg(calendar) {
  const weeks = (calendar.weeks.length ? calendar.weeks : buildPreviewWeeks()).slice(-53);
  const total = calendar.totalContributions || 0;
  const x0 = 177;
  const y0 = 128;
  const stepX = 17;
  const stepY = 20;
  const cell = 13;
  const colors = ["#132033", "#113949", "#0e5e70", "#0f9dad", "#63f3e5"];
  const allDays = weeks.flatMap((week, weekIndex) => week.contributionDays.map((day) => ({ ...day, weekIndex })));
  const maxCount = Math.max(1, ...allDays.map((day) => day.contributionCount));
  const level = (count) => count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
  const active = allDays.filter((day) => day.contributionCount > 0);
  const targets = [...active]
    .sort((a, b) => b.contributionCount - a.contributionCount || a.date.localeCompare(b.date))
    .slice(0, 7)
    .sort((a, b) => a.weekIndex - b.weekIndex || a.weekday - b.weekday);

  const center = (day) => ({ x: x0 + day.weekIndex * stepX + cell / 2, y: y0 + day.weekday * stepY + cell / 2 });
  const routePoints = targets.length
    ? [{ x: 72, y: 98 }, ...targets.map(center), { x: 1138, y: 86 }]
    : [{ x: 72, y: 98 }, { x: 430, y: 68 }, { x: 760, y: 102 }, { x: 1138, y: 86 }];
  const route = routePoints.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");

  const cells = allDays.map((day) => {
    const x = x0 + day.weekIndex * stepX;
    const y = y0 + day.weekday * stepY;
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${colors[level(day.contributionCount)]}"><title>${escapeXml(day.date)}: ${day.contributionCount} contribution${day.contributionCount === 1 ? "" : "s"}</title></rect>`;
  }).join("");

  const reticles = targets.map((day, index) => {
    const { x, y } = center(day);
    const begin = `${((index + 1) * 12 / Math.max(2, targets.length + 1)).toFixed(2)}s`;
    return `<g><circle cx="${x}" cy="${y}" r="10" fill="none" stroke="#ffcf5a" stroke-width="1.5" opacity="0"><animate attributeName="r" values="5;15;5" dur="1.2s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="1.2s" begin="${begin}" repeatCount="indefinite"/></circle><path d="M${x} ${y - 27}V${y - 8}" stroke="#ffcf5a" stroke-width="2" opacity="0"><animate attributeName="opacity" values="0;1;0" dur=".65s" begin="${begin}" repeatCount="indefinite"/></path></g>`;
  }).join("");

  const monthLabels = [];
  let lastMonth = "";
  weeks.forEach((week, index) => {
    const first = week.contributionDays[0];
    if (!first) return;
    const date = new Date(`${first.date}T00:00:00Z`);
    const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
    if (month !== lastMonth && index > 0) {
      monthLabels.push(`<text x="${x0 + index * stepX}" y="113" class="mono tiny muted">${month}</text>`);
      lastMonth = month;
    }
  });

  const targetLabels = [...targets].sort((a, b) => b.contributionCount - a.contributionCount).slice(0, 3)
    .map((day, index) => `<g transform="translate(${177 + index * 280} 295)"><circle cx="5" cy="-4" r="4" fill="#ffcf5a"/><text x="17" y="0" class="mono tiny muted">TARGET ${index + 1}</text><text x="86" y="0" class="mono tiny white">${escapeXml(day.date)} • ${day.contributionCount} commits</text></g>`).join("");

  const updated = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const status = calendar.preview ? "PREVIEW • AWAITING AUTOMATED SYNC" : `${total} CONTRIBUTIONS • ${targets.length} HIGH-ACTIVITY TARGETS`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="330" viewBox="0 0 1200 330" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(username)} contribution rocket mission</title>
  <desc id="description">An animated rocket flies across the contribution calendar and strikes the highest-activity days.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#050b16"/><stop offset="1" stop-color="#0b1325"/></linearGradient>
    <linearGradient id="routeGradient" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#22d3ee"/><stop offset=".55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#63f3b5"/></linearGradient>
    <filter id="glow" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <pattern id="stars" width="78" height="55" patternUnits="userSpaceOnUse"><circle cx="8" cy="11" r=".8" fill="#89c7de" opacity=".28"/><circle cx="52" cy="38" r=".55" fill="#c1b5ff" opacity=".24"/></pattern>
    <style>.mono{font-family:'JetBrains Mono','SFMono-Regular',Consolas,monospace}.white{fill:#eefaff}.cyan{fill:#58ecff}.green{fill:#63f3b5}.muted{fill:#7890aa}.tiny{font-size:10px}.small{font-size:13px}.label{font-size:11px;letter-spacing:2px}.blink{animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:.18}}</style>
  </defs>
  <rect width="1200" height="330" rx="22" fill="url(#bg)"/><rect width="1200" height="330" rx="22" fill="url(#stars)"/><rect x="1.5" y="1.5" width="1197" height="327" rx="21" fill="none" stroke="#1d4058"/>
  <path d="M22 1.5H1178Q1198.5 1.5 1198.5 22V46H1.5V22Q1.5 1.5 22 1.5Z" fill="#0a1423"/><line x1="1.5" y1="46" x2="1198.5" y2="46" stroke="#20364c"/>
  <circle cx="25" cy="24" r="5" fill="#ff6b81"/><circle cx="43" cy="24" r="5" fill="#f8cc61"/><circle cx="61" cy="24" r="5" fill="#52e097"/><text x="600" y="29" text-anchor="middle" class="mono small muted">contribution-defense.exe --pilot @${escapeXml(username)}</text><circle cx="1168" cy="24" r="4" fill="#63f3b5" class="blink"/>
  <text x="28" y="76" class="mono label muted">LIVE CONTRIBUTION ROCKET MISSION</text><text x="1172" y="76" text-anchor="end" class="mono tiny green">${escapeXml(status)}</text>
  <text x="143" y="139" text-anchor="end" class="mono tiny muted">MON</text><text x="143" y="179" text-anchor="end" class="mono tiny muted">WED</text><text x="143" y="219" text-anchor="end" class="mono tiny muted">FRI</text>
  ${monthLabels.join("")}${cells}
  <path id="missionRoute" d="${route}" fill="none" stroke="url(#routeGradient)" stroke-width="2" stroke-dasharray="6 10" opacity=".5"><animate attributeName="stroke-dashoffset" values="80;0" dur="4s" repeatCount="indefinite"/></path>
  ${reticles}
  <g filter="url(#glow)">
    <animateMotion dur="12s" repeatCount="indefinite" rotate="auto"><mpath href="#missionRoute"/></animateMotion>
    <path d="M-20 -4L-33 -11L-29 -2L-38 0L-29 2L-33 11L-20 4Z" fill="#ff9b45" opacity=".8"><animate attributeName="opacity" values=".35;1;.35" dur=".24s" repeatCount="indefinite"/></path>
    <path d="M-22 -8L-7 -13L9 -5L21 0L9 5L-7 13L-22 8L-14 0Z" fill="#dbeafe" stroke="#58ecff" stroke-width="1.5"/>
    <path d="M-8 -13L-16 -24L0 -14Z" fill="#8b5cf6"/><path d="M-8 13L-16 24L0 14Z" fill="#8b5cf6"/><circle cx="5" cy="0" r="4" fill="#071221" stroke="#63f3e5"/>
  </g>
  <rect x="28" y="274" width="1144" height="1" fill="#17344c"/>${targetLabels}
  <text x="28" y="316" class="mono tiny muted">ROCKET LOCKS ONTO THE YEAR'S HIGHEST-CONTRIBUTION DAYS</text><text x="1172" y="316" text-anchor="end" class="mono tiny muted">LAST SYNC ${escapeXml(updated)}</text>
  </svg>`;
}

const calendar = await loadCalendar();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, renderSvg(calendar), "utf8");
console.log(`Wrote ${outputPath} for ${username}`);
