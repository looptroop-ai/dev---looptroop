if (process.env.LOOPTROOP_TEST_SILENT === '1') {
  console.log = () => undefined
  console.warn = () => undefined
}
