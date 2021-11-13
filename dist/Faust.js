"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const FaustDsp_1 = require("./FaustDsp");
const crypto_1 = require("crypto");
class Faust {
    constructor(libFaust) {
        this.libFaust = libFaust;
        this.importLibFaustFunctions();
        this.version = this.getLibFaustVersion();
    }
    importLibFaustFunctions() {
        if (!this.libFaust)
            return;
        // Low-level API
        this.createWasmCDSPFactoryFromString = this.libFaust.cwrap("createWasmCDSPFactoryFromString", "number", ["number", "number", "number", "number", "number", "number"]);
        this.deleteAllWasmCDSPFactories = this.libFaust.cwrap("deleteAllWasmCDSPFactories", null, []);
        this.expandCDSPFromString = this.libFaust.cwrap("expandCDSPFromString", "number", ["number", "number", "number", "number", "number", "number"]);
        this.getCLibFaustVersion = this.libFaust.cwrap("getCLibFaustVersion", "number", []);
        this.getWasmCModule = this.libFaust.cwrap("getWasmCModule", "number", ["number"]);
        this.getWasmCModuleSize = this.libFaust.cwrap("getWasmCModuleSize", "number", ["number"]);
        this.getWasmCHelpers = this.libFaust.cwrap("getWasmCHelpers", "number", ["number"]);
        this.freeWasmCModule = this.libFaust.cwrap("freeWasmCModule", null, ["number"]);
        this.freeCMemory = this.libFaust.cwrap("freeCMemory", null, ["number"]);
        this.cleanupAfterException = this.libFaust.cwrap("cleanupAfterException", null, []);
        this.getErrorAfterException = this.libFaust.cwrap("getErrorAfterException", "number", []);
        this.generateCAuxFilesFromString = this.libFaust.cwrap("generateCAuxFilesFromString", "number", ["number", "number", "number", "number", "number"]);
        this.getLibFaustVersion = () => this.libFaust.UTF8ToString(this.getCLibFaustVersion());
    }
    /**
     * Generate Uint8Array and helpersCode from a dsp source code
     *
     * @param {string} code - dsp source code
     * @param {string[]} [argv] - Array of paramaters to be given to the Faust compiler
     * @param {boolean} [internalMemory] - Use internal Memory flag, false for poly, true for mono
     */
    compileCode(code, argv = [], internalMemory = true) {
        const codeSize = this.libFaust.lengthBytesUTF8(code) + 1;
        const $code = this.libFaust._malloc(codeSize);
        const name = "FaustDSP";
        const nameSize = this.libFaust.lengthBytesUTF8(name) + 1;
        const $name = this.libFaust._malloc(nameSize);
        const $errorMsg = this.libFaust._malloc(4096);
        const sha1 = (0, crypto_1.createHash)("sha256").update(code + argv.join("") + (internalMemory ? "i" : "e")).digest("hex");
        this.libFaust.stringToUTF8(name, $name, nameSize);
        this.libFaust.stringToUTF8(code, $code, codeSize);
        // Add 'cn' option with the factory name
        argv.push("-cn", sha1);
        // Prepare 'argv_aux' array for C side
        const ptrSize = 4;
        const $argv = this.libFaust._malloc(argv.length * ptrSize); // Get buffer from emscripten.
        let argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length); // Get a integer view on the newly allocated buffer.
        for (let i = 0; i < argv.length; i++) {
            const size$arg = this.libFaust.lengthBytesUTF8(argv[i]) + 1;
            const $arg = this.libFaust._malloc(size$arg);
            this.libFaust.stringToUTF8(argv[i], $arg, size$arg);
            argvBuffer$[i] = $arg;
        }
        try {
            const time1 = Date.now();
            const $moduleCode = this.createWasmCDSPFactoryFromString($name, $code, argv.length, $argv, $errorMsg, internalMemory);
            const time2 = Date.now();
            console.log("Faust compilation duration: " + (time2 - time1));
            const errorMsg = this.libFaust.UTF8ToString($errorMsg);
            if (errorMsg)
                throw new Error(errorMsg);
            if ($moduleCode === 0)
                return null;
            const $wasmCModule = this.getWasmCModule($moduleCode);
            const wasmCModuleSize = this.getWasmCModuleSize($moduleCode);
            // Copy native 'binary' string in JavaScript Uint8Array
            const wasmCModule = new Uint8Array(wasmCModuleSize);
            for (let i = 0; i < wasmCModuleSize; i++) {
                // faster than 'getValue' which gets the type of access for each read...
                wasmCModule[i] = this.libFaust.HEAP8[$wasmCModule + i];
            }
            const $helpers = this.getWasmCHelpers($moduleCode);
            const helpers = this.libFaust.UTF8ToString($helpers);
            // Free strings
            this.libFaust._free($code);
            this.libFaust._free($name);
            this.libFaust._free($errorMsg);
            // Free C allocated wasm module
            this.freeWasmCModule($moduleCode);
            // Get an updated integer view on the newly allocated buffer after possible emscripten memory grow
            argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length);
            // Free 'argv' C side array
            for (let i = 0; i < argv.length; i++) {
                this.libFaust._free(argvBuffer$[i]);
            }
            this.libFaust._free($argv);
            return { wasmCModule, code, helpers };
        }
        catch (e) {
            // libfaust is compiled without C++ exception activated, so a JS exception is throwed and catched here
            const errorMsg = this.libFaust.UTF8ToString(this.getErrorAfterException());
            this.cleanupAfterException();
            // Report the Emscripten error
            throw errorMsg ? new Error(errorMsg) : e;
        }
    }
    /**
     * createDSPFactoryAux
     * Generate shaKey, effects, dsp, their Wasm Modules and helpers from a dsp source code
     *
     * @param {string} code - dsp source code
     * @param {string[]} argv - Array of paramaters to be given to the Faust compiler
     * @param {boolean} internalMemory - Use internal Memory flag, false for poly, true for mono
     */
    compile(code, argv = [], internalMemory = true) {
        console.log(`libfaust.js version: ${this.version}`);
        // Create 'effect' expression
        const effectCode = `adapt(1,1) = _; adapt(2,2) = _,_; adapt(1,2) = _ <: _,_; adapt(2,1) = _,_ :> _;
adaptor(F,G) = adapt(outputs(F),inputs(G));
dsp_code = environment{${code}};
process = adaptor(dsp_code.process, dsp_code.effect) : dsp_code.effect;`;
        const mainCompiledCode = this.compileCode(code, argv, internalMemory);
        let effectCompiledCode;
        try {
            effectCompiledCode = this.compileCode(effectCode, argv, internalMemory);
        }
        catch (e) { } // eslint-disable-line no-empty
        const compiledCodes = new FaustDsp_1.default(mainCompiledCode, effectCompiledCode);
        return compiledCodes;
    }
    /**
     * From a DSP source file, creates a "self-contained" DSP source string where all needed librairies have been included.
     * All compilations options are 'normalized' and included as a comment in the expanded string.
     *
     * @param {string} code - dsp source code
     * @param {string[]} [args] - Paramaters to be given to the Faust compiler
     * @returns {string} "self-contained" DSP source string where all needed librairies
     */
    expandCode(code, args = []) {
        console.log(`libfaust.js version: ${this.version}`);
        const codeSize = this.libFaust.lengthBytesUTF8(code) + 1;
        const $code = this.libFaust._malloc(codeSize);
        const name = "FaustDSP";
        const nameSize = this.libFaust.lengthBytesUTF8(name) + 1;
        const $name = this.libFaust._malloc(nameSize);
        const $shaKey = this.libFaust._malloc(64);
        const $errorMsg = this.libFaust._malloc(4096);
        this.libFaust.stringToUTF8(name, $name, nameSize);
        this.libFaust.stringToUTF8(code, $code, codeSize);
        // Force "wasm" compilation
        const argv = [...args, "-lang", "wasm"];
        // Prepare 'argv' array for C side
        const ptrSize = 4;
        const $argv = this.libFaust._malloc(argv.length * ptrSize); // Get buffer from emscripten.
        let argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length); // Get a integer view on the newly allocated buffer.
        for (let i = 0; i < argv.length; i++) {
            const size$arg = this.libFaust.lengthBytesUTF8(argv[i]) + 1;
            const $arg = this.libFaust._malloc(size$arg);
            this.libFaust.stringToUTF8(argv[i], $arg, size$arg);
            argvBuffer$[i] = $arg;
        }
        try {
            const $expandedCode = this.expandCDSPFromString($name, $code, argv.length, $argv, $shaKey, $errorMsg);
            const expandedCode = this.libFaust.UTF8ToString($expandedCode);
            const errorMsg = this.libFaust.UTF8ToString($errorMsg);
            if (errorMsg)
                console.error(errorMsg);
            // Free strings
            this.libFaust._free($code);
            this.libFaust._free($name);
            this.libFaust._free($shaKey);
            this.libFaust._free($errorMsg);
            // Free C allocated expanded string
            this.freeCMemory($expandedCode);
            // Get an updated integer view on the newly allocated buffer after possible emscripten memory grow
            argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length);
            // Free 'argv' C side array
            for (let i = 0; i < argv.length; i++) {
                this.libFaust._free(argvBuffer$[i]);
            }
            this.libFaust._free($argv);
            return expandedCode;
        }
        catch (e) {
            // libfaust is compiled without C++ exception activated, so a JS exception is throwed and catched here
            const errorMsg = this.libFaust.UTF8ToString(this.getErrorAfterException());
            this.cleanupAfterException();
            // Report the Emscripten error
            throw errorMsg ? new Error(errorMsg) : e;
        }
    }
    /**
     * Get an SVG Diagram XML File as string
     *
     * @param {string} code faust source code
     * @param {string[]} args - Paramaters to be given to the Faust compiler
     * @returns {string} svg file as string
     */
    getDiagram(code, args = []) {
        try {
            const files = this.libFaust.FS.readdir('/FaustDSP-svg/');
            files.filter(file => file !== "." && file !== "..").forEach(file => this.libFaust.FS.unlink(`/FaustDSP-svg/${file}`));
        }
        catch (error) { }
        const codeSize = this.libFaust.lengthBytesUTF8(code) + 1;
        const $code = this.libFaust._malloc(codeSize);
        const name = "FaustDSP";
        const nameSize = this.libFaust.lengthBytesUTF8(name) + 1;
        const $name = this.libFaust._malloc(nameSize);
        const $errorMsg = this.libFaust._malloc(4096);
        this.libFaust.stringToUTF8(name, $name, nameSize);
        this.libFaust.stringToUTF8(code, $code, codeSize);
        const argv = [...args, "-lang", "wast", "-o", "/dev/null", "-svg"];
        // Prepare 'argv' array for C side
        const ptrSize = 4;
        const $argv = this.libFaust._malloc(argv.length * ptrSize); // Get buffer from emscripten.
        let argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length); // Get a integer view on the newly allocated buffer.
        for (let i = 0; i < argv.length; i++) {
            const size$arg = this.libFaust.lengthBytesUTF8(argv[i]) + 1;
            const $arg = this.libFaust._malloc(size$arg);
            this.libFaust.stringToUTF8(argv[i], $arg, size$arg);
            argvBuffer$[i] = $arg;
        }
        try {
            this.generateCAuxFilesFromString($name, $code, argv.length, $argv, $errorMsg);
            // Free strings
            this.libFaust._free($code);
            this.libFaust._free($name);
            this.libFaust._free($errorMsg);
            // Get an updated integer view on the newly allocated buffer after possible emscripten memory grow
            argvBuffer$ = new Int32Array(this.libFaust.HEAP32.buffer, $argv, argv.length);
            // Free 'argv' C side array
            for (let i = 0; i < argv.length; i++) {
                this.libFaust._free(argvBuffer$[i]);
            }
            this.libFaust._free($argv);
        }
        catch (e) {
            // libfaust is compiled without C++ exception activated, so a JS exception is throwed and catched here
            const errorMsg = this.libFaust.UTF8ToString(this.getErrorAfterException());
            this.cleanupAfterException();
            // Report the Emscripten error
            throw errorMsg ? new Error(errorMsg) : e;
        }
        const svg = {};
        const files = this.libFaust.FS.readdir('/FaustDSP-svg/');
        files.filter(file => file !== "." && file !== "..").forEach(file => svg[file] = this.libFaust.FS.readFile(`/FaustDSP-svg/${file}`, { encoding: "utf8" }));
        return svg;
    }
}
exports.default = Faust;
//# sourceMappingURL=Faust.js.map