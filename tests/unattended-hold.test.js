'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '../plugins/Scanner/scanner_server.js'), 'utf8'
);
const holdFunction = source.slice(
    source.indexOf('function checkStereo('),
    source.indexOf('function PE5PVBlog(')
);

// Exercise the real scanner hold function without a receiver, network, or timers.
function advances({enabled = false, users = 0, pi = '1234', count = 21,
    searching = false, mode = 'normal'} = {}) {
    let steps = 0;
    const context = {
        UnattendedScanSkipRDSDelay: enabled,
        ScanHoldTime: 2, Sensitivity: 20, ScannerMode: mode,
        isSearching: searching, Scan: 'on', users,
        sigArraySpectrum: [], sigArrayDifference: [],
        tuningLowerLimit: '88.1', currentFrequency: '99.50', scanInterval: 1,
        clearInterval() {}, isScanning: true,
        HTMLlogRAW: false, OnlyScanHoldTime: 'on', Scanmode: 1,
        ps: 'TEST', stationid: '', Savefreq: '98.1', CSVcompletePS: true,
        CSVcreate: false, HTMLlogOnlyID: true, FMLIST_Autolog: 'off',
        isPluginHoldActive: () => false,
        startScan() { steps++; },
        emitScannerDxLogEvent() {}, writeHTMLLogEntry() {}, writeCSVLogEntry() {}
    };
    vm.createContext(context);
    vm.runInContext(holdFunction, context);
    context.checkStereo(false, '99.50', 50, pi, 'TEST', count);
    return steps;
}

// At a two-second configured hold the existing counter threshold is 20;
// the RDS extension raises it to 70. These are receiver-update counts.
assert.equal(advances(), 0, 'disabled setting preserves the RDS extension');
assert.equal(advances({count: 71}), 1, 'original extended hold eventually ends');
for (const users of [0, '0']) {
    for (const pi of ['1234', '?']) {
        assert.equal(advances({enabled: true, users, pi, count: 20}), 0);
        assert.equal(advances({enabled: true, users, pi, count: 21}), 1,
            'unattended RDS and non-RDS holds use the same threshold');
    }
}
for (const users of [1, 2, '1', 'unknown']) {
    assert.equal(advances({enabled: true, users}), 0,
        'connected or unknown user counts preserve the RDS extension');
    assert.equal(advances({enabled: true, users, count: 71}), 1);
}
assert.equal(advances({enabled: true, searching: true}), 0,
    'manual search retains the RDS extension');
assert.equal(advances({enabled: true, searching: true, count: 71}), 1);
assert.equal(advances({enabled: true, mode: 'spectrum'}), 1,
    'spectrum mode retains its existing base hold');
assert.equal(advances({enabled: false, mode: 'spectrum'}), 1);
assert.equal(advances({enabled: true, users: 1, pi: '?'}), 1,
    'non-RDS hold remains unchanged with users connected');

// Use the real defaults and merger so scanner.json keeps the new property.
const configContext = {};
vm.createContext(configContext);
vm.runInContext(source.slice(source.indexOf('const defaultConfig = {'),
    source.indexOf('// Function to load the old config')) + '\n' +
    'this.defaults = defaultConfig;', configContext);
assert.equal(configContext.defaults.UnattendedScanSkipRDSDelay, false);
assert.equal(configContext.mergeConfig(configContext.defaults, {})
    .UnattendedScanSkipRDSDelay, false);
assert.equal(configContext.mergeConfig(configContext.defaults,
    {UnattendedScanSkipRDSDelay: true}).UnattendedScanSkipRDSDelay, true);

// Exercise the existing configuration-loading prefix, including strict boolean parsing.
const applyPrefix = source.slice(source.indexOf('function applyScannerConfig('),
    source.indexOf('    defaultSensitivityValue = configData.defaultSensitivityValue;'));
vm.runInContext('let UnattendedScanSkipRDSDelay = false;\n' + applyPrefix + '}\n' +
    'this.getSetting = () => UnattendedScanSkipRDSDelay;', configContext);
for (const value of [false, 'true', 'false', undefined]) {
    configContext.applyScannerConfig({UnattendedScanSkipRDSDelay: value});
    assert.equal(configContext.getSetting(), false);
}
configContext.applyScannerConfig({UnattendedScanSkipRDSDelay: true});
assert.equal(configContext.getSetting(), true);

console.log('Passed: configurable unattended hold, connected users, search/spectrum behavior, configuration defaults/merge/loading.');
