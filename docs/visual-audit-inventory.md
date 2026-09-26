# Migration visual audit

- new stack: `http://localhost:3000`
- legacy stack: `http://localhost:8081`
- screenshots: `/out/audit-open` (`<name>--legacy.png`, `<name>--new.png`)

| page | legacy path | new path | legacy | new | verdict |
| --- | --- | --- | --- | --- | --- |
| articles | /articles | /articles | 200 | 200 | compare |
| articles-archive | /articles/archive | -- | 200 | ABSENT | NOT CONVERTED |
| articles-category | /articles/category/announcements | -- | 200 | ABSENT | NOT CONVERTED |
| client | /client | /client | UNAUTH | 200 | compare |
| club | /club | -- | 200 | ABSENT | NOT CONVERTED |
| collectables | /credits/collectables | /credits/collectables | 200 | 200 | compare |
| community | /community | /community | 200 | 200 | compare |
| credits | /credits | /credits | 200 | 200 | compare |
| credits-history | /credits/history | /credits/history | 200 | 200 | compare |
| forgot | /forgot | /forgot | 200 | 200 | compare |
| help | /help | /help | 200 | 200 | compare |
| hk-about | /housekeeping/about | -- | 200 | ABSENT | NOT CONVERTED |
| hk-alerts | /housekeeping/alerts | -- | 200 | ABSENT | NOT CONVERTED |
| hk-auditlog | /housekeeping/auditlog | -- | 200 | ABSENT | NOT CONVERTED |
| hk-banners | /housekeeping/banners | /housekeeping/banners | 200 | 200 | compare |
| hk-bans | /housekeeping/bans | -- | 200 | ABSENT | NOT CONVERTED |
| hk-cache | /housekeeping/cache | -- | 200 | ABSENT | NOT CONVERTED |
| hk-campaigns | /housekeeping/campaigns | /housekeeping/campaigns | 200 | 200 | compare |
| hk-catalogue | /housekeeping/catalogue | -- | 200 | ABSENT | NOT CONVERTED |
| hk-collectables | /housekeeping/collectables | /housekeeping/collectables | 200 | 200 | compare |
| hk-dashboard | /housekeeping/dashboard | /housekeeping | 200 | 200 | compare |
| hk-faq | /housekeeping/faq | /housekeeping/faq | 200 | 200 | compare |
| hk-help | /housekeeping/help | -- | 200 | ABSENT | NOT CONVERTED |
| hk-login | /housekeeping/ | /housekeeping/login | 200 | 200 | compare |
| hk-logout | /housekeeping/logout | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-logs | /housekeeping/logs | -- | 200 | ABSENT | NOT CONVERTED |
| hk-maintenance | /housekeeping/maintenance | -- | 200 | ABSENT | NOT CONVERTED |
| hk-news | /housekeeping/news | /housekeeping/news | 200 | 200 | compare |
| hk-newsletter | /housekeeping/newsletter | -- | 200 | ABSENT | NOT CONVERTED |
| hk-permissions | /housekeeping/permissions | -- | 200 | ABSENT | NOT CONVERTED |
| hk-recommended | /housekeeping/recommended | -- | 200 | ABSENT | NOT CONVERTED |
| hk-reports | /housekeeping/reports | -- | 200 | ABSENT | NOT CONVERTED |
| hk-search | /housekeeping/search | -- | 200 | ABSENT | NOT CONVERTED |
| hk-settings | /housekeeping/settings | /housekeeping/settings | 200 | 200 | compare |
| hk-staffsessions | /housekeeping/staffsessions | -- | 200 | ABSENT | NOT CONVERTED |
| hk-twofactor | /housekeeping/twofactor | -- | 200 | ABSENT | NOT CONVERTED |
| hk-updates | /housekeeping/updates | -- | 200 | ABSENT | NOT CONVERTED |
| hk-users | /housekeeping/users | -- | 200 | ABSENT | NOT CONVERTED |
| hk-vouchers | /housekeeping/vouchers | -- | 200 | ABSENT | NOT CONVERTED |
| landing | / | / | 200 | 200 | compare |
| maintenance | /maintenance | /maintenance | 200 | 200 | compare (site_closed=1) |
| me | /me | /me | 200 | 200 | compare |
| papers-disclaimer | /papers/disclaimer | -- | 200 | ABSENT | NOT CONVERTED |
| papers-privacy | /papers/privacy | -- | 200 | ABSENT | NOT CONVERTED |
| pixels | /credits/pixels | -- | 200 | ABSENT | NOT CONVERTED |
| profile | /profile | /account/profile | 200 | 200 | compare |
| reauthenticate | /reauthenticate | /account/reauthenticate | UNAUTH | UNAUTH | compare |
| register | /register | -- | 200 | ABSENT | NOT CONVERTED |
| tag-search | /tag/search | -- | 200 | ABSENT | NOT CONVERTED |