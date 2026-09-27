#!/usr/bin/env node
/** Join generated legacy entries with conservative reviewed port status. */
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(process.argv[2] ?? 'docs/legacy-surface-inventory.md', 'utf8');
const output = process.argv[3] ?? 'docs/modular-cms-route-status.md';
const rows = [];
let section = '';
for (const line of source.split(/\r?\n/)) {
  if (line.startsWith('### ')) section = line.slice(4).trim();
  if (!line.startsWith('| ') || line.startsWith('| ---') || line.includes(' file | ')) continue;
  const cells = line.slice(2, -1).split(' | ');
  if (cells.length !== 5 || cells[0] === 'pattern' || cells[0] === 'file') continue;
  const [file, gate, rank, writes, reads] = cells;
  rows.push({ section, file, gate, rank, writes, reads });
}

const exact = new Map([
  ['account.php', ['verified', 'frontend/src/App.tsx; account controllers', 'Account convenience route is covered by the existing-user flow']],
  ['articles.php', ['verified', 'frontend/src/App.tsx; PublicContentController', 'Only evidenced list/detail/archive/category behavior is claimed']],
  ['client.php', ['partial', 'frontend/src/pages/account/ClientPage.tsx; docs/phase1-parity-inventory.md', 'Website ticket handoff is verified in the Octane lab; non-loopback launch remains open']],
  ['club.php', ['unsupported', 'docs/phase1-parity-inventory.md', 'Emulator-bound Club purchase is explicitly unsupported']],
  ['collectables.php', ['verified', 'frontend/src/App.tsx; PublicContentController', 'Public read is verified; populated current-month branch remains a fixture gap']],
  ['community.php', ['verified', 'frontend/src/App.tsx; PublicContentController', 'Public page and community-news read are verified']],
  ['credits.php', ['verified', 'frontend/src/App.tsx; CreditsController', 'Balance read is verified; purchase actions are not claimed']],
  ['discussions.php', ['not-started', 'docs/phase1-parity-inventory.md', 'Phase 7 groups/discussions UI is not implemented']],
  ['email.php', ['not-started', 'docs/phase1-parity-inventory.md', 'No current route or verified mail transport']],
  ['forgot.php', ['verified', 'frontend/src/pages/account/ForgotPasswordPage.tsx; AccountController', 'Recovery and reset flows are verified; delivery is logged-only']],
  ['groups.php', ['not-started', 'docs/phase1-parity-inventory.md', 'Phase 7 group UI is not implemented']],
  ['help.php', ['verified', 'frontend/src/App.tsx; PublicContentController', 'Public help/FAQ read is verified']],
  ['history.php', ['verified', 'frontend/src/App.tsx; CreditsController', 'Own history read is verified; writers remain later-phase work']],
  ['home.php', ['partial', 'frontend/src/App.tsx; HomesController; docs/homes-layout-api.md', 'View/edit layout and widget content exist; guestbook, ratings, notes and store remain open']],
  ['landing.php', ['verified', 'frontend/src/App.tsx; PublicContentController', 'Landing read and visual parity are verified']],
  ['maintenance.php', ['verified', 'frontend/src/App.tsx; PublicContentController', 'Maintenance read is verified']],
  ['maintenance_new.php', ['unknown', 'docs/legacy-surface-inventory.md', 'Distinct legacy entry point has no separately evidenced current route']],
  ['me.php', ['verified', 'frontend/src/App.tsx; AuthController', 'Existing-user account read is verified']],
  ['papers.php', ['verified', 'frontend/src/App.tsx; frontend/src/pages/PapersPage.tsx', 'Disclaimer/privacy shell is ported; raw HTML settings remain withheld']],
  ['pixels.php', ['unsupported', 'docs/phase1-parity-inventory.md', 'Emulator-bound purchase flow is unsupported']],
  ['profile.php', ['verified', 'frontend/src/App.tsx; AccountController', 'Supported profile edits are verified']],
  ['reauthenticate.php', ['verified', 'frontend/src/App.tsx; SecurityController', 'Step-up flow is verified']],
  ['register.php', ['unsupported', 'docs/phase1-parity-inventory.md', 'PolarIS users write requires an explicit decision gate']],
  ['tag.php', ['verified', 'frontend/src/App.tsx; frontend/src/pages/TagPage.tsx', 'Honest no-tags page is ported']],
  ['welcome.php', ['unknown', 'docs/legacy-surface-inventory.md', 'No separately evidenced current route']],
]);
const admin = new Map([
  ['housekeeping/banners.php', ['verified', 'frontend/src/pages/admin/AdminBannersPage.tsx; AdminContentController']],
  ['housekeeping/campaigns.php', ['verified', 'frontend/src/pages/admin/AdminCampaignsPage.tsx; AdminContentController']],
  ['housekeeping/collectables.php', ['verified', 'frontend/src/pages/admin/AdminCollectiblesPage.tsx; AdminContentController']],
  ['housekeeping/dashboard.php', ['partial', 'frontend/src/pages/admin/AdminHomePage.tsx']],
  ['housekeeping/faq.php', ['verified', 'frontend/src/pages/admin/AdminFaqPage.tsx; AdminContentController']],
  ['housekeeping/index.php', ['partial', 'frontend/src/pages/admin/AdminLayout.tsx']],
  ['housekeeping/news.php', ['verified', 'frontend/src/pages/admin/AdminNewsPage.tsx; AdminContentController']],
  ['housekeeping/settings.php', ['verified', 'frontend/src/pages/admin/AdminSettingsPage.tsx; AdminContentController']],
  ['housekeeping/twofactor.php', ['partial', 'docs/phase1-parity-inventory.md']],
]);
function status(row) {
  if (exact.has(row.file)) return exact.get(row.file);
  if (admin.has(row.file)) return [...admin.get(row.file), 'Current narrow housekeeping route; broader legacy behavior is not claimed'];
  if (row.file.startsWith('housekeeping/')) return ['not-started', 'docs/phase1-parity-inventory.md', 'No current React route or verified equivalent'];
  if (['habblet/myhabbo_layout_save.php', 'habblet/myhabbo_layouts.php', 'habblet/myhabbo_homes.php'].includes(row.file)) return ['partial', 'include/controllers/HomesController.h; frontend/src/pages/HomePage.tsx', 'Homes layout/editor exists, but this is not a 1:1 endpoint claim'];
  if (row.file.startsWith('habblet/myhabbo_')) return ['not-started', 'docs/phase1-parity-inventory.md', 'Remaining Homes actions are not implemented'];
  if (row.file.startsWith('habblet/minimail_') || row.file.startsWith('habblet/friendmanagement_')) return ['not-started', 'docs/phase1-parity-inventory.md', 'Phase 6 minimail/friends slice is not implemented'];
  if (row.file.startsWith('habblet/groups_') || row.file.startsWith('habblet/grouppurchase_')) return ['not-started', 'docs/phase1-parity-inventory.md', 'Phase 7 groups/discussions slice is not implemented'];
  if (row.file.startsWith('xml/')) return ['not-started', 'docs/phase1-parity-inventory.md', 'No current XML route is evidenced for this endpoint'];
  if (['clientutils.php', 'security_check.php', 'intermediate.php'].includes(row.file)) return ['unknown', 'docs/legacy-surface-inventory.md', 'Legacy helper/entry point has no separately evidenced current route'];
  return ['not-started', 'docs/phase1-parity-inventory.md', 'No current route or service evidence'];
}
const counts = {};
const body = rows.map((row) => {
  const [state, evidence, note = 'Current narrow route; broader legacy behavior is not claimed'] = status(row);
  counts[state] = (counts[state] ?? 0) + 1;
  return `| ${row.section} | ${row.file} | ${row.gate || '—'} | ${row.writes || '—'} | **${state}** | ${evidence} | ${note} |`;
}).join('\n');
const countText = Object.entries(counts).map(([key, value]) => `**${key} ${value}**`).join(', ');
const out = `# Modular CMS route/action status join (plan v4, unit 1)

Generated by \`scripts/join_legacy_surface_status.mjs\` from \`docs/legacy-surface-inventory.md\`. The source map is static evidence from the read-only PHPRetro checkout; this table adds conservative current-stack judgement. **Unknown and unsupported are not passes.**

## Review rules

- **verified** means a current route/service and focused evidence exist for the stated narrow behavior; it is not a claim that every legacy branch is complete.
- **partial** means some behavior exists but the legacy entry point has remaining gaps.
- **unsupported** means the action is deliberately refused or emulator/dependency gated.
- **not-started** means no current equivalent is implemented. **unknown** means the current stack has not established an equivalent.
- Website/CMS rows remain website-owned. PolarIS rows remain behind named services. Pixel63 is a separate profile; no row below authorizes Pixel63 login, account writes, client launch, catalog writes, or asset import.

Counts: ${countText}. Entries: **${rows.length}**.

| Area | Legacy entry | Legacy gate | Legacy writes | Current status | Evidence | Scope note |
| --- | --- | --- | --- | --- | --- | --- |
${body}
`;
writeFileSync(output, out);
console.log(`wrote ${output}: ${rows.length} entries`);
