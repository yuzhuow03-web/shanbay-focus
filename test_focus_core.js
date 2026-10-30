'use strict';
var assert = require('assert');
var core = require('./FocusCore');
var passed = 0;
function rule(a,b,activity) { return {activity:activity || '',anchors:[{kind:'text',value:a},{kind:'text',value:b}]}; }
function cfg() { return {studyPackage:'study',startRule:rule('学习控件A','学习控件B'),doneRule:rule('今日完成A','今日完成B'),blockedPackages:['dy','xhs','bili','naruto','wechat'],exemptPackages:['wechat','qq','settings'],stableMs:1200,minSamples:3,maxSampleGapMs:1000}; }
function snap(pkg,kind,extra) { var s={packageName:pkg,activity:'learn',screenOn:true,nodes:[]}; var values=kind==='start'?['学习控件A','学习控件B']:kind==='done'?['今日完成A','今日完成B']:[]; s.nodes=values.map(function(v){return {text:v,desc:''};}); if(extra)Object.keys(extra).forEach(function(k){s[k]=extra[k];});return s; }
function stable(e,kind,start,day) { [0,600,1200].forEach(function(t){e.step(snap('study',kind),start+t,day||'D1');}); }
function test(name,f){f();passed++;console.log('PASS '+name);}
test('all anchors must appear in same snapshot',function(){assert(!core.matchesRule({nodes:[{text:'学习控件A'}]},cfg().startRule));});
test('empty, single, duplicate, whitespace rules rejected',function(){[{}, {anchors:[]},rule('','x'),rule(' ','x'),rule('x','x'),{anchors:[{kind:'text',value:'x'},{kind:'desc',value:'x'}]}].forEach(function(r){assert(!core.matchesRule(snap('study','start'),r));});});
test('activity constraint enforced',function(){var r=cfg().startRule;r.activity='wrong';assert(!core.matchesRule(snap('study','start'),r));});
test('engine does not lose activity constraints',function(){var c=cfg();c.startRule.activity='wrong';var e=core.createEngine(c);stable(e,'start',0);assert.equal(e.exportState().phase,'IDLE');});
test('wrong source package cannot trigger completion',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});[0,600,1200].forEach(function(t){e.step(snap('dy','done'),t,'D1');});assert.equal(e.exportState().phase,'LOCKED');});
test('stable learning screen starts lock',function(){var e=core.createEngine(cfg());stable(e,'start',0);assert.equal(e.exportState().phase,'LOCKED');});
test('four apps blocked, WeChat QQ settings and study exempt',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});['dy','xhs','bili','naruto'].forEach(function(p){assert(e.step(snap(p),0,'D1').block);});['wechat','qq','settings','study','dialer','unknown'].forEach(function(p){assert(!e.step(snap(p),0,'D1').block);});});
test('interrupted completion does not unlock',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});e.step(snap('study','done'),0,'D1');e.step(snap('study','done'),600,'D1');e.step(snap('qq'),700,'D1');e.step(snap('study','done'),1200,'D1');assert.equal(e.exportState().phase,'LOCKED');});
test('three stable done samples unlock',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});stable(e,'done',0);assert.equal(e.exportState().phase,'COMPLETED');assert(!e.step(snap('dy'),1500,'D1').block);});
test('same day completion never relocks',function(){var e=core.createEngine(cfg());stable(e,'done',0);stable(e,'start',2000);assert.equal(e.exportState().phase,'COMPLETED');});
test('new day requires new completion',function(){var e=core.createEngine(cfg());stable(e,'done',0);stable(e,'start',2000,'D2');assert.equal(e.exportState().phase,'LOCKED');assert.equal(e.exportState().completedDate,null);});
test('unfinished lock survives midnight',function(){var e=core.createEngine(cfg());stable(e,'start',0);assert(e.step(snap('dy'),3000,'D2').block);});
test('restart preserves unfinished lock',function(){var e=core.createEngine(cfg());stable(e,'start',0);var r=core.createEngine(cfg(),e.exportState());assert(r.step(snap('dy'),0,'D1').block);});
test('restart never persists completion candidate',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});e.step(snap('study','done'),0,'D1');e.step(snap('study','done'),600,'D1');var r=core.createEngine(cfg(),e.exportState());r.step(snap('study','done'),1200,'D1');assert.equal(r.exportState().phase,'LOCKED');});
test('screen off never recognizes or intercepts',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});[0,600,1200].forEach(function(t){e.step(snap('study','done',{screenOn:false}),t,'D1');});assert.equal(e.exportState().phase,'LOCKED');assert(!e.step(snap('dy',null,{screenOn:false}),1300,'D1').block);});
test('large sample gap resets candidate',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});[0,600,5000].forEach(function(t){e.step(snap('study','done'),t,'D1');});assert.equal(e.exportState().phase,'LOCKED');});
test('both rules matching never unlock',function(){var c=cfg();c.doneRule=c.startRule;var e=core.createEngine(c,{phase:'LOCKED',dayKey:'D1'});stable(e,'start',0);assert.equal(e.exportState().phase,'LOCKED');});
test('separate partial screens never combine anchors',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});[0,600,1200,1800].forEach(function(t,i){e.step(snap('study',null,{nodes:[{text:i%2?'今日完成A':'今日完成B'}]}),t,'D1');});assert.equal(e.exportState().phase,'LOCKED');});
test('backwards monotonic clock resets candidate',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});[1000,1600,500,1700].forEach(function(t){e.step(snap('study','done'),t,'D1');});assert.equal(e.exportState().phase,'LOCKED');});
test('NaN timestamps never unlock',function(){var e=core.createEngine(cfg(),{phase:'LOCKED',dayKey:'D1'});[0,600,NaN].forEach(function(t){e.step(snap('study','done'),t,'D1');});assert.equal(e.exportState().phase,'LOCKED');});
test('invalid configuration refuses to start',function(){assert.throws(function(){core.createEngine({studyPackage:'study',startRule:{},doneRule:{}});},/invalid config/);});
console.log('ALL '+passed+' STATE-MACHINE TESTS PASSED');
