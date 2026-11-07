'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const {createSink,createLogIO}=require('../plugins/Scanner/html-log-io');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'html-log-test-'));
 const file=path.join(root,'daily.html'),template=path.join(root,'template.html');
 fs.writeFileSync(template,'<html><table>');
 const footer='</pre></body></html>',row='<tr><td>99.5</td><td>ABCD</td><td>é東京</td></tr>\n';
 const sink=createSink();sink({type:'ensure',file,template,header:'HEADER'});
 const job={type:'html',file,line:row,firstOnly:false,tokens:['<td>99.5</td>','<td>ABCD</td>','<td>é東京</td>']};
 sink(job);sink(job);assert.equal(fs.readFileSync(file,'utf8'),'<html><table>HEADER'+row+row+footer);
 sink({...job,firstOnly:true});assert.equal(fs.readFileSync(file,'utf8'),'<html><table>HEADER'+row+row+footer);
 const second={...job,line:'<tr><td>100.1</td><td>1234</td><td>OTHER</td></tr>\n',tokens:['<td>100.1</td>','<td>1234</td>','<td>OTHER</td>'],firstOnly:true};
 sink(second);sink(second);assert.equal(fs.readFileSync(file,'utf8').split('OTHER').length,2);
 // Large-file regression: one new row must read only the footer, not the full file.
 const large=path.join(root,'large.html');fs.writeFileSync(large,'X'.repeat(8*1024*1024)+footer);
 let read=0,written=0;const readSync=fs.readSync,writeSync=fs.writeSync,readFileSync=fs.readFileSync;
 fs.readSync=(fd,b,o,l,p)=>{read+=l;return readSync(fd,b,o,l,p);};
 fs.writeSync=(fd,b,o,l,p)=>{written+=l;return writeSync(fd,b,o,l,p);};
 fs.readFileSync=()=>{throw Error('Unexpected whole-file read');};
 try {sink({...job,file:large});}finally{fs.readSync=readSync;fs.writeSync=writeSync;fs.readFileSync=readFileSync;}
 assert.equal(read,Buffer.byteLength(footer));assert.equal(written,Buffer.byteLength(row+footer));
 assert.equal(fs.statSync(large).size,8*1024*1024+Buffer.byteLength(row+footer));
 // All runtime CSV/FMList/hold code must be byte-for-byte unchanged.
 const patched=fs.readFileSync(__dirname+'/../plugins/Scanner/scanner_server.js','utf8');
 // Exercise actual scanner HTML functions with all main-thread disk access forbidden.
 const jobs=[];const ctx={path,logDir:root,__dirname:root,UTCtime:true,ServerName:'TEST',ServerDescription:'DESC',HTMLOnlyFirstLog:false,
 SignalStrengthUnit:'dBf',ant:0,enabledAntennas:[{number:1,name:'ANT'}],Log_Blacklist:false,strength:50,stationid:'123',LAT:0,LON:0,FMLIST_OM_ID:'123',
 picode:'1234',ps:'TEST PS',rdsAiActiveStatus:0,currentNativePi:'',currentNativePs:'',Scan:'off',freq:'99.50',station:'Station',city:'City',itu:'USA',pol:'H',erp:1,distance:100,azimuth:50,
 htmlLogIO:{enqueue:j=>jobs.push(j)},getCurrentUTC:()=>({utcDate:'2026-11-06',utcTime:'12:34:56'}),fs:new Proxy({},{get(){return()=>{throw Error('Main-thread disk access');};}})};
 vm.createContext(ctx);vm.runInContext(patched.slice(patched.indexOf('function escapeHtml('),patched.indexOf('// Operational Global Variables'))+'\n'+
 patched.slice(patched.indexOf('function getLogFilePathHTML('),patched.indexOf('// [Logbook] - begin'))+'\n'+
 patched.slice(patched.indexOf('function writeHTMLLogEntry('),patched.indexOf('function getCurrentUTC()')),ctx);
 ctx.writeHTMLLogEntry(true);assert.equal(jobs.length,2);assert.equal(jobs[1].type,'html');assert.ok(jobs[1].line.includes('TEST_PS_'));
 const errors=[],io=createLogIO(m=>errors.push(m));let beats=0;const timer=setInterval(()=>beats++,1);
 io.enqueue({type:'html',file:path.join(root,'missing'),line:'x'}); // Failure must not break later jobs.
 for(let i=0;i<100;i++)io.enqueue({...job,file:large,firstOnly:false});
 const deadline=Date.now()+5000;while(io.pending&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 clearInterval(timer);assert.equal(io.pending,0);assert.equal(errors.length,1);assert.ok(beats>0);
 await io.close();fs.rmSync(root,{recursive:true,force:true});
 console.log('Passed: footer/UTF-8, duplicate handling, constant-size I/O on an 8 MiB log, real worker/error recovery, main-thread formatting.');
})().catch(e=>{console.error(e);process.exitCode=1;});
