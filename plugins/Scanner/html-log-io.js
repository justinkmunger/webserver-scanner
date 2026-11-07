'use strict';
// Only HTML log creation and updates run outside the receiver/audio event loop.
const {Worker, isMainThread, parentPort} = require('worker_threads');
const fs = require('fs');
const path = require('path');

function createLogIO(logError) {
    const worker = new Worker(__filename);
    let pending = 0, failed = false, warned = false;
    worker.on('message', m => {
        pending = Math.max(0, pending - 1);
        if (m.error) logError('Scanner HTML logger: ' + m.error);
        if (pending < 100) warned = false;
    });
    worker.on('error', () => {
        failed = true;
        logError('Scanner HTML worker failed; restart required to resume HTML logging.');
    });
    worker.on('exit', code => {
        failed = true;
        if (code) logError('Scanner HTML worker exited; HTML logging stopped.');
    });
    worker.unref();
    function enqueue(job) {
        if (failed || pending >= 1000) {
            if (!warned) { warned = true; logError('Scanner HTML queue full/unavailable; HTML operation dropped.'); }
            return false;
        }
        pending++;
        worker.postMessage(job);
        return true;
    }
    return {enqueue, get pending() { return pending; }, close() { return worker.terminate(); }};
}

function createSink() {
    // Keep a bounded number of per-file indexes. All of this state lives in the worker.
    const states = new Map();
    function state(file) {
        let value = states.get(file);
        if (!value) value = {};
        states.delete(file); states.set(file, value);
        if (states.size > 8) states.delete(states.keys().next().value);
        return value;
    }
    function ensure(job) {
        fs.mkdirSync(path.dirname(job.file), {recursive:true});
        if (!fs.existsSync(job.file)) {
            let header = job.header || '';
            if (job.template) header = fs.readFileSync(job.template, 'utf8') + header;
            fs.writeFileSync(job.file, header, {flag:'wx'});
            states.delete(job.file);
        }
        if (job.marker) fs.writeFileSync(job.marker, path.basename(job.file));
    }
    function html(job) {
        const s = state(job.file);
        if (job.firstOnly) {
            if (!s.tokens) {
                s.tokens = new Set(fs.readFileSync(job.file, 'utf8').match(/<td>[^<]*<\/td>/g) || []);
            }
            if (job.tokens.every(t => s.tokens.has(t))) return;
        }
        const footer = '</pre></body></html>';
        const fd = fs.openSync(job.file, 'r+');
        try {
            const size = fs.fstatSync(fd).size;
            const tail = Buffer.alloc(Buffer.byteLength(footer));
            let offset = size;
            if (size >= tail.length) {
                fs.readSync(fd, tail, 0, tail.length, size - tail.length);
                if (tail.toString() === footer) offset -= tail.length;
            }
            // Append the row in place, replacing only the footer, not the entire daily file.
            const data = Buffer.from(job.line + footer);
            writeAll(fd, data, offset);
            fs.ftruncateSync(fd, offset + data.length);
        } finally { fs.closeSync(fd); }
        if (s.tokens) for (const t of job.line.match(/<td>[^<]*<\/td>/g) || []) s.tokens.add(t);
    }
    return job => {
        if (job.type === 'ensure') ensure(job);
        else if (job.type === 'html') html(job);
        else throw Error('Unknown log operation');
    };
}
function writeAll(fd, data, position) {
    let done = 0;
    while (done < data.length) {
        const n = fs.writeSync(fd, data, done, data.length - done, position === null ? null : position + done);
        if (!n) throw Error('Short log write');
        done += n;
    }
}
if (!isMainThread) {
    const sink = createSink();
    parentPort.on('message', job => {
        try { sink(job); parentPort.postMessage({}); }
        catch (e) { parentPort.postMessage({error:e.message}); }
    });
}
module.exports = {createLogIO, createSink};
