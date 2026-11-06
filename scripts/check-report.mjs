// Перевірка результату кодом, а не словами моделі. Exit 0 = добре, exit 1 = звіт не пройшов.
import { existsSync, readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path || !existsSync(path)) {
  console.error(`❌ Звіту немає: ${path}`);
  process.exit(1);
}

const text = readFileSync(path, 'utf8');
const sections = ['## Головне', '## Лендинг', '## Соцмережі', '## Репутація', '## Конкуренти', '## План дій', '## Обмеження', '## Перевірка'];
const problems = sections.filter((s) => !text.includes(s)).map((s) => `немає розділу «${s}»`);

if (!/https?:\/\//.test(text)) problems.push('немає жодного посилання на джерело');
if (!/ПРОЙШОВ|ТРЕБА ВИПРАВИТИ/.test(text)) problems.push('немає вердикту рецензента');

if (problems.length) {
  problems.forEach((p) => console.error(`❌ ${p}`));
  process.exit(1);
}
console.log(`✅ Звіт пройшов перевірку: ${path}`);
