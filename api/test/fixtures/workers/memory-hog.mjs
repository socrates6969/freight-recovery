// Hostile parse-worker fixture: allocates until the V8 heap limit aborts the process (parse_memory).
const hold = [];
for (;;) hold.push(new Array(1e6).fill(Math.random()));
