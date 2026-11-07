import { compile, createFileManager } from '@noir-lang/noir_wasm';
import { mkdir, writeFile } from 'node:fs/promises';
const { program } = await compile(createFileManager(`${process.cwd()}/circuits/dictionary`));
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/dictionary-circuit.json', JSON.stringify(program).replaceAll(process.cwd(), ''));
console.log('Compiled dictionary circuit with Noir 1.0.0');
