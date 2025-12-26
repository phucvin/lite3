const { TextEncoder, TextDecoder } = require('util');

const LITE3_NODE_SIZE = 96;
const LITE3_NODE_ALIGNMENT = 4;
const LITE3_NODE_ALIGNMENT_MASK = 3;
const LITE3_NODE_KEY_COUNT_MAX = 7;
const LITE3_NODE_KEY_COUNT_MIN = 3; // MAX / 2
const LITE3_NODE_KEY_COUNT_MASK = 7;
const LITE3_NODE_TYPE_MASK = 0xFF;
const LITE3_NODE_SIZE_SHIFT = 6;
const LITE3_NODE_SIZE_MASK = ~((1 << 6) - 1);
const LITE3_NODE_SIZE_KC_OFFSET = 32;
const LITE3_NODE_GEN_SHIFT = 8;
const LITE3_NODE_GEN_MASK = ~((1 << 8) - 1);

const LITE3_KEY_TAG_SIZE_MIN = 1;
const LITE3_KEY_TAG_SIZE_MAX = 4;
const LITE3_KEY_TAG_SIZE_MASK = (1 << 2) - 1;
const LITE3_KEY_TAG_KEY_SIZE_MASK = ~((1 << 2) - 1);
const LITE3_KEY_TAG_KEY_SIZE_SHIFT = 2;

const LITE3_VAL_SIZE = 1;

const LITE3_TYPE = {
    NULL: 0,
    BOOL: 1,
    I64: 2,
    F64: 3,
    BYTES: 4,
    STRING: 5,
    OBJECT: 6,
    ARRAY: 7,
    INVALID: 8,
    COUNT: 9
};

const LITE3_TYPE_SIZES = [
    0, // NULL
    1, // BOOL
    8, // I64
    8, // F64
    4, // BYTES (size)
    4, // STRING (size)
    LITE3_NODE_SIZE - LITE3_VAL_SIZE, // OBJECT
    LITE3_NODE_SIZE - LITE3_VAL_SIZE, // ARRAY
    0  // INVALID
];

const LITE3_HASH_PROBE_MAX = 128;
const LITE3_TREE_HEIGHT_MAX = 9;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash >>> 0; // Ensure 32-bit unsigned
    }
    return hash;
}

class Lite3 {
    constructor(buffer) {
        if (buffer instanceof ArrayBuffer) {
            this.buffer = buffer;
        } else if (typeof buffer === 'number') {
            this.buffer = new ArrayBuffer(buffer);
        } else {
            throw new Error("Invalid buffer argument");
        }
        this.view = new DataView(this.buffer);
        this.u8 = new Uint8Array(this.buffer);
    }

    init_obj() {
        if (this.buffer.byteLength < LITE3_NODE_SIZE) throw new Error("Buffer too small");
        this._init_impl(0, LITE3_TYPE.OBJECT);
        return LITE3_NODE_SIZE;
    }

    init_arr() {
        if (this.buffer.byteLength < LITE3_NODE_SIZE) throw new Error("Buffer too small");
        this._init_impl(0, LITE3_TYPE.ARRAY);
        return LITE3_NODE_SIZE;
    }

    _init_impl(ofs, type) {
        this.view.setUint32(ofs, type & LITE3_NODE_TYPE_MASK, true); // gen_type
        // zero out hashes, size_kc, kv_ofs, child_ofs
        for (let i = 4; i < LITE3_NODE_SIZE; i += 4) {
            this.view.setUint32(ofs + i, 0, true);
        }
    }

    _verify_key(key, key_size, key_tag_size, inout_ofs) {
        let ofs = inout_ofs.val;
        let bufLen = this.buffer.byteLength;

        if (LITE3_KEY_TAG_SIZE_MAX > bufLen || ofs > bufLen - LITE3_KEY_TAG_SIZE_MAX) return -1;

        let tag_byte = this.u8[ofs];
        let _key_tag_size = (tag_byte & LITE3_KEY_TAG_SIZE_MASK) + 1;

        if (key_tag_size && key_tag_size !== _key_tag_size) return -1;

        let _key_size = 0;
        if (_key_tag_size === 1) _key_size = this.u8[ofs];
        else if (_key_tag_size === 2) _key_size = this.view.getUint16(ofs, true);
        else if (_key_tag_size === 3) {
             _key_size = this.u8[ofs] | (this.u8[ofs+1] << 8) | (this.u8[ofs+2] << 16);
        } else {
            _key_size = this.view.getUint32(ofs, true);
        }
        _key_size >>= LITE3_KEY_TAG_KEY_SIZE_SHIFT;

        ofs += _key_tag_size;

        if (_key_size > bufLen || ofs > bufLen - _key_size) return -1;

        ofs += _key_size;
        inout_ofs.val = ofs;
        return 0; // OK
    }

    _getKeyTagSize(keySize) {
        return (!!(keySize >> (16 - LITE3_KEY_TAG_KEY_SIZE_SHIFT)) << 1) +
               (!!(keySize >> (8 - LITE3_KEY_TAG_KEY_SIZE_SHIFT))) +
               (!!keySize);
    }

    set_null(buflen, ofs, bufsz, key) {
        return this._set_impl(buflen, ofs, bufsz, key, LITE3_TYPE.NULL, null);
    }

    set_bool(buflen, ofs, bufsz, key, value) {
        let valBuf = new Uint8Array(1);
        valBuf[0] = value ? 1 : 0;
        return this._set_impl(buflen, ofs, bufsz, key, LITE3_TYPE.BOOL, valBuf);
    }

    set_i64(buflen, ofs, bufsz, key, value) {
        let valBuf = new Uint8Array(8);
        let view = new DataView(valBuf.buffer);
        view.setBigInt64(0, BigInt(value), true);
        return this._set_impl(buflen, ofs, bufsz, key, LITE3_TYPE.I64, valBuf);
    }

    set_f64(buflen, ofs, bufsz, key, value) {
        let valBuf = new Uint8Array(8);
        let view = new DataView(valBuf.buffer);
        view.setFloat64(0, value, true);
        return this._set_impl(buflen, ofs, bufsz, key, LITE3_TYPE.F64, valBuf);
    }

    set_str(buflen, ofs, bufsz, key, value) {
        let strBytes = encoder.encode(value);
        let valBuf = new Uint8Array(4 + strBytes.length + 1);
        let view = new DataView(valBuf.buffer);
        view.setUint32(0, strBytes.length + 1, true); // Size includes null terminator
        valBuf.set(strBytes, 4);
        valBuf[4 + strBytes.length] = 0;

        return this._set_impl(buflen, ofs, bufsz, key, LITE3_TYPE.STRING, valBuf);
    }

    set_obj(buflen, ofs, bufsz, key) {
        // Create 95 bytes of zeros.
        // The node structure (96 bytes) starts with Type (1 byte).
        // _set_impl writes Type (1 byte) + valBytes (95 bytes).
        // valBytes corresponds to bytes 1..95 of the node.
        // Since a fresh node is Type + Zeros, we just need Zeros.
        let valBuf = new Uint8Array(LITE3_NODE_SIZE - 1);

        let res = this._set_impl(buflen, ofs, bufsz, key, LITE3_TYPE.OBJECT, valBuf);
        if (res !== 0) return null;

        return this.get_obj(buflen, ofs, key);
    }

    // Simplifed set implementation (no split support for basic implementation)
    // Supports appending to end if buffer allows.
    // buflen is an object { val: size } to be updated.
    _set_impl(buflen, ofs, bufsz, key, type, valBytes) {
        let keyBytes = encoder.encode(key);
        let keySize = keyBytes.length;
        let keyHash = djb2(key);
        let keyTagSize = this._getKeyTagSize(keySize);

        let valLen = LITE3_TYPE_SIZES[type];
        if (type === LITE3_TYPE.STRING || type === LITE3_TYPE.BYTES) {
            valLen += (valBytes.length - 4); // valBytes has 4 bytes size prefix
        }

        let baseEntrySize = keyTagSize + keySize + LITE3_VAL_SIZE + valLen;

        let node = ofs;

        // Check if key exists
        let oldKc = this.view.getUint32(node + LITE3_NODE_SIZE_KC_OFFSET, true) & LITE3_NODE_KEY_COUNT_MASK;
        let i = 0;
        while (i < oldKc) {
            let h = this.view.getUint32(node + 4 + i * 4, true);
            if (h < keyHash) i++;
            else break;
        }

        if (i < oldKc && this.view.getUint32(node + 4 + i * 4, true) === keyHash) {
            // Found existing key hash.
            // Simplified overwrite: just append new value if it fits?
            // For now, in basic implementation, we just append a NEW key. Overwriting existing keys not fully supported for variable length.
            // But let's assume user is building object.
             let kvOfs = this.view.getUint32(node + 36 + i * 4, true);
             // TODO: implement overwrite
        } else {
            // New key
            if (oldKc >= LITE3_NODE_KEY_COUNT_MAX) {
                throw new Error("Node full (splitting not implemented in basic JS version)");
            }

            // Insert at i
            // Shift
            for (let j = oldKc; j > i; j--) {
                // hashes
                this.view.setUint32(node + 4 + j * 4, this.view.getUint32(node + 4 + (j - 1) * 4, true), true);
                // kv_ofs
                this.view.setUint32(node + 36 + j * 4, this.view.getUint32(node + 36 + (j - 1) * 4, true), true);
            }

            this.view.setUint32(node + 4 + i * 4, keyHash, true);

            // Increment count
            let sizeKc = this.view.getUint32(node + LITE3_NODE_SIZE_KC_OFFSET, true);
            let kc = (sizeKc & LITE3_NODE_KEY_COUNT_MASK) + 1;
            let size = (sizeKc >>> LITE3_NODE_SIZE_SHIFT) + 1;

            sizeKc = (size << LITE3_NODE_SIZE_SHIFT) | kc;
            this.view.setUint32(node + LITE3_NODE_SIZE_KC_OFFSET, sizeKc, true);

            // Append data
            let newOfs = buflen.val;

            // Write Key Size Tag
            let keySizeTag = (keySize << LITE3_KEY_TAG_KEY_SIZE_SHIFT) | (keyTagSize - 1);
            if (keyTagSize === 1) this.u8[newOfs] = keySizeTag;
            else if (keyTagSize === 2) this.view.setUint16(newOfs, keySizeTag, true);
            else if (keyTagSize === 4) this.view.setUint32(newOfs, keySizeTag, true);

            newOfs += keyTagSize;

            // Write Key
            this.u8.set(keyBytes, newOfs);
            newOfs += keySize;

            // Write Val Type
            this.u8[newOfs] = type;
            newOfs += 1; // LITE3_VAL_SIZE

            // Write Val
            if (valBytes) {
                this.u8.set(valBytes, newOfs);
                newOfs += valBytes.length;
            }

            // Update node kv_ofs
            this.view.setUint32(node + 36 + i * 4, buflen.val, true);

            buflen.val = newOfs;
            return 0;
        }
        return -1;
    }

    get_str(buflen, ofs, key) {
        let res = this._get_impl(buflen, ofs, key);
        if (!res) return null;
        if (res.type !== LITE3_TYPE.STRING) return null;

        let view = new DataView(this.buffer, res.offset, 4);
        let len = view.getUint32(0, true);
        return decoder.decode(this.u8.subarray(res.offset + 4, res.offset + 4 + len - 1));
    }

    get_i64(buflen, ofs, key) {
        let res = this._get_impl(buflen, ofs, key);
        if (!res || res.type !== LITE3_TYPE.I64) return null;
        let view = new DataView(this.buffer, res.offset, 8);
        return Number(view.getBigInt64(0, true));
    }

    get_f64(buflen, ofs, key) {
        let res = this._get_impl(buflen, ofs, key);
        if (!res || res.type !== LITE3_TYPE.F64) return null;
        let view = new DataView(this.buffer, res.offset, 8);
        return view.getFloat64(0, true);
    }

    get_bool(buflen, ofs, key) {
        let res = this._get_impl(buflen, ofs, key);
        if (!res || res.type !== LITE3_TYPE.BOOL) return null;
        return this.u8[res.offset] !== 0;
    }

    get_obj(buflen, ofs, key) {
        let res = this._get_impl(buflen, ofs, key);
        if (!res || res.type !== LITE3_TYPE.OBJECT) return null;
        return res.offset - 1;
    }

    _get_impl(buflen, ofs, key) {
         let keyHash = djb2(key);
         let node = ofs;
         let kc = this.view.getUint32(node + LITE3_NODE_SIZE_KC_OFFSET, true) & LITE3_NODE_KEY_COUNT_MASK;
         let i = 0;
         while (i < kc) {
            let h = this.view.getUint32(node + 4 + i * 4, true);
            if (h < keyHash) i++;
            else break;
        }

        if (i < kc && this.view.getUint32(node + 4 + i * 4, true) === keyHash) {
             let kvOfs = this.view.getUint32(node + 36 + i * 4, true);
             // Verify key to be sure
             let kTag = this.u8[kvOfs];
             let kTagSize = (kTag & LITE3_KEY_TAG_SIZE_MASK) + 1;

             let kSize = 0;
             if (kTagSize === 1) kSize = this.u8[kvOfs];
             else if (kTagSize === 2) kSize = this.view.getUint16(kvOfs, true);
             else if (kTagSize === 4) kSize = this.view.getUint32(kvOfs, true);
             kSize >>= LITE3_KEY_TAG_KEY_SIZE_SHIFT;

             // Compare key
             let keyBytes = this.u8.subarray(kvOfs + kTagSize, kvOfs + kTagSize + kSize);
             let decodedKey = decoder.decode(keyBytes);
             if (decodedKey === key) {
                 let valType = this.u8[kvOfs + kTagSize + kSize];
                 let valOffset = kvOfs + kTagSize + kSize + 1;
                 return { type: valType, offset: valOffset };
             }
        }
        return null;
    }

    // JSON Print helper
    json_print(buflen, ofs) {
        let obj = this._to_json(buflen, ofs);
        console.log(JSON.stringify(obj, null, 4));
    }

    _to_json(buflen, ofs) {
        let type = this.view.getUint32(ofs, true) & LITE3_NODE_TYPE_MASK;
        if (type === LITE3_TYPE.OBJECT) {
            let res = {};
            this._iter(ofs, (key, valType, valOffset) => {
                res[key] = this._read_val(valType, valOffset);
            });
            return res;
        } else if (type === LITE3_TYPE.ARRAY) {
            let res = [];
             this._iter(ofs, (key, valType, valOffset) => {
                res.push(this._read_val(valType, valOffset));
            });
            return res;
        }
        return null;
    }

    _read_val(type, offset) {
        if (type === LITE3_TYPE.BOOL) return this.u8[offset] !== 0;
        if (type === LITE3_TYPE.I64) return Number(new DataView(this.buffer, offset, 8).getBigInt64(0, true));
        if (type === LITE3_TYPE.F64) return new DataView(this.buffer, offset, 8).getFloat64(0, true);
        if (type === LITE3_TYPE.STRING) {
            let len = new DataView(this.buffer, offset, 4).getUint32(0, true);
            return decoder.decode(this.u8.subarray(offset + 4, offset + 4 + len - 1));
        }
        if (type === LITE3_TYPE.OBJECT || type === LITE3_TYPE.ARRAY) {
             return this._to_json(null, offset - 1);
        }
        if (type === LITE3_TYPE.NULL) return null;
        return "UNKNOWN";
    }

    _iter(ofs, callback) {
        // Simple iterator (no child traversal for basic version)
         let kc = this.view.getUint32(ofs + LITE3_NODE_SIZE_KC_OFFSET, true) & LITE3_NODE_KEY_COUNT_MASK;
         for(let i=0; i<kc; i++) {
             let kvOfs = this.view.getUint32(ofs + 36 + i * 4, true);

             let kTag = this.u8[kvOfs];
             let kTagSize = (kTag & LITE3_KEY_TAG_SIZE_MASK) + 1;
             let kSize = 0;
             if (kTagSize === 1) kSize = this.u8[kvOfs];
             else if (kTagSize === 2) kSize = this.view.getUint16(kvOfs, true);
             else if (kTagSize === 4) kSize = this.view.getUint32(kvOfs, true);
             kSize >>= LITE3_KEY_TAG_KEY_SIZE_SHIFT;

             let key = decoder.decode(this.u8.subarray(kvOfs + kTagSize, kvOfs + kTagSize + kSize));
             let valType = this.u8[kvOfs + kTagSize + kSize];
             let valOffset = kvOfs + kTagSize + kSize + 1;

             callback(key, valType, valOffset);
         }
    }

}

module.exports = Lite3;
