// Hostile parse-worker fixture: drips one byte every 100 ms forever. Expect parse_timeout.
setInterval(() => process.stdout.write('{'), 100);
