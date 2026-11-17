const {spawnSync}=require('node:child_process');
const path=require('node:path');
const tests=['tests/cycle3-table-contract.cjs','tests/table-layout-regression.cjs','tests/summary-table-layout.cjs','tests/pdf-regression.cjs','tests/run.js','tests/startup-retry.mjs','tests/conflict-notice.cjs','tests/ux-enhancements.cjs','tests/partner-statement-period.cjs','tests/table-summary-totals.cjs'];
let failures=0;
for(const test of tests){
 console.log('\n===== '+test+' =====');
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'..',test)],{cwd:path.resolve(__dirname,'..'),stdio:'inherit'});
 if(result.error){failures++;console.error('FAILED to start '+test+': '+result.error.message);continue;}
 if(result.status!==0){failures++;console.error('FAILED '+test+' (exit '+String(result.status)+')');}else console.log('PASSED '+test);
}
console.log('\nTest suites: '+(tests.length-failures)+' passed, '+failures+' failed, '+tests.length+' total');
if(failures)process.exitCode=1;\n