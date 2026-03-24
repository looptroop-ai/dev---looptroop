const str = "foo\n".repeat(100000);
console.time('split');
str.split('\n').length > 5;
console.timeEnd('split');

console.time('hasMoreThanLines');
function hasMoreThanLines(text, numLines = 5) {
  let count = 0;
  let pos = text.indexOf('\n');
  while (pos !== -1) {
    count++;
    if (count >= numLines) return true;
    pos = text.indexOf('\n', pos + 1);
  }
  return false;
}
hasMoreThanLines(str, 5);
console.timeEnd('hasMoreThanLines');
