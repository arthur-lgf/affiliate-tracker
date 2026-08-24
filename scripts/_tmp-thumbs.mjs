import sharp from 'sharp';
const out = 'C:/Users/salva/AppData/Local/Temp/claude/c--Users-salva-Documents-LGF-Projects/9f840379-31e2-4061-98ec-c3302f338a70/scratchpad/';
for (const n of [1, 2, 3, 4, 5, 6]) {
  await sharp('assets/w9-page' + n + '.jpg').resize({ width: 620 }).png().toFile(out + 'thumb-w9-' + n + '.png');
}
console.log('thumbs written');
