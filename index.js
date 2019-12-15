const _ = require("lodash");

/**
 * Defines different types of fields and their operations (internal use)
 */
const fieldTypes = {
    array: {
        create: fieldDefinition => {
            // FROM: https://stackoverflow.com/a/12588826/6099426
            return (function getRecursively(dimensions) {
                if (dimensions.length > 0) {
                    var dim = dimensions[0];
                    var rest = dimensions.slice(1);
                    var newArray = new Array();
                    for (var i = 0; i < dim; i++) {
                        newArray[i] = getRecursively(rest);
                    }
                    return newArray;
                } else {
                    return [];
                }
            })(fieldDefinition.dimensions);
        },
        access: function(fieldDefinition, fieldData, coords) {
            if (coords.length == 1) return fieldData[coords[0]];
            else
                return arguments.callee(
                    fieldDefinition,
                    fieldData[coords[0]],
                    _.tail(coords)
                );
        },
        getAllTokens: function(fieldDefinition, fieldData) {
            return _.flattenDepth(
                fieldData,
                fieldDefinition.dimensions.length + 1
            );
        },
        validCoords: function(fieldDefinition, coords) {
            return _.every(
                coords,
                (coord, i) =>
                    coord >= 0 && coord < fieldDefinition.dimensions[i]
            );
        },
        getAllCoords: function(fieldDefinition) {
            // https://stackoverflow.com/a/12628791
            function cartesianProductOf() {
                return _.reduce(
                    arguments,
                    function(a, b) {
                        return _.flatten(
                            _.map(a, function(x) {
                                return _.map(b, function(y) {
                                    return x.concat([y]);
                                });
                            }),
                            true
                        );
                    },
                    [[]]
                );
            }

            return cartesianProductOf(
                ...fieldDefinition.dimensions.map(_.range)
            );
        }
    },
    single: {
        create: () => [],
        access: (fieldDefinition, fieldData) => fieldData,
        getAllTokens: (fieldDefinition, fieldData) => fieldData,
        validCoords: (fieldDefinition, coords) => coords == null,
        getAllCoords: () => [null]
    }
};

function createField(fieldDefinition) {
    return fieldTypes[fieldDefinition.type].create(fieldDefinition);
}

function accessField(fieldDefinition, fieldData, coords) {
    return fieldTypes[fieldDefinition.type].access(
        fieldDefinition,
        fieldData,
        coords
    );
}

function getAllTokensField(fieldDefinition, fieldData) {
    return fieldTypes[fieldDefinition.type].getAllTokens(
        fieldDefinition,
        fieldData
    );
}

function validCoords(fieldDefinition, coords) {
    return fieldTypes[fieldDefinition.type].validCoords(
        fieldDefinition,
        coords
    );
}

/**
 * GameManager is the main entry point
 */
module.exports.GameManager = class GameManager {
    constructor(gameInfo, tokenDefinitions, ruleDefinitions) {
        this.gameInfo = gameInfo;
        this.globalState = {};
        this.state = {};

        this._loadTokens(tokenDefinitions);
        this._loadRules(ruleDefinitions);
    }

    /**
     * Starts the first rule run
     */
    start() {
        this._changeState({ name: "!initial" });
    }

    /**
     * Gets the root token
     */
    root() {
        return this._getToken(0);
    }

    /**
     * Returns Choice instances for all the possible moves for this state
     */
    getChoices() {
        return this._addChoicesOps.map(
            op => new Choice(this, op, this._filterChoicesOps)
        );
    }

    /**
     * After a Choice object is complete, applies it
     */
    performMove(move) {
        this._applyRules(this._rules.choice, move);
    }

    /**
     * Call a callable rule
     */
    callRule(callName, ...args) {
        return this._runRules(
            this._rules.call.filter(rule => rule.callName == callName),
            ...args
        );
    }

    // PRIVATE:

    _getToken(id) {
        return this._tokenList[id];
    }

    _loadTokens(tokenDefinitions) {
        this._tokenDefinitions = tokenDefinitions;

        const rootDefinition = {
            fields: {
                "!table": { type: "single" },
                "!box": { type: "single" }
            },
            props: {
                name: "!root"
            }
        };

        this._tokenList = [new Token(this, null, 0, rootDefinition)];
        const root = this.root();

        let idCounter = 1;
        for (let tokenDefinition of tokenDefinitions) {
            for (let i = 0; i < (tokenDefinition.count || 1); i++) {
                const newToken = new Token(
                    this,
                    { id: idCounter, field: "!box", coords: null },
                    idCounter,
                    tokenDefinition
                );
                this._tokenList.push(newToken);
                root._addChild(newToken, "!box");
                idCounter++;
            }
        }
    }

    _loadRules(ruleDefinitions) {
        this._ruleDefinitions = ruleDefinitions;
        this._rules = {};
        this._rules.entry = ruleDefinitions.filter(rule => rule.on == "entry");
        this._rules.choice = ruleDefinitions.filter(
            rule => rule.on == "choice"
        );
        this._rules.call = ruleDefinitions.filter(rule => rule.on == "call");
    }

    _changeState(state) {
        this.state = state;
        this._applyRules(this._rules.entry);
    }

    _applyRules(rules, ...args) {
        const ops = _.flatten(this._runRules(rules, ...args));
        const changeStateOps = ops.filter(op => op.type == "changeState");

        if (changeStateOps.length > 0)
            return this._changeState(changeStateOps[0].newState);

        this._filterChoicesOps = ops.filter(op => op.type == "filterChoices");
        this._addChoicesOps = _(ops)
            .filter(op => op.type == "addChoices")
            .uniqBy(op => op.name)
            .value();
    }

    _runRules(rules, ...args) {
        return _(rules)
            .filter(
                rule =>
                    (!rule.stateName || rule.stateName == this.state.name) &&
                    (!rule.pred || rule.pred(this, ...args))
            )
            .reverse() // later rules take precedence
            .uniqBy(rule => rule.name)
            .map(rule => rule.fn(this, ...args))
            .compact()
            .value();
    }
};

class Token {
    /**
     * Matches the token's props against the pattern.
     * If pattern is a function, use it as a predicate.
     * If pattern is a string, match this.props.name
     * If pattern is an object, test for inclusion
     */
    matchesPattern(pattern) {
        if (!pattern) return true;

        if (typeof pattern === "function") return pattern(this.props);

        if (typeof pattern === "string") pattern = { name: pattern };

        return _.isMatch(this.props, pattern);
    }

    /**
     * Moves the token to the end of the specified field on the specified token
     */
    moveTo(token, field, coords = null) {
        if (!token || !field) throw new Error("Must provide token and field");

        const parentToken = this._manager._getToken(this._parent.id);
        parentToken._removeChild(this);
        token._addChild(this, field, coords);
    }

    /**
     * Returns an array of all the tokens matching pattern according to matchesPattern
     * anywhere in the subtree. A field and coords may be specified to narrow the search
     */
    findAllTokens(pattern = null, field = null, coords = null) {
        const found = [];

        const fieldsToSearch =
            field === null ? Object.keys(this._fieldData) : [field];
        for (let fieldName of fieldsToSearch) {
            const tokenIdsUnder =
                coords === null
                    ? getAllTokensField(
                          this._definition.fields[fieldName],
                          this._fieldData[fieldName]
                      )
                    : accessField(
                          this._definition.fields[fieldName],
                          this._fieldData[fieldName],
                          coords
                      );
            const tokensUnder = tokenIdsUnder.map(id =>
                this._manager._getToken(id)
            );
            found.push(
                ...tokensUnder.filter(token => token.matchesPattern(pattern))
            );
            found.push(
                ..._.flatten(
                    tokensUnder.map(token => token.findAllTokens(pattern))
                )
            );
        }

        return found;
    }

    /**
     * Like findAllTokens, but returns just the first match
     */
    findToken(pattern = null, field = null, coords = null) {
        return this.findAllTokens(pattern, field, coords)[0];
    }

    /**
     * Returns all immediate children of this token in the specified field
     */
    children(field, coords = null) {
        return this._childrenIds(field, coords).map(id =>
            this._manager._getToken(id)
        );
    }

    /**
     * Returns the coordinates part of the field this is located at
     */
    coords() {
        return this._parent.coords;
    }

    /**
     * Returns the name part of the field this is located at
     */
    parentField() {
        return this._parent.field;
    }

    /**
     * Returns the parent token
     */
    parentToken() {
        return this._manager._getToken(this._parent.id);
    }

    /**
     * Checks if fieldName+coords form a valid field
     */
    validCoords(field, coords) {
        return validCoords(this._definition.fields[field], coords);
    }

    /**
     * Returns the index of this token amongst all tokens located on the same field
     */
    order() {
        return this.parentToken()
            .childrenIds(this.parentField(), this.coords())
            .indexOf(this.id);
    }

    /**
     * Moves this token to a different index amongst all tokens located on the same field
     */
    reorder(index) {
        const arr = this.parentToken()._childrenIds(
            this.parentField(),
            this.coords()
        );
        if (index < 0) index += arr.length;
        arr.splice(this.order(), 1);
        arr.splice(index, 0, this.id);
    }

    /**
     * Shuffles the order of all tokens of a specified field
     */
    shuffleField(field, coords = null) {
        const arr = this._childrenIds(field, coords);
        arr.splice(0, arr.length, ..._.shuffle(arr));
    }

    /**
     * Searches up the tree for props.owner field
     * If not found, returns null
     */
    owner() {
        if (this.id == 0) return null;
        if (typeof this.props.owner !== "undefined") return this.props.owner;
        return this.parentToken().owner();
    }

    // PRIVATE:

    constructor(manager, parent, id, definition) {
        this._manager = manager;
        this._parent = parent;
        this.id = id;
        this._definition = definition;

        this.props = _.clone(this._definition.props);

        this._fieldData = {};
        for (let fieldName in this._definition.fields) {
            this._fieldData[fieldName] = createField(
                this._definition.fields[fieldName]
            );
        }
    }

    _addChild(token, field, coords) {
        accessField(
            this._definition.fields[field],
            this._fieldData[field],
            coords
        ).push(token.id);
        token._parent = { id: this.id, field: field, coords: coords };
    }

    _removeChild(token) {
        const fieldArray = accessField(
            this._definition.fields[token._parent.field],
            this._fieldData[token._parent.field],
            token._parent.coords
        );
        fieldArray.splice(fieldArray.indexOf(token.id), 1);
    }

    _childrenIds(field, coords = null) {
        return accessField(
            this._definition.fields[field],
            this._fieldData[field],
            coords
        );
    }
}

/**
 * Choice object represents moves player can choose from
 * Multiple Choice objects may be returned, each representing a different set of choices
 */
class Choice {
    /**
     * Returns an object {name, values} with the name (string) and possible values
     * of a param. One of the values needs to be assigned to this.params[name]
     */
    nextChoice() {
        if (this.complete()) return null;

        const choiceName = _.difference(
            Object.keys(this._choices),
            Object.keys(this.params)
        )[0];
        const choiceValues = this._getChoiceValues(choiceName);

        return {
            name: choiceName,
            values: choiceValues
        };
    }

    /**
     * Tests if all choices were made
     */
    complete() {
        return Object.keys(this._choices).every(key =>
            Object.keys(this.params).includes(key)
        );
    }

    /**
     * Tests if all choices that were made are from the correct set
     */
    valid() {
        return _(this.params)
            .keys()
            .every(
                key =>
                    !_.has(this._choices, key) ||
                    (this._choices[key](this).includes(this.params[key]) &&
                        this._filterChoicesOps.every(
                            f =>
                                f.name !== this.name ||
                                !f.requiredParams.every(requiredParam =>
                                    _.has(this.params, requiredParam)
                                ) ||
                                f.pred(this)
                        ))
            );
    }

    // PRIVATE

    constructor(manager, moveDefinition, filterChoicesOps) {
        this._manager = manager;

        this.name = moveDefinition.name;
        this.player = moveDefinition.player;
        this._choices = moveDefinition.choices || {};
        this.params = moveDefinition.params || {};

        this._filterChoicesOps = filterChoicesOps;
    }

    _getChoiceValues(choiceName) {
        return this._choices[choiceName](this).filter(choiceValue => {
            this.params[choiceName] = choiceValue;
            const valid = this.valid();
            delete this.params[choiceName];
            return valid;
        });
    }
}
