var xdr = {};

(function() {
    'use strict';

    var END_OF_SEQUENCE = '\xa5\x00\x00\x00';
    var START_OF_SEQUENCE = '\x5a\x00\x00\x00';

    xdr.dapUnpacker = function(xdrdata, dapvar) {
        this._buf = xdrdata;
        this._view = new DataView(this._buf); //Get a view into the ArrayBuffer

        this.dapvar = dapvar;

        this._pos = 0; //Byte offset

        this.getValue = function() {
            var type = this.dapvar.type.toLowerCase();

            if (type === 'structure' || type === 'dataset') {
                return this._parse_structure();
            }
            else if (type === 'grid') {
                return this._parse_grid();
            }
            else if (type === 'sequence') {
                return this._parse_sequence();
            }
            else if (this._buf.slice(this._pos, this._pos + 4) === START_OF_SEQUENCE) {
                return this._parse_base_type_sequence();
            }
            else {
                return this._parse_base_type(type);
            }
        };

        this._parse_structure = function() {
            var out = [];
            var tmp;

            var dapvar = this.dapvar;

            for (var child in dapvar) {
                if (dapvar[child].type) {
                    this.dapvar = dapvar[child];
                    tmp = this.getValue();
                    out.push(tmp);
                }
            }

            this.dapvar = dapvar;

            return out;
        };

        this._parse_grid = function() {
            var out = [];
            var tmp;

            var dapvar = this.dapvar;

            this.dapvar = dapvar.array;

            tmp = this.getValue();
            out.push(tmp);

            for (var map in dapvar.maps) {
                if (dapvar.maps[map].type) {
                    this.dapvar = dapvar.maps[map];
                    tmp = this.getValue();
                    out.push(tmp);
                }
            }

            this.dapvar = dapvar;

            return out;
        };

        this._parse_sequence = function() {
            var out = [];
            var tmp;

            var mark = this._unpack_uint32();

            var dapvar = this.dapvar;

            while (mark !== 2768240640) {
                var struct = [];

                for (var child in dapvar) {
                    if (dapvar[child].type) {
                        this.dapvar = dapvar[child];
                        tmp = this.getValue();
                        struct.push(tmp);
                    }
                }

                out.push(struct);
                mark = this._unpack_uint32();
            }

            this.dapvar = dapvar;

            return out;
        };

        this._parse_base_type_sequence = function() {
            // This is a request for a base type variable inside a sequence.
            var out = [];
            var tmp;

            var mark = this._unpack_uint32();

            while (mark !== 2768240640) {
                tmp = this.getValue();
                out.push(tmp);
                mark = this._unpack_uint32();
            }

            return out;
        };

        this._parse_base_type = function(type) {
            //Numeric or string type
            var out = [];

            var n = 1;

            if (this.dapvar.shape.length) {
                n = this._unpack_uint32();

                if (type !== 'url' && type !== 'string') {
                    this._unpack_uint32(); //Throw away a start?
                }
            }

            if (type === 'byte') {
                out = this._unpack_bytes(n);
            }
            else if (type === 'url' || type === 'string') {
                out = this._unpack_string(n);
            }
            else {
                out = [];

                var func;

                switch (type) {
                    case 'float32': func = '_unpack_float32'; break;
                    case 'float64': func = '_unpack_float64'; break;
                    case 'int'    : func = '_unpack_int32'; break;
                    case 'uint'   : func = '_unpack_uint32'; break;
                    case 'int16'  : func = '_unpack_int16'; break;
                    case 'uint16' : func = '_unpack_uint16'; break;
                    case 'int32'  : func = '_unpack_int32'; break;
                    case 'uint32' : func = '_unpack_uint32'; break;
                }

                for (var i=0; i<n; i++) {
                    out.push(this[func]());
                }
            }

            if (this.dapvar.shape) {
                out = reshape(out, this.dapvar.shape);
            }
            else {
                out = out[0];
            }

            return out;
        };

        this._unpack_byte = function() {
            var startPos = this._pos;
            this._pos += 1; //Increment the byte counter

            return this._view.getUint8(startPos);
        };

        this._unpack_uint16 = function() {
            var startPos = this._pos;
            this._pos += 2; //Increment the byte counter

            return this._view.getUint16(startPos);
        };

        this._unpack_uint32 = function() {
            var startPos = this._pos;
            this._pos += 4; //Increment the byte counter

            return this._view.getUint32(startPos);
        };

        this._unpack_int16 = function() {
            var startPos = this._pos;
            this._pos += 2; //Increment the byte counter

            return this._view.getInt16(startPos);
        };

        this._unpack_int32 = function() {
            var startPos = this._pos;
            this._pos += 4; //Increment the byte counter

            return this._view.getInt32(startPos);
        };

        this._unpack_float32 = function() {
            var startPos = this._pos;
            this._pos += 4; //Increment the byte counter

            return this._view.getFloat32(startPos);
        };

        this._unpack_float64 = function() {
            var startPos = this._pos;
            this._pos += 8; //Increment the byte counter

            return this._view.getFloat64(startPos);
        };

        this._unpack_bytes = function(count) {
            var padding = (4 - (count % 4)) % 4;
            var bytes = [];

            for (var c=0; c<count; c++) {
                bytes.push(this._unpack_byte());
            }

            this._pos += padding;

            return bytes;
        };

        this._unpack_string = function(count) {
            var strings = [];

            for (var c=0; c<count; c++) {
                var n = this._unpack_uint32(); //Length of the string
                var padding = (4 - (n % 4)) % 4;

                var str = '';

                for (var s=0; s<n; s++) {
                    str += String.fromCharCode(this._unpack_byte());
                }

                strings.push(str);

                this._pos += padding;
            }

            return strings;
        };
    };

    var reshape = function(array, shape) {
        if (!shape.length) return array[0];
        var out = [];
        var size, start, stop;

        for (var i=0; i<shape[0]; i++) {
            size = array.length / shape[0];
            start = i * size;
            stop = start + size;
            out.push(reshape(array.slice(start, stop), shape.slice(1)));
        }

        return out;
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = xdr;
    }
})();
