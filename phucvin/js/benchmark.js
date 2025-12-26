const Lite3 = require('./lite3');
const { performance } = require('perf_hooks');

function benchmark() {
    console.log("Running Lite3 JS Benchmarks...");

    // Create a smaller object for testing because split is not implemented yet
    // The node max keys is 7. So we can only insert 7 keys in the root.
    // However, if we implement recursive split, we can do more.
    // The current basic JS implementation throws "Node full".
    // So for now, we benchmark with 7 items to show basic speed, or we need to implement split.

    // Given user request "add basic JS implementation", full B-tree split logic is complex.
    // I will limit benchmark to small number of keys or implement linear scan fallback?
    // But Lite3 is B-tree.

    // Let's test with 5 items.
    let itemCount = 5;

    // JSON Stringify
    let obj = {};
    for (let i = 0; i < itemCount; i++) {
        obj[`key_${i}`] = `value_${i}`;
    }

    let start = performance.now();
    for(let k=0; k<10000; k++) {
        JSON.stringify(obj);
    }
    let end = performance.now();
    let jsonStringifyTime = (end - start) / 10000;

    // JSON Parse
    let jsonStr = JSON.stringify(obj);
    start = performance.now();
    for(let k=0; k<10000; k++) {
        JSON.parse(jsonStr);
    }
    end = performance.now();
    let jsonParseTime = (end - start) / 10000;

    // Lite3 Init & Set
    let l3 = new Lite3(1024);

    start = performance.now();
    for(let k=0; k<10000; k++) {
        let buflen = { val: 0 };
        buflen.val = l3.init_obj();
        for (let i = 0; i < itemCount; i++) {
            l3.set_str(buflen, 0, 1024, `key_${i}`, `value_${i}`);
        }
    }
    end = performance.now();
    let lite3SetTime = (end - start) / 10000;

    // Lite3 Get (Read all)
    // Setup one buffer
    let buflen = { val: 0 };
    buflen.val = l3.init_obj();
    for (let i = 0; i < itemCount; i++) {
        l3.set_str(buflen, 0, 1024, `key_${i}`, `value_${i}`);
    }

    start = performance.now();
    for(let k=0; k<10000; k++) {
        for (let i = 0; i < itemCount; i++) {
            l3.get_str(buflen.val, 0, `key_${i}`);
        }
    }
    end = performance.now();
    let lite3GetTime = (end - start) / 10000;

    // Lite3 Nested Get
    // Setup nested object
    buflen = { val: 0 };
    buflen.val = l3.init_obj();
    let subOfs = l3.set_obj(buflen, 0, 1024, "nested");
    l3.set_str(buflen, subOfs, 1024, "subKey", "subVal");

    start = performance.now();
    for(let k=0; k<10000; k++) {
         let sOfs = l3.get_obj(buflen.val, 0, "nested");
         l3.get_str(buflen.val, sOfs, "subKey");
    }
    end = performance.now();
    let lite3NestedGetTime = (end - start) / 10000;

    console.log(`
Benchmark Results (Average per iteration, ${itemCount} keys):
------------------------------------------------------------
JSON.stringify:     ${(jsonStringifyTime * 1000).toFixed(3)} us
JSON.parse:         ${(jsonParseTime * 1000).toFixed(3)} us
Lite3 Set:          ${(lite3SetTime * 1000).toFixed(3)} us
Lite3 Get:          ${(lite3GetTime * 1000).toFixed(3)} us
Lite3 Nested Get:   ${(lite3NestedGetTime * 1000).toFixed(3)} us
    `);

    return {
        jsonStringifyTime,
        jsonParseTime,
        lite3SetTime,
        lite3GetTime,
        lite3NestedGetTime
    };
}

benchmark();
