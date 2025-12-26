# Lite3 JS

Basic JavaScript implementation of Lite³ (Lite Cubed), a zero-copy binary serialization format.

## Usage

```javascript
const Lite3 = require('./lite3');

// Initialize with a buffer size (e.g., 1KB)
let l3 = new Lite3(1024);

// Initialize object
let buflen = { val: 0 };
buflen.val = l3.init_obj();

// Set values
l3.set_str(buflen, 0, 1024, "hello", "world");
l3.set_i64(buflen, 0, 1024, "count", 42);
l3.set_bool(buflen, 0, 1024, "active", true);

// Get values (zero-copy read)
console.log(l3.get_str(buflen.val, 0, "hello")); // "world"
console.log(l3.get_i64(buflen.val, 0, "count")); // 42

// Print as JSON
l3.json_print(buflen.val, 0);

// Nested Objects
let subOfs = l3.set_obj(buflen, 0, 1024, "config");
l3.set_str(buflen, subOfs, 1024, "host", "localhost");
```

## Running Tests

```bash
node test.js
```

## Running Benchmarks

```bash
node benchmark.js
```

### Latest Benchmark Results

Running on 5 flat keys + 1 nested object (total 6 keys).

| Operation | JSON (us) | Lite3 JS (us) |
|-----------|-----------|---------------|
| Stringify / Set | 0.926 | 45.485 |
| Parse / Get (All) | 2.136 | 8.951 |
| Parse / Get (Single Nested) | 1.343 | 1.791 |

*Note: The JS implementation is currently basic and unoptimized compared to the C version. The 'Set' operation is slower because it involves ArrayBuffer manipulations and text encoding in JS. 'Get' operations are reasonably fast, and single nested field access is faster than JSON.parse (which requires parsing the whole string).*
