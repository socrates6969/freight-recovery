// Hostile parse-worker fixture: floods stdout. Expect parse_failed (output cap) and a killed process.
const chunk = 'x'.repeat(65536);
const write = () => {
  while (process.stdout.write(chunk));
  process.stdout.once('drain', write);
};
write();
