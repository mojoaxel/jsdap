var parser = {};

(function() {
    'use strict';

    var ATOMIC_TYPES = ['byte', 'int', 'uint', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string', 'url', 'alias'];
    var STRUCTURED_TYPES = ['Sequence', 'Structure', 'Dataset'];

    //Regular expressions
    //DDS parsing expressions
    var DDS_BASE_TYPE_DIMENSION_NAME_EXPRESSION = '\\w+';
    var DDS_BASE_TYPE_DIMENSION_VALUE_EXPRESSION = '\\d+';
    var DDS_BASE_TYPE_EXPRESSION = '\\w+';
    var DDS_BASE_TYPE_NAME_EXPRESSION = '\\w+'; //Type name ends with a square bracket
    var DDS_DATASET_ID_EXPRESSION = '[^;]+';
    var DDS_GRID_NAME_EXPRESSION = '\\w+';
    var DDS_SEQUENCE_NAME_EXPRESSION = '\\w+';
    var DDS_STRUCTURE_NAME_EXPRESSION = '\\w+';

    //DAS parsing expressions
    var DAS_ALIAS_EXPRESSION = '".*?[^\\\\]"|[^;,]+';
    var DAS_ATTRIBUTE_TYPE_EXPRESSION = '\\w+';
    var DAS_ATTRIBUTE_NAME_EXPRESSION = '\\S+'; //Ends with whitespace?
    var DAS_CONTAINER_NAME_EXPRESSION = '[\\w_\\.]+';
    var DAS_METADATA_NAME_EXPRESSION = '\\w+';
    var DAS_NUMERICAL_EXPRESSION = '".*?[^\\\\]"|[^;,]+';
    var DAS_STRING_EXPRESSION = '"([^"]|\\")*"'; //Ends with a double quote
    var DAS_TYPE_EXPRESSION = '\\w+';
    var DAS_URL_EXPRESSION = '".*?[^\\\\]"|[^;,]+';

    Array.prototype.contains = function (item) {
        for (var i = 0, el = this[i]; i < this.length; el = this[++i]) {
            if (item === el) return true;
        }
        return false;
    };

    String.prototype.trim = function() {
        return this.replace(/^\s+|\s+$/g, '');
    };

    String.prototype.ltrim = function() {
        return this.replace(/^[\s\n\r\t]+/, '');
    };

    String.prototype.rtrim = function() {
        return this.replace(/\s+$/, '');
    };

    function pseudoSafeEval(str) {
        return eval('(' + str + ')');
    }

    //TODO: Should this be private?
    parser.dapType = function(type) {
        this.type = type;
        this.attributes = {};
    };

    function simpleParser(input) {
        this.stream = input;

        this.peek = function(expr) {
            var regExp = new RegExp('^' + expr, 'i');
            var m = this.stream.match(regExp);
            if (m) {
                return m[0];
            }
            else {
                return '';
            }
        };

        this.consume = function(expr) {
            var regExp = new RegExp('^' + expr, 'i');
            var m = this.stream.match(regExp);
            if (m) {
                this.stream = this.stream.substr(m[0].length).ltrim();
                return m[0];
            }
            else {
                throw new Error('Unable to parse stream: ' + this.stream.substr(0, 10));
            }
        };
    }

    parser.ddsParser = function(dds) {
        this.stream = this.dds = dds;

        this._dataset = function() {
            var dataset = new parser.dapType('Dataset');

            this.consume('dataset');
            this.consume('{');
            while (!this.peek('}')) {
                var declaration = this._declaration();
                dataset[declaration.name] = declaration;
            }
            this.consume('}');

            dataset.id = dataset.name = this.consume(DDS_DATASET_ID_EXPRESSION);
            this.consume(';');

            // Set id.
            function walk(dapvar, includeParent) {
                for (var attr in dapvar) {
                    var child = dapvar[attr];
                    if (child.type) {
                        child.id = child.name;
                        if (includeParent) {
                            child.id = dapvar.id + '.' + child.id;
                        }
                        walk(child, true);
                    }
                }
            }
            walk(dataset, false);

            return dataset;
        };
        this.parse = this._dataset;

        this._declaration = function() {
            var type = this.peek(DDS_BASE_TYPE_EXPRESSION).toLowerCase();
            switch (type) {
                case 'grid'     : return this._grid();
                case 'structure': return this._structure();
                case 'sequence' : return this._sequence();
                default         : return this._base_declaration();
            }
        };

        this._base_declaration = function() {
            var baseType = new parser.dapType();

            baseType.type = this.consume(DDS_BASE_TYPE_EXPRESSION);
            baseType.name = this.consume(DDS_BASE_TYPE_NAME_EXPRESSION);

            baseType.dimensions = [];
            baseType.shape = [];
            while (!this.peek(';')) {
                this.consume('\\[');
                var token = this.consume(DDS_BASE_TYPE_DIMENSION_NAME_EXPRESSION);
                if (this.peek('=')) {
                    baseType.dimensions.push(token);
                    this.consume('=');
                    token = this.consume(DDS_BASE_TYPE_DIMENSION_VALUE_EXPRESSION);
                }
                baseType.shape.push(parseInt(token));
                this.consume('\\]');
            }
            this.consume(';');

            return baseType;
        };

        this._grid = function() {
            var grid = new parser.dapType('Grid');

            this.consume('grid');
            this.consume('{');

            this.consume('array');
            this.consume(':');
            grid.array = this._base_declaration();

            this.consume('maps');
            this.consume(':');
            grid.maps = {};
            while (!this.peek('}')) {
                var map_ = this._base_declaration();
                grid.maps[map_.name] = map_;
            }
            this.consume('}');

            grid.name = this.consume(DDS_GRID_NAME_EXPRESSION);
            this.consume(';');

            return grid;
        };

        this._sequence = function() {
            var sequence = new parser.dapType('Sequence');

            this.consume('sequence');
            this.consume('{');
            while (!this.peek('}')) {
                var declaration = this._declaration();
                sequence[declaration.name] = declaration;
            }
            this.consume('}');

            sequence.name = this.consume(DDS_SEQUENCE_NAME_EXPRESSION);
            this.consume(';');

            return sequence;
        };

        this._structure = function() {
            var structure = new parser.dapType('Structure');

            this.consume('structure');
            this.consume('{');
            while (!this.peek('}')) {
                var declaration = this._declaration();
                structure[declaration.name] = declaration;
            }
            this.consume('}');

            structure.name = this.consume(DDS_STRUCTURE_NAME_EXPRESSION);
            this.consume(';');

            return structure;
        };
    };
    parser.ddsParser.prototype = new simpleParser;


    parser.dasParser = function(das, dataset) {
        this.stream = this.das = das;
        this.dataset = dataset;

        this.parse = function() {
            this._target = this.dataset;

            this.consume('attributes');
            this.consume('{');
            while (!this.peek('}')) {
                this._attr_container();
            }
            this.consume('}');

            return this.dataset;
        };

        this._attr_container = function() {
            if (ATOMIC_TYPES.contains(this.peek(DAS_TYPE_EXPRESSION).toLowerCase())) {
                this._attribute(this._target.attributes);

                if (this._target.type === 'Grid') {
                    for (map in this._target.maps) {
                        if (this.dataset[map]) {
                            var map = this._target.maps[map];
                            for (var name in map.attributes) {
                                this.dataset[map].attributes[name] = map.attributes[name];
                            }
                        }
                    }
                }
            } else {
                this._container();
            }
        };

        this._container = function() {
            var name = this.consume(DAS_CONTAINER_NAME_EXPRESSION);
            this.consume('{');

            var target;

            if (name.indexOf('.') > -1) {
                var names = name.split('.');
                target = this._target;
                for (var i=0; i<names.length; i++) {
                    this._target = this._target[names[i]];
                }

                while (!this.peek('}')) {
                    this._attr_container();
                }
                this.consume('}');

                this._target = target;
            }
            else if ((STRUCTURED_TYPES.contains(this._target.type)) && (this._target[name])) {
                target = this._target;
                this._target = target[name];

                while (!this.peek('}')) {
                    this._attr_container();
                }
                this.consume('}');

                this._target = target;
            }
            else {
                this._target.attributes[name] = this._metadata();
                this.consume('}');
            }
        };

        this._metadata = function() {
            var output = {};
            while (!this.peek('}')) {
                if (ATOMIC_TYPES.contains(this.peek(DAS_TYPE_EXPRESSION).toLowerCase())) {
                    this._attribute(output);
                }
                else {
                    var name = this.consume(DAS_METADATA_NAME_EXPRESSION);
                    this.consume('{');
                    output[name] = this._metadata();
                    this.consume('}');
                }
            }
            return output;
        };

        this._attribute = function(object) {
            var type = this.consume(DAS_ATTRIBUTE_TYPE_EXPRESSION);
            var name = this.consume(DAS_ATTRIBUTE_NAME_EXPRESSION);

            var value;
            var values = [];

            while (!this.peek(';')) {
                if (type.toLowerCase() === 'string') {
                    value = this.consume(DAS_STRING_EXPRESSION);
                }
                else if (type.toLowerCase() === 'url') {
                    value = this.consume(DAS_URL_EXPRESSION);
                }
                else if (type.toLowerCase() === 'alias') {
                    var target, tokens;

                    value = this.consume(DAS_ALIAS_EXPRESSION);

                    if (value.match(/^\\./)) {
                        tokens = value.substring(1).split('.');
                        target = this.dataset;
                    }
                    else {
                        tokens = value.split('.');
                        target = this._target;
                    }

                    for (var i=0; i<tokens.length; i++) {
                        var token = tokens[i];
                        if (target[token]) {
                            target = target[token];
                        }
                        else if (target.array.name === token) {
                            target = target.array;
                        }
                        else if (target.maps[token]) {
                            target = target.maps[token];
                        }
                        else {
                            target = target.attributes[token];
                        }
                        value = target;
                    }
                }
                else {
                    value = this.consume(DAS_NUMERICAL_EXPRESSION);

                    if (value.toLowerCase() === 'nan') {
                        value = NaN;
                    }
                    else {
                        value = pseudoSafeEval(value);
                    }
                }

                values.push(value);

                if (this.peek(',')) {
                    this.consume(',');
                }
            }
            this.consume(';');

            if (values.length === 1) {
                values = values[0];
            }

            object[name] = values;
        };
    };
    parser.dasParser.prototype = new simpleParser;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = parser;
    }
})();
