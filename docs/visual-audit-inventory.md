# Migration visual audit

- new stack: `http://localhost:3000`
- legacy stack: `http://localhost:8081`
- screenshots: `/out/audit-open` (`<name>--legacy.png`, `<name>--new.png`)

| page | legacy path | new path | legacy | new | verdict |
| --- | --- | --- | --- | --- | --- |
| articles | /articles | /articles | 200 | 200 | compare |
| articles-archive | /articles/archive | â€” | 200 | ABSENT | NOT CONVERTED |
| articles-category | /articles/category/announcements | â€” | 200 | ABSENT | NOT CONVERTED |
| client | /client | /client | UNAUTH | 200 | compare |
| club | /club | â€” | 200 | ABSENT | NOT CONVERTED |
| collectables | /credits/collectables | /credits/collectables | 200 | 200 | compare |
| community | /community | /community | 200 | 200 | compare |
| credits | /credits | /credits | 200 | 200 | compare |
| credits-history | /credits/history | /credits/history | 200 | 200 | compare |
| forgot | /forgot | /forgot | 200 | 200 | compare |
| help | /help | /help | 200 | 200 | compare |
| hk-about | /housekeeping/about | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-alerts | /housekeeping/alerts | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-auditlog | /housekeeping/auditlog | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-banners | /housekeeping/banners | /housekeeping/banners | UNAUTH | UNAUTH | compare |
| hk-bans | /housekeeping/bans | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-cache | /housekeeping/cache | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-campaigns | /housekeeping/campaigns | /housekeeping/campaigns | UNAUTH | UNAUTH | compare |
| hk-catalogue | /housekeeping/catalogue | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-collectables | /housekeeping/collectables | /housekeeping/collectables | UNAUTH | UNAUTH | compare |
| hk-dashboard | /housekeeping/dashboard | /housekeeping/dashboard | UNAUTH | UNAUTH | compare |
| hk-faq | /housekeeping/faq | /housekeeping/faq | UNAUTH | UNAUTH | compare |
| hk-help | /housekeeping/help | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-login | /housekeeping/ | /housekeeping/login | 200 | 200 | compare |
| hk-logout | /housekeeping/logout | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-logs | /housekeeping/logs | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-maintenance | /housekeeping/maintenance | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-news | /housekeeping/news | /housekeeping/news | UNAUTH | UNAUTH | compare |
| hk-newsletter | /housekeeping/newsletter | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-permissions | /housekeeping/permissions | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-recommended | /housekeeping/recommended | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-reports | /housekeeping/reports | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-search | /housekeeping/search | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-settings | /housekeeping/settings | /housekeeping/settings | UNAUTH | UNAUTH | compare |
| hk-staffsessions | /housekeeping/staffsessions | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-twofactor | /housekeeping/twofactor | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-updates | /housekeeping/updates | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-users | /housekeeping/users | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| hk-vouchers | /housekeeping/vouchers | â€” | UNAUTH | ABSENT | NOT CONVERTED |
| landing | / | / | 200 | 200 | compare |
| maintenance | /maintenance | /maintenance | 200 | 200 | compare (site_closed=1) |
| me | /me | /me | 200 | 200 | compare |
| papers-disclaimer | /papers/disclaimer | â€” | 200 | ABSENT | NOT CONVERTED |
| papers-privacy | /papers/privacy | â€” | 200 | ABSENT | NOT CONVERTED |
| pixels | /credits/pixels | â€” | 200 | ABSENT | NOT CONVERTED |
| profile | /profile | /account/profile | 200 | 200 | compare |
| reauthenticate | /reauthenticate | /account/reauthenticate | UNAUTH | UNAUTH | compare |
| register | /register | â€” | 200 | ABSENT | NOT CONVERTED |
| tag-search | /tag/search | â€” | 200 | ABSENT | NOT CONVERTED |