const Lite3 = require('./lite3');
const assert = require('assert');

function test() {
    console.log("Running Lite3 JS tests...");

    // Test Initialization
    let l3 = new Lite3(1024);
    let buflen = { val: 0 };
    buflen.val = l3.init_obj();
    assert.strictEqual(buflen.val, 96, "Initial object size should be 96");

    // Test Set/Get String
    l3.set_str(buflen, 0, 1024, "hello", "world");
    let val = l3.get_str(buflen.val, 0, "hello");
    assert.strictEqual(val, "world", "Should retrieve string 'world'");

    // Test Set/Get Integer
    l3.set_i64(buflen, 0, 1024, "number", 12345);
    let num = l3.get_i64(buflen.val, 0, "number");
    assert.strictEqual(num, 12345, "Should retrieve integer 12345");

    // Test Set/Get Float
    l3.set_f64(buflen, 0, 1024, "float", 3.14);
    let f = l3.get_f64(buflen.val, 0, "float");
    assert.ok(Math.abs(f - 3.14) < 0.0001, "Should retrieve float approx 3.14");

    // Test Set/Get Bool
    l3.set_bool(buflen, 0, 1024, "boolTrue", true);
    assert.strictEqual(l3.get_bool(buflen.val, 0, "boolTrue"), true, "Should retrieve true");
    l3.set_bool(buflen, 0, 1024, "boolFalse", false);
    assert.strictEqual(l3.get_bool(buflen.val, 0, "boolFalse"), false, "Should retrieve false");

    // Test JSON Print
    console.log("JSON Output:");
    l3.json_print(buflen.val, 0);

    console.log("All tests passed!");
}

test();
