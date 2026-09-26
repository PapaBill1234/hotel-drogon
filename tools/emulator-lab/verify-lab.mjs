#!/usr/bin/env node
// Dependency-free smoke for an isolated local emulator lab. It never creates
// accounts, writes to a database, or treats an asset-free shell as in-game.
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const client = 'http://127.0.0.1:3201';
const emulator = 'http://127.0.0.1:3202';
const shellOnly = process.argv.includes('--shell-only');

async function get(path, expected = 200)
{
    const response = await fetch(path, { signal: AbortSignal.timeout(10000) });
    if(response.status !== expected) throw new Error(`${path}: HTTP ${response.status}, expected ${expected}`);
    return response;
}

async function websocketOpen()
{
    await new Promise((resolveOpen, reject) =>
    {
        const ws = new WebSocket('ws://127.0.0.1:3202/');
        const timer = setTimeout(() => { ws.close(); reject(new Error('WebSocket open timed out')); }, 10000);
        ws.addEventListener('open', () => { clearTimeout(timer); ws.close(); resolveOpen(); }, { once: true });
        ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket handshake failed')); }, { once: true });
    });
}

function firstNitro(directory)
{
    const stack = [directory];
    while(stack.length)
    {
        const current = stack.pop();
        for(const item of readdirSync(current, { withFileTypes: true }))
        {
            const path = join(current, item.name);
            if(item.isFile() && item.name.endsWith('.nitro')) return path;
            if(item.isDirectory()) stack.push(path);
        }
    }
    return null;
}

async function main()
{
    for(const origin of [emulator, client])
    {
        const health = await (await get(`${origin}/api/health`)).json();
        if(health.status !== 'ok') throw new Error(`${origin} returned an unhealthy API payload`);
        console.log(`[PASS] ${origin}/api/health`);
    }
    const html = await (await get(client)).text();
    if(!html.includes('<html')) throw new Error('Octane did not serve an HTML shell');
    console.log('[PASS] Octane HTML shell');

    const renderer = await (await get(`${client}/configuration/renderer-config.json`)).json();
    const mode = await (await get(`${client}/configuration/client-mode.json`)).json();
    if(renderer['socket.url'] !== 'ws://127.0.0.1:3202' ||
       renderer['login.screen.enabled'] !== false ||
       renderer['asset.url'] !== 'http://127.0.0.1:3201/nitro-assets/bundled' ||
       mode.secureAssetsEnabled !== false || mode.secureApiEnabled !== false)
    {
        throw new Error('Octane local endpoints or client mode do not match this lab');
    }
    console.log('[PASS] Octane endpoint and local mode configuration');
    await websocketOpen();
    console.log('[PASS] PolarIS WebSocket handshake');

    if(shellOnly)
    {
        console.log('[GAP] Game assets and in-game browser journey were not checked (--shell-only).');
        return;
    }
    const assetRoot = process.env.NITRO_FILES_DIR;
    if(!assetRoot) throw new Error('NITRO_FILES_DIR is required for an asset check');
    const nitroRoot = join(resolve(assetRoot), 'nitro-assets');
    if(!statSync(nitroRoot).isDirectory()) throw new Error(`${nitroRoot} is not a directory`);
    const asset = firstNitro(nitroRoot);
    if(!asset) throw new Error(`${nitroRoot} contains no .nitro file`);
    const urlPath = relative(nitroRoot, asset).split(sep).map(encodeURIComponent).join('/');
    await get(`${client}/nitro-assets/${urlPath}`);
    console.log(`[PASS] Octane serves a mounted .nitro asset: ${urlPath}`);
    console.log('[GAP] In-game login and room rendering still require a browser journey.');
}

main().catch(error => { console.error(`[FAIL] ${error.message}`); process.exitCode = 1; });
