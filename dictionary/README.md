# EtherMan English vocabulary v1

`words.txt` is the canonical game vocabulary: 240,784 distinct words, each
containing 3–12 lowercase ASCII letters. Its SHA-256 is
`fa4d2310bcc2595705cd555be0ccdb73b390877dc670bcc8c3172f905112a7a9`.
Treat its bytes and ordering as versioned protocol input. Any change creates a
new vocabulary version and requires regenerating the associated Merkle root and
proof artifacts; do not silently replace this file for an existing deployment.

## Provenance and notices

The source is the published npm package
[`word-list@4.1.0`](https://www.npmjs.com/package/word-list/v/4.1.0), whose
[pinned fetch script](https://github.com/sindresorhus/word-list/blob/60b5059f4782080b1b254ac6cca46bb5eb4902ea/fetch-words.js)
retrieves `atebits/Words/Words/en.txt` and filters selected profanity. That
repository now redirects to
[`lorenbrichter/Words`](https://github.com/lorenbrichter/Words), the Letterpress
word list. The package declares MIT; its upstream declares CC0-1.0. Full copies
of both notices are retained in `licenses/`.

`manifest.json` records the package version, npm integrity, upstream snapshot,
source and normalized SHA-256 hashes, notice hashes, and normalization rules.
Every normalized word was checked for membership in the recorded upstream
snapshot. No words have been added for EtherMan.

## Normalization

Split the package's UTF-8 `words.txt` on CRLF or LF. Keep only lines matching
`^[a-z]{3,12}$`, remove exact duplicates, sort in ascending ASCII lexicographic
order, then serialize with LF separators and exactly one final LF. Do not trim
individual entries, lowercase them, or perform Unicode normalization.

After installing the pinned dependencies, this command reproduces and checks
the canonical bytes without modifying them:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile('dictionary/manifest.json', 'utf8'));
const source = await readFile('node_modules/word-list/words.txt');
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(source), manifest.source.sha256);
const words = [...new Set(source.toString('utf8').split(/\r?\n/)
  .filter(word => /^[a-z]{3,12}$/.test(word)))].sort();
const generated = words.join('\n') + '\n';
assert.equal(generated, await readFile('dictionary/words.txt', 'utf8'));
assert.equal(sha(generated), manifest.normalized.sha256);
assert.equal(words.length, manifest.normalized.wordCount);
console.log(`Verified ${words.length} words.`);
JS
```

## Meaning and limits

Membership proves inclusion in this exact game vocabulary, not universal
English validity. Upstream combines US, UK, and Australian spellings. It includes
inflections and uncommon words, and may omit proper names or newer technical
terms. Its profanity filtering is not a comprehensive moderation guarantee.
Words such as `cat`, `dog`, `ether`, `apple`, and `hangman` are present.

This directory contains public vocabulary data and license notices only. It
contains no player words, salts, witnesses, or proofs.
