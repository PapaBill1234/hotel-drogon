#!/usr/bin/env node
// Assemble local-only Nitro assets outside this repository. Never commit the
// generated directory or attach it to the primary hotel stack.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const lab = dirname(fileURLToPath(import.meta.url));
const upstream = resolve(lab, '../../../upstream');
const output = join(upstream, 'Nitro-Files-lab-v1');
const sources = [
    {
        name: 'Nitro-default-assets',
        url: 'https://git.krews.org/nitro/default-assets.git',
        revision: 'e8b882f84095ad3b3b6bb0b31e03d0cf8f7e104c',
        directories: ['bundled', 'gamedata', 'images', 'sounds']
    },
    {
        name: 'nitro-assets',
        url: 'https://github.com/sphynxkitten/nitro-assets.git',
        revision: '005cd6430c82f274603805bb2dd6686e714f2271',
        directories: ['clothes', 'effects', 'furniture', 'gamedata', 'pets']
    }
];

function git(directory, ...args)
{
    return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function prepareSource(source)
{
    const path = join(upstream, source.name);
    if(!existsSync(path))
    {
        execFileSync('git', ['-c', 'credential.helper=', 'clone', '--filter=blob:none', '--depth=1', '--no-checkout', source.url, path], { stdio: 'inherit' });
        git(path, 'sparse-checkout', 'init', '--cone');
        git(path, 'sparse-checkout', 'set', ...source.directories);
        git(path, 'checkout', '--detach', source.revision);
    }
    if(git(path, 'rev-parse', 'HEAD') !== source.revision || git(path, 'status', '--porcelain'))
        throw new Error(`${path} must be clean at ${source.revision}`);
    return path;
}

function copyDirectory(source, destination)
{
    if(!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`Missing asset directory: ${source}`);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
}

function copyJson(directory, destination)
{
    for(const name of readdirSync(directory).filter(name => name.endsWith('.json')))
    {
        const source = join(directory, name);
        JSON.parse(readFileSync(source, 'utf8'));
        const target = join(destination, name);
        if(existsSync(target)) throw new Error(`Duplicate gamedata name: ${name}`);
        cpSync(source, target, { errorOnExist: true, force: false });
    }
}

if(existsSync(output)) throw new Error(`${output} already exists; refusing to overwrite local assets`);
const [defaults, converted] = sources.map(prepareSource);
const assets = join(output, 'nitro-assets');
const bundled = join(assets, 'bundled');
const gamedata = join(assets, 'gamedata');
mkdirSync(gamedata, { recursive: true });
for(const [from, to] of [
    ['clothes', 'figure'], ['effects', 'effect'], ['furniture', 'furniture']
]) copyDirectory(join(converted, from, 'nitro'), join(bundled, to));
copyDirectory(join(converted, 'pets'), join(bundled, 'pet'));
copyDirectory(join(defaults, 'bundled', 'generic'), join(bundled, 'generic'));
for(const folder of ['clothes', 'effects', 'furniture', 'gamedata'])
    copyJson(join(converted, folder, 'json'), gamedata);
const uiTexts = join(defaults, 'gamedata', 'UITexts.json');
JSON.parse(readFileSync(uiTexts, 'utf8'));
cpSync(uiTexts, join(gamedata, 'UITexts.json'), { errorOnExist: true, force: false });
copyDirectory(join(defaults, 'images'), join(assets, 'images'));
copyDirectory(join(defaults, 'images'), join(bundled, 'c_images'));
copyDirectory(join(defaults, 'images'), join(bundled, 'images'));
copyDirectory(join(defaults, 'images'), join(output, 'swf', 'c_images'));
copyDirectory(join(defaults, 'sounds'), join(assets, 'sounds'));

for(const name of [
    'ExternalTexts.json', 'FigureData.json', 'FigureMap.json', 'EffectMap.json',
    'FurnitureData.json', 'ProductData.json', 'HabboAvatarActions.json', 'UITexts.json'
]) if(!existsSync(join(gamedata, name))) throw new Error(`Required gamedata missing: ${name}`);
for(const name of ['figure/hh_human_body.nitro', 'generic/room.nitro'])
    if(!existsSync(join(bundled, name))) throw new Error(`Required Nitro bundle missing: ${name}`);
console.log(`Prepared local-only assets at ${output}`);
