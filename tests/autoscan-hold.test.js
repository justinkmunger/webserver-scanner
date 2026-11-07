'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../plugins/Scanner/scanner_server.js'), 'utf8');
const holdFunction = source.slice(source.indexOf('function checkStereo('), source.indexOf('function PE5PVBlog('));
function advances({auto = true, unattended = false, users = 0, pi = '1234', count = 21,
    searching = false, scan = 'on', mode = 'normal'} = {}) {
    let steps = 0;
    const context = {
        AutoScanSkipRDSDelay:auto, UnattendedScanSkipRDSDelay:unattended,
        ScanHoldTime:2, Sensitivity:20, ScannerMode:mode, isSearching:searching, Scan:scan, users,
        sigArraySpectrum:[], sigArrayDifference:[], tuningLowerLimit:'88.1', currentFrequency:'99.50',
        scanInterval:1, clearInterval() {}, isScanning:true, HTMLlogRAW:false, OnlyScanHoldTime:'on',
        Scanmode:1, ps:'TEST', stationid:'', Savefreq:'99.50', CSVcompletePS:true, CSVcreate:false,
        HTMLlogOnlyID:true, FMLIST_Autolog:'off', writeStatusCSVps:false, writeStatusCSV:false,
        writeStatusHTMLLog:false, writeStatusPluginLogEvent:false, writeStatusLogFMLIST:false,
        isPluginHoldActive:()=>false, startScan() { steps++; }, emitScannerDxLogEvent() {},
        writeHTMLLogEntry() {}, writeCSVLogEntry() {}
    };
    vm.createContext(context);
    vm.runInContext(holdFunction, context);
    context.checkStereo(false, '99.50', 50, pi, 'TEST', count);
    return steps;
}
for (const users of [0, 1, 5, '0', '1']) {
    for (const pi of ['1234', '?']) {
        assert.equal(advances({users, pi, count:20}), 0);
        assert.equal(advances({users, pi, count:21}), 1,
            'enabled autoscan uses the same base threshold with or without PI/users');
    }
    assert.equal(advances({users, searching:true, count:21}), 0,
        'manual-search classification retains the original RDS extension');
    assert.equal(advances({users, searching:true, count:71}), 1);
}
assert.equal(advances({auto:false, users:1}), 0);
assert.equal(advances({auto:false, users:1, count:71}), 1);
assert.equal(advances({auto:false, unattended:true, users:0}), 1);
assert.equal(advances({auto:false, unattended:true, users:1}), 0);
assert.equal(advances({auto:true, unattended:true, users:1}), 1);
assert.equal(advances({scan:'off', searching:true, count:1000}), 0,
    'a manual search without autoscan never automatically advances after finding a station');
assert.equal(advances({mode:'spectrum'}), 1);

// A manual search can precede autoscan. Exercise actual mode entry points.
const searchFunction = source.slice(source.indexOf('function startSearch('), source.indexOf('/**', source.indexOf('function startSearch(')));
const autoFunction = source.slice(source.indexOf('async function AutoScan()'), source.indexOf('function stopAutoScan()'));
for (const direction of ['up','down']) {
    const calls = [];
    const context = {AutoScanSkipRDSDelay:true, isScanning:false, isSearching:false,
        scanInterval:1, currentFrequency:99.5, clearInterval() {},
        setTimeout(fn) { calls.push(fn); }, startScan(dir) { calls.push(dir); }};
    vm.createContext(context);
    vm.runInContext(searchFunction + '\n' + autoFunction, context);
    context.startSearch(direction);
    assert.equal(context.isSearching,true);
    calls[0]();
    assert.equal(calls[1],direction);
    context.isScanning=true;
    context.AutoScan();
    assert.equal(context.isSearching,false,'starting autoscan clears stale manual-search state');
}
const config = {};
vm.createContext(config);
vm.runInContext(source.slice(source.indexOf('const defaultConfig = {'), source.indexOf('// Function to load the old config')) + '\nthis.defaults = defaultConfig;',config);
assert.equal(config.defaults.AutoScanSkipRDSDelay,false);
assert.equal(config.mergeConfig(config.defaults,{AutoScanSkipRDSDelay:true}).AutoScanSkipRDSDelay,true);
const prefix=source.slice(source.indexOf('function applyScannerConfig('),source.indexOf('    defaultSensitivityValue = configData.defaultSensitivityValue;'));
vm.runInContext('let AutoScanSkipRDSDelay=false; let UnattendedScanSkipRDSDelay=false;\n'+prefix+'}\nthis.getSetting=()=>AutoScanSkipRDSDelay;',config);
for (const value of [undefined,false,'true','false']) {
    config.applyScannerConfig({AutoScanSkipRDSDelay:value});
    assert.equal(config.getSetting(),false);
}
config.applyScannerConfig({AutoScanSkipRDSDelay:true});
assert.equal(config.getSetting(),true);
console.log('Passed: autoscan hold for all user counts, previous option compatibility, up/down searches, search-to-autoscan transitions, config defaults/loading.');
