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

Running on 5 keys (small object) due to basic implementation limits (no node splitting).

| Operation | JSON (us) | Lite3 JS (us) |
|-----------|-----------|---------------|
| Stringify / Set | 1.580 | 15.232 |
| Parse / Get | 1.475 | 4.252 |

*Note: The JS implementation is currently basic and unoptimized compared to the C version. The 'Set' operation is slower because it involves ArrayBuffer manipulations and text encoding in JS. 'Get' is reasonably fast but still slower than V8 optimized JSON.parse for small objects.*
