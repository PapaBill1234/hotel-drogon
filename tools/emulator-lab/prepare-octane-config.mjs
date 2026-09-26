// Normalize the JSONC example shipped by the pinned Octane revision for its
// installer, which still expects renderer-config.example and strict JSON.
import { readFileSync, writeFileSync } from 'node:fs';
import stripJsonComments from 'strip-json-comments';

const root = '/workspace/Octane/public/configuration';
const renderer = JSON.parse(stripJsonComments(
    readFileSync(`${root}/renderer-config..jsonc.example.json`, 'utf8'),
    { trailingCommas: true }));

for(const [key, value] of Object.entries(renderer))
{
    if(typeof value === 'string')
    {
        renderer[key] = value.replaceAll('localhost:5173', '127.0.0.1:3201')
            .replaceAll('localhost:2096', '127.0.0.1:3202');
    }
}
renderer['api.url'] = 'http://127.0.0.1:3201';
renderer['socket.url'] = 'ws://127.0.0.1:3202';
// The website owns authentication; the isolated client accepts an SSO ticket.
renderer['login.screen.enabled'] = false;
// The pinned default-assets revision ships strict JSON under this name.
renderer['external.texts.url'] = [
    '${gamedata.url}/ExternalTexts.json',
    '${gamedata.url}/UITexts.json'
];
const rendererJson = `${JSON.stringify(renderer, null, 4)}\n`;
writeFileSync(`${root}/renderer-config.example`, rendererJson);
writeFileSync(`${root}/renderer-config.json`, rendererJson);

const mode = JSON.parse(readFileSync(`${root}/client-mode.example`, 'utf8'));
mode.secureAssetsEnabled = false;
mode.secureApiEnabled = false;
mode.apiBaseUrl = 'http://127.0.0.1:3201';
mode.plainConfigBaseUrl = 'http://127.0.0.1:3201/configuration';
mode.plainGamedataBaseUrl = 'http://127.0.0.1:3201/nitro-assets/gamedata';
writeFileSync(`${root}/client-mode.json`, `${JSON.stringify(mode, null, 4)}\n`);
