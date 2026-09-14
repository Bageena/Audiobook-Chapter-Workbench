const p = 'D:\\Tools\\Audiobook Workbench\\LUE\\01 LUE.mp3';
const escaped = p.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
console.log(`file '${escaped}'`);
