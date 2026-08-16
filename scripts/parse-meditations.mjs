import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_INPUT_PATH = resolve(PROJECT_ROOT, 'data/source/meditations-long.txt');
export const DEFAULT_OUTPUT_PATH = resolve(PROJECT_ROOT, 'data/meditations.pages.json');

const BOOK_NAMES = [
  'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH',
  'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH', 'ELEVENTH', 'TWELFTH',
];

const SOURCE = {
  title: 'Meditations',
  translator: 'George Long',
  url: 'https://www.gutenberg.org/ebooks/2680',
};

export function romanToNumber(roman) {
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const value = values[roman[index]];
    if (!value) throw new Error(`Invalid Roman numeral: ${roman}`);
    const next = values[roman[index + 1]] ?? 0;
    total += value < next ? -value : value;
  }

  return total;
}

function normalizeSectionText(lines) {
  return lines
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBookBodies(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const headings = [...normalized.matchAll(/^THE (FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH) BOOK\s*$/gm)];
  if (!headings.length) throw new Error('No Book headings found');

  return headings.map((match, index) => {
    const bookName = match[1];
    const start = match.index + match[0].length;
    const nextHeading = headings[index + 1]?.index ?? normalized.length;
    const appendix = normalized.slice(start, nextHeading).search(/^APPENDIX\s*$/m);
    const end = appendix >= 0 ? start + appendix : nextHeading;
    return { book: BOOK_NAMES.indexOf(bookName) + 1, body: normalized.slice(start, end) };
  });
}

function parseBook(book) {
  const body = book.body.replace(/(?<=\.)\s+(?=[IVXLCDM]+\.\s)/g, '\n');
  const sectionMatches = [...body.matchAll(/^\s*([IVXLCDM]+)\.\s*(.*)$/gm)];
  if (!sectionMatches.length) throw new Error(`Book ${book.book} has no numbered sections`);

  let previousSection = 0;
  return sectionMatches.map((match, index) => {
    const section = romanToNumber(match[1]);
    const start = match.index + match[0].length;
    const end = sectionMatches[index + 1]?.index ?? body.length;
    const text = normalizeSectionText([match[2], body.slice(start, end)]);
    if (!text) throw new Error(`Book ${book.book} section ${section} is empty`);
    if (section <= previousSection) throw new Error(`Book ${book.book} sections are not increasing`);
    previousSection = section;

    return {
      id: `book-${String(book.book).padStart(2, '0')}-section-${String(section).padStart(2, '0')}`,
      book: book.book,
      section,
      label: `Book ${toRoman(book.book)} · Section ${section}`,
      source: { ...SOURCE },
      text,
      modernVersion: null,
      illustration: { status: 'pending', path: null, prompt: null },
    };
  });
}

function toRoman(number) {
  const numerals = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let remaining = number;
  let result = '';
  for (const [value, numeral] of numerals) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
}

export function parseText(text, { requireComplete = true } = {}) {
  const books = extractBookBodies(text);
  if (requireComplete && books.length !== BOOK_NAMES.length) {
    throw new Error(`Expected twelve Books, found ${books.length}`);
  }
  const pages = books.flatMap(parseBook);
  return { source: { ...SOURCE }, pages };
}

export async function parseSourceFile(inputPath = DEFAULT_INPUT_PATH, outputPath = DEFAULT_OUTPUT_PATH) {
  const result = parseText(await readFile(inputPath, 'utf8'));
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

function parseArgs(args) {
  const options = { input: DEFAULT_INPUT_PATH, output: DEFAULT_OUTPUT_PATH };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--input') options.input = resolve(args[++index]);
    else if (args[index] === '--output') options.output = resolve(args[++index]);
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  parseSourceFile(parseArgs(process.argv.slice(2)).input, parseArgs(process.argv.slice(2)).output)
    .then(({ pages }) => console.log(`Generated ${pages.length} pages`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
