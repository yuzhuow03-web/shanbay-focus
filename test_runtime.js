'use strict';
// Simulated Android adapter contract tests. These are NOT real-device tests.
var assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
var core=require('./FocusCore');
var code=fs.readFileSync(path.join(__dirname,'WordGate.js'),'utf8');
function config(dry){return {studyPackage:'study',studyName:'扇贝模拟',blockedPackages:['dy','xhs','bili','naruto'],blockedNames:['抖音','小红书','b站','火影'],startRule:{anchors:[{kind:'text',value:'认识'},{kind:'text',value:'不认识'}]},doneRule:{anchors:[{kind:'text',value:'今日任务'},{kind:'text',value:'全部完成'}]},dryRun:dry,stableMs:1200,minSamples:3,maxSampleGapMs:1500};}
function simulate(options){
    var time=0,actions=[],toasts=[],alerts=[],foreignReads=0,selectCalls=0;
    var values={config:options.config||config(false)},menu=options.menu===undefined?0:options.menu;
    if(options.state)values.state=options.state;
    if(options.previewCompleted)values.previewCompleted=true;
    function copy(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
    var storage={get:function(k,d){return values[k]===undefined?copy(d):copy(values[k]);},put:function(k,v){values[k]=copy(v);},remove:function(k){delete values[k];}};
    function current(){if(options.sequence)return options.sequence(time);if(time<2000)return {pkg:'study',texts:['认识','不认识']};if(time<2600)return {pkg:'dy',texts:['今日任务','全部完成']};if(time<3200)return {pkg:'com.tencent.mm',texts:['私聊内容']};if(time<5000)return {pkg:'study',texts:['今日任务','全部完成']};return {pkg:'naruto',texts:[]};}
    function root(){var data=current();if(!data)return null;function node(text,children){return {getPackageName:function(){return data.pkg;},getText:function(){if(data.pkg!=='study')foreignReads++;return text;},getContentDescription:function(){return null;},getChildCount:function(){return children.length;},getChild:function(i){return children[i];},isVisibleToUser:function(){return true;},isPassword:function(){return false;},recycle:function(){}};}
        return node('',data.texts.map(function(t){return node(t,[]);}));}
    var service={getRootInActiveWindow:root,performGlobalAction:function(a){actions.push({time:time,pkg:current().pkg,action:a});return true;}};
    var sandbox={require:function(){return core;},storages:{create:function(){return storage;}},context:{getPackageName:function(){return 'host';},getPackageManager:function(){return {};},getSystemService:function(){return {isInteractive:function(){return true;}};}},
        android:{os:{SystemClock:{elapsedRealtime:function(){return time;}}},content:{Context:{POWER_SERVICE:'power'}},accessibilityservice:{AccessibilityService:{GLOBAL_ACTION_HOME:2}}},
        java:{util:{UUID:{randomUUID:function(){return 'test-token';}}}},
        engines:{myEngine:function(){return {execArgv:{}};}},auto:{waitFor:function(){},service:service},dialogs:{select:function(){return selectCalls++===0?menu:1;},alert:function(a,b){alerts.push(a+':'+b);},confirm:function(){return true;}},
        toast:function(t){toasts.push(t);},sleep:function(ms){time+=ms;if(time>5600)values.stopRequested=true;},console:{warn:function(){}}};
    vm.runInNewContext(code,sandbox,{timeout:2000});return {values:values,actions:actions,toasts:toasts,alerts:alerts,foreignReads:foreignReads};
}
var r=simulate({});assert(r.actions.some(function(a){return a.pkg==='dy';}));assert(!r.actions.some(function(a){return a.pkg==='naruto'||a.pkg==='com.tencent.mm';}));assert.equal(r.values.state.phase,'COMPLETED');assert.equal(r.foreignReads,0);console.log('PASS live-mode adapter blocks before completion and never reads foreign app content');
r=simulate({config:config(true)});assert.equal(r.actions.length,0);assert(r.values.previewCompleted);assert.equal(r.values.previewState.phase,'COMPLETED');console.log('PASS dry run never performs HOME but records a full start/completion cycle');
r=simulate({config:config(true),sequence:function(){return {pkg:'study',texts:['今日任务','全部完成']};}});assert(!r.values.previewCompleted);console.log('PASS seeing done without a start does not pass the dry-run onboarding gate');
var invalid=config(false);invalid.doneRule=null;r=simulate({config:invalid});assert.equal(r.actions.length,0);assert(r.alerts.some(function(t){return t.indexOf('配置尚未完成')>=0;}));console.log('PASS uncalibrated configuration refuses enforcement');
r=simulate({config:config(true),menu:4,previewCompleted:false});assert(r.alerts.some(function(t){return t.indexOf('先完成一次试运行')>=0;}));console.log('PASS formal mode cannot be enabled before a verified dry-run cycle');
console.log('ALL 5 SIMULATED-ANDROID ADAPTER TESTS PASSED');
