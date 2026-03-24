const str = "foo\n".repeat(100000);
console.time('getLastLines');
function getLastLines(text, numLines = 5, maxChars = 1000) {
  let count = 0
  let pos = text.length - 1
  while (pos >= 0) {
    pos = text.lastIndexOf('\n', pos)
    if (pos !== -1) {
      count++
      if (count === numLines) {
        return '...\n' + text.slice(pos + 1)
      }
      pos--
    } else {
      break
    }
  }
  if (text.length > maxChars) {
    return '...' + text.slice(-maxChars)
  }
  return text
}
getLastLines(str, 5);
console.timeEnd('getLastLines');