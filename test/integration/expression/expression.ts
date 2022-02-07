import path, {dirname} from 'path';
import {diffJson} from 'diff';
import fs from 'fs';
import harness from '../lib/harness';
import compactStringify from 'json-stringify-pretty-compact';
import {fileURLToPath} from 'url';

// @ts-ignore
const __dirname = dirname(fileURLToPath(import.meta.url));

// we have to handle this edge case here because we have test fixtures for this
// edge case, and we don't want UPDATE=1 to mess with them
function stringify(v) {
    let s = compactStringify(v);
    // http://timelessrepo.com/json-isnt-a-javascript-subset
    if (s.indexOf('\u2028') >= 0) {
        s = s.replace(/\u2028/g, '\\u2028');
    }
    if (s.indexOf('\u2029') >= 0) {
        s = s.replace(/\u2029/g, '\\u2029');
    }
    return s;
}

const decimalSigFigs = 6;

function stripPrecision(x) {
    // Intended for test output serialization:
    // strips down to 6 decimal sigfigs but stops at decimal point
    if (typeof x === 'number') {
        if (x === 0) { return x; }

        const multiplier = Math.pow(10,
            Math.max(0,
                decimalSigFigs - Math.ceil(Math.log10(Math.abs(x)))));

        // We strip precision twice in a row here to avoid cases where
        // stripping an already stripped number will modify its value
        // due to bad floating point precision luck
        // eg `Math.floor(8.16598 * 100000) / 100000` -> 8.16597
        const firstStrip = Math.floor(x * multiplier) / multiplier;
        return Math.floor(firstStrip * multiplier) / multiplier;
    } else if (typeof x !== 'object') {
        return x;
    } else if (Array.isArray(x)) {
        return x.map(stripPrecision);
    } else {
        const stripped = {};
        for (const key of Object.keys(x)) {
            stripped[key] = stripPrecision(x[key]);
        }
        return stripped;
    }
}

function deepEqual(a, b) {
    if (typeof a !== typeof b)
        return false;
    if (typeof a === 'number') {
        return stripPrecision(a) === stripPrecision(b);
    }
    if (a === null || b === null || typeof a !== 'object')
        return a === b;

    const ka = Object.keys(a);
    const kb = Object.keys(b);

    if (ka.length !== kb.length)
        return false;

    ka.sort();
    kb.sort();

    for (let i = 0; i < ka.length; i++)
        if (ka[i] !== kb[i] || !deepEqual(a[ka[i]], b[ka[i]]))
            return false;

    return true;
}

/**
 * Run the expression suite.
 *
 * @param implementation - identify the implementation under test; used to
 * deal with implementation-specific test exclusions and fudge-factors
 * @param options
 * @param options.tests - array of test names to run; tests not in the array will be skipped
 * @param options.ignores - array of test names to ignore.
 * @param runExpressionTest - a function that runs a single expression test fixture
 * @returns terminates the process when testing is complete
 */
export function run(implementation: string, options: {
    tests?: any; ignores?: any; fixtureFilename?: any;
}, runExpressionTest) {
    const directory = path.join(__dirname);
    options.fixtureFilename = 'test.json';
    harness(directory, implementation, options, (fixture, params, done) => {
        try {
            const result = runExpressionTest(fixture, params);
            const dir = path.join(directory, params.id);

            if (process.env.UPDATE) {
                fixture.expected = {
                    compiled: result.compiled,
                    outputs: stripPrecision(result.outputs),
                    serialized: result.serialized
                };

                delete fixture.metadata;

                fs.writeFile(path.join(dir, 'test.json'), `${stringify(fixture)}\n`, done);
                return;
            }

            const expected = fixture.expected;
            const compileOk = deepEqual(result.compiled, expected.compiled);
            const evalOk = compileOk && deepEqual(result.outputs, expected.outputs);

            let recompileOk = true;
            let roundTripOk = true;
            let serializationOk = true;
            if (expected.compiled.result !== 'error') {
                serializationOk = compileOk && deepEqual(expected.serialized, result.serialized);
                recompileOk = compileOk && deepEqual(result.recompiled, expected.compiled);
                roundTripOk = recompileOk && deepEqual(result.roundTripOutputs, expected.outputs);
            }

            params.ok = compileOk && evalOk && recompileOk && roundTripOk && serializationOk;

            const diffOutput = {
                text: '',
                html: ''
            };

            const diffJsonWrap = (label, expectedJson, actualJson) => {
                let text = '';
                let html = '';
                diffJson(expectedJson, actualJson)
                    .forEach((hunk) => {
                        if (hunk.added) {
                            text += `+ ${hunk.value}`;
                            html += `<ins>  ${hunk.value}</ins>`;
                        } else if (hunk.removed) {
                            text += `- ${hunk.value}`;
                            html += `<del>  ${hunk.value}</del>`;
                        } else {
                            text += `  ${hunk.value}`;
                            html += `<span>  ${hunk.value}</span>`;
                        }
                    });
                if (text) {
                    diffOutput.text += `${label}\n${text}`;
                    diffOutput.html += `<h3>${label}</h3>\n${html}`;
                }
            };

            if (!compileOk) {
                diffJsonWrap('Compiled', expected.compiled, result.compiled);
            }
            if (compileOk && !serializationOk) {
                diffJsonWrap('Serialized', expected.serialized, result.serialized);
            }
            if (compileOk && !recompileOk) {
                diffJsonWrap('Serialized and re-compiled', expected.compiled, result.recompiled);
            }

            const diffOutputs = (testOutputs) => {
                return expected.outputs.map((expectedOutput, i) => {
                    if (!deepEqual(expectedOutput, testOutputs[i])) {
                        return `f(${JSON.stringify(fixture.inputs[i])})\nExpected: ${JSON.stringify(expectedOutput)}\nActual: ${JSON.stringify(testOutputs[i])}`;
                    }
                    return false;
                })
                    .filter(Boolean)
                    .join('\n');
            };

            if (compileOk && !evalOk) {
                const differences = `Original\n${diffOutputs(result.outputs)}\n`;
                diffOutput.text += differences;
                diffOutput.html += differences;
            }
            if (recompileOk && !roundTripOk) {
                const differences = `\nRoundtripped through serialize()\n${diffOutputs(result.roundTripOutputs)}\n`;
                diffOutput.text += differences;
                diffOutput.html += differences;
            }

            params.difference = diffOutput.html;
            if (diffOutput.text) { console.log(diffOutput.text); }

            params.expression = compactStringify(fixture.expression);
            params.serialized = compactStringify(result.serialized);

            done();
        } catch (e) {
            done(e);
        }
    });
}