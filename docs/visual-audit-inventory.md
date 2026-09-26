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
| hk-about | /housekeeping/about | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-alerts | /housekeeping/alerts | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-auditlog | /housekeeping/auditlog | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-banners | /housekeeping/banners | /housekeeping/banners | UNAUTH | UNAUTH | compare |
| hk-bans | /housekeeping/bans | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-cache | /housekeeping/cache | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-campaigns | /housekeeping/campaigns | /housekeeping/campaigns | UNAUTH | UNAUTH | compare |
| hk-catalogue | /housekeeping/catalogue | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-collectables | /housekeeping/collectables | /housekeeping/collectables | UNAUTH | UNAUTH | compare |
| hk-dashboard | /housekeeping/dashboard | /housekeeping/dashboard | UNAUTH | UNAUTH | compare |
| hk-faq | /housekeeping/faq | /housekeeping/faq | UNAUTH | UNAUTH | compare |
| hk-help | /housekeeping/help | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-login | /housekeeping/ | /housekeeping/login | 200 | 200 | compare |
| hk-logout | /housekeeping/logout | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-logs | /housekeeping/logs | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-maintenance | /housekeeping/maintenance | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-news | /housekeeping/news | /housekeeping/news | UNAUTH | UNAUTH | compare |
| hk-newsletter | /housekeeping/newsletter | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-permissions | /housekeeping/permissions | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-recommended | /housekeeping/recommended | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-reports | /housekeeping/reports | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-search | /housekeeping/search | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-settings | /housekeeping/settings | /housekeeping/settings | UNAUTH | UNAUTH | compare |
| hk-staffsessions | /housekeeping/staffsessions | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-twofactor | /housekeeping/twofactor | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-updates | /housekeeping/updates | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-users | /housekeeping/users | -- | UNAUTH | ABSENT | NOT CONVERTED |
| hk-vouchers | /housekeeping/vouchers | -- | UNAUTH | ABSENT | NOT CONVERTED |
| landing | / | / | 200 | 200 | compare |
| maintenance | /maintenance | /maintenance | 200 | 200 | compare (measured with site_closed=1) |
| me | /me | /me | 200 | 200 | compare |
| papers-disclaimer | /papers/disclaimer | -- | 200 | ABSENT | NOT CONVERTED |
| papers-privacy | /papers/privacy | -- | 200 | ABSENT | NOT CONVERTED |
| pixels | /credits/pixels | -- | 200 | ABSENT | NOT CONVERTED |
| profile | /profile | /account/profile | 200 | 200 | compare |
| reauthenticate | /reauthenticate | /account/reauthenticate | UNAUTH | UNAUTH | compare |
| register | /register | -- | 200 | ABSENT | NOT CONVERTED |
| tag-search | /tag/search | -- | 200 | ABSENT | NOT CONVERTED |
