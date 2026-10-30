// AutoJs6 / Rhino script. Run this file on the PHONE, not in Node/MATLAB.
// 本地自控工具：不联网、不代背单词、不操作账号或系统应用锁。
// default mode = dry run. Requires on-device page calibration first.
var Core = require('./FocusCore.js');
var store = storages.create('shanbay-wordgate-v1');
var hostPackage = String(context.getPackageName());
var appManager = context.getPackageManager();
var ACTIVE_KEY = 'active_v1';
var TOKEN = String(java.util.UUID.randomUUID());
var PRESETS = [
    {name:'抖音', pattern:/抖音/},
    {name:'小红书', pattern:/小红书/},
    {name:'哔哩哔哩', pattern:/哔哩哔哩|bilibili/i},
    {name:'火影忍者手游', pattern:/火影忍者/}
];
var EXEMPT = [hostPackage,'com.tencent.mm','com.tencent.mobileqq','com.android.settings',
    'com.android.dialer','com.google.android.dialer','com.android.phone',
    'com.android.systemui','com.miui.securitycenter','com.miui.home'];
var config = store.get('config', {version:1,studyPackage:'',studyName:'',blockedPackages:[],
    blockedNames:[],exemptPackages:EXEMPT,startRule:null,doneRule:null,dryRun:true,
    stableMs:1200,minSamples:3,maxSampleGapMs:1500});
config.exemptPackages = EXEMPT;

function nowMs(){return Number(android.os.SystemClock.elapsedRealtime());}
function today(){var d=new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
function show(title,text){dialogs.alert(title,text);}
function saveConfig(){store.put('config',config);}
function invalidatePreview(){store.put('previewCompleted',false);store.put('previewSawLock',false);store.remove('previewState');config.dryRun=true;}
function labelForPhase(s){return {IDLE:'等待开始学习',LOCKED:'学习中：娱乐应用受限',COMPLETED:'今日目标已识别完成'}[s]||'尚未运行';}
function arrayOf(value){var a=[];if(value){for(var i=0;i<value.length;i++)a.push(Number(value[i]));}return a;}
function active(){var a=store.get(ACTIVE_KEY,null);return a && nowMs()>=a.heartbeat && nowMs()-a.heartbeat<8000 ? a:null;}
function ensureNoWorker(){if(active()){show('守护正在运行','请先使用“停止本脚本”再修改配置。停止不会删除未完成的学习状态。');return false;}return true;}
function needAccessibility(){auto.waitFor();}
function launchedApps(){
    var intent=new android.content.Intent(android.content.Intent.ACTION_MAIN);
    intent.addCategory(android.content.Intent.CATEGORY_LAUNCHER);
    var resolved=appManager.queryIntentActivities(intent,0), out=[], seen={};
    for(var i=0;i<resolved.size();i++){
        var item=resolved.get(i), pkg=String(item.activityInfo.packageName);
        if(!seen[pkg]){seen[pkg]=true;out.push({pkg:pkg,name:String(item.loadLabel(appManager))});}
    }
    out.sort(function(a,b){return a.name.localeCompare(b.name);});return out;
}
function selectOne(title,apps){
    if(!apps.length){show('没有找到应用','请确认应用已安装在当前手机主用户中；双开/隐私空间需要单独适配。');return null;}
    var i=dialogs.select(title,apps.map(function(a){return a.name+'\n'+a.pkg;}));
    return i>=0?apps[i]:null;
}
function setupApps(){
    if(!ensureNoWorker())return;
    var apps=launchedApps();
    var study=selectOne('选择扇贝单词（不是阅读或听力）',apps.filter(function(a){return /扇贝/.test(a.name);}));
    if(!study)return;
    var chosen=[], names=[], missing=[];
    for(var i=0;i<PRESETS.length;i++){
        var spec=PRESETS[i];
        var found=apps.filter(function(a){return spec.pattern.test(a.name)&&EXEMPT.indexOf(a.pkg)<0&&a.pkg!==study.pkg;});
        if(!found.length){missing.push(spec.name);continue;}
        var pick=selectOne('选择要拦截的 '+spec.name,found);
        if(!pick)return;
        if(chosen.indexOf(pick.pkg)<0){chosen.push(pick.pkg);names.push(pick.name);}
    }
    if(!chosen.length){show('未配置娱乐应用','没有找到所选的四类娱乐应用，尚未启用拦截。');return;}
    var text='学习软件：'+study.name+'\n拦截：'+names.join('、')+'\n微信、QQ、电话和设置保持可用。';
    if(missing.length)text+='\n未找到（不会拦截）：'+missing.join('、');
    if(!dialogs.confirm('确认应用名单',text))return;
    if(config.studyPackage!==study.pkg){config.startRule=null;config.doneRule=null;}
    config.studyPackage=study.pkg;config.studyName=study.name;
    config.blockedPackages=chosen;config.blockedNames=names;invalidatePreview();saveConfig();
    show('名单已保存','下一步采集真实“学习中”和“今日目标全部完成”页面。先保持试运行模式。');
}

// Read the live Android accessibility root; do not trust currentPackage's cached value.
// No content from other apps is traversed or saved.
function takeSnapshot(){
    var power=context.getSystemService(android.content.Context.POWER_SERVICE);
    var s={packageName:'',activity:'',screenOn:!!power.isInteractive(),nodes:[],truncated:false};
    if(!s.screenOn||!auto.service)return s;
    var root=null, queue=[];
    try{
        root=auto.service.getRootInActiveWindow();
        if(!root)return s;
        s.packageName=String(root.getPackageName()||'');
        if(s.packageName!==config.studyPackage){root.recycle();root=null;return s;}
        // A cached activity name is not used as a default page identity.
        queue.push(root);root=null;
        var visited=0;
        while(queue.length && visited<1200){
            var node=queue.shift();visited++;
            try{
                if(String(node.getPackageName()||'')!==config.studyPackage)continue;
                if(node.isVisibleToUser()&&!node.isPassword()){
                    var text=node.getText(),desc=node.getContentDescription();
                    text=text===null?'':String(text);desc=desc===null?'':String(desc);
                    if(text||desc)s.nodes.push({text:text,desc:desc});
                }
                for(var j=0;j<node.getChildCount();j++){var child=node.getChild(j);if(child)queue.push(child);}
            } finally {node.recycle();}
        }
        if(queue.length)s.truncated=true;
    }catch(error){s.nodes=[];s.error='ACCESSIBILITY_SNAPSHOT_UNAVAILABLE';}
    finally{
        if(root){try{root.recycle();}catch(ignored){}}
        while(queue.length){try{queue.shift().recycle();}catch(ignored2){}}
    }
    return s;
}
function ensureStudy(){if(!config.studyPackage){show('先设置名单','先运行“配置学习软件和四个娱乐应用”。');return false;}return true;}
function collectAfterDelay(message){
    if(!ensureNoWorker()||!ensureStudy())return null;
    needAccessibility();
    show('准备采集',message+'\n\n点击确定后有 15 秒，请切到扇贝并保持目标页面不动。采集只读取当前扇贝页面的可见文字，不截图、不上传。');
    toast('15秒后采集扇贝页面，请立即切换。');sleep(15000);
    var sample=takeSnapshot();
    if(sample.packageName!==config.studyPackage||!sample.nodes.length||sample.truncated){
        app.launchPackage(hostPackage);
        show('页面采集失败','没有获得完整的扇贝可见文字。请保持扇贝全屏、亮屏，并确认无障碍和悬浮窗权限。图片式界面可能无法读取。');return null;
    }
    // Bring the script host back for the selection dialog. The sample is already frozen.
    app.launchPackage(hostPackage);sleep(900);return sample;
}
function captureRule(isDone){
    var sample=collectAfterDelay(isDone?
        '请打开“今日新词和复习任务全部完成”的结果页。不要选完成一组、历史打卡、累计统计或某个单词完成页。':
        '请真正点击“开始学习”，进入有单词和学习操作按钮的学习中页面。不要停留在首页“开始学习”按钮上。');
    if(!sample)return;
    var candidates=[],seen={};
    sample.nodes.forEach(function(n){['text','desc'].forEach(function(kind){var v=n[kind];
        if(v&&v.trim()&&v.length<=100&&!seen[v]){seen[v]=true;candidates.push({kind:kind,value:v});}});});
    if(candidates.length<2){show('可用文字不足','至少需要两个不同且稳定的页面文字。可先用“导出扇贝页面信息”诊断。');return;}
    show('选择识别锚点',isDone?
        '选择 2～6 个文字：必须共同证明“今日全部任务已完成”，至少包含今日/今天的上下文和已完成的语义。不要选单独的“完成”或“打卡”。':
        '选择 2～6 个学习中稳定显示的按钮/标签。不要选当前英文单词、释义、计数或会变化的内容。');
    var indices=arrayOf(dialogs.multiChoice('选择 '+(isDone?'今日完成':'学习中')+' 的稳定文字',candidates.map(function(a){return (a.kind==='desc'?'[说明] ':'')+a.value;}),[]));
    if(indices.length<2||indices.length>6){show('未保存','请选择 2～6 个不同锚点。');return;}
    var rule={activity:'',anchors:indices.map(function(i){return candidates[i];})};
    if(isDone){
        var combined=rule.anchors.map(function(a){return a.value;}).join(' ');
        if(!/今日|今天|当日/.test(combined)||!/完成|达成|学完/.test(combined)){
            show('没有足够的今日完成依据','所选文字缺少今日上下文或完成语义，暂不保存解锁规则。请导出页面信息后进一步适配。');return;
        }
    }
    var other=isDone?config.startSample:config.doneSample;
    if(other&&Core.matchesRule(other,rule)){show('识别规则冲突','所选锚点也出现在另一阶段的页面上，请选择更有区分度的文字。');return;}
    var oldOther=isDone?config.startRule:config.doneRule;
    if(oldOther&&Core.matchesRule(sample,oldOther)){show('识别规则冲突','已有的另一阶段规则也会匹配本页，请先重新采集另一阶段。');return;}
    if(!dialogs.confirm('确认 '+(isDone?'今日全部完成':'正在学习')+' 规则',rule.anchors.map(function(a){return a.value;}).join('\n')+'\n\n这些文字必须在同一个扇贝屏幕中同时出现，连续稳定后才识别。'))return;
    if(isDone){config.doneRule=rule;config.doneSample=sample;}else{config.startRule=rule;config.startSample=sample;}
    // Store only local calibration samples; no network/API keys are used by this script.
    invalidatePreview();saveConfig();show('识别规则已保存','请先试运行，确认中途离开会提示拦截，且只有今日任务全部完成才提示解锁。');
}
function ready(){
    if(!config.studyPackage||!config.blockedPackages.length||!config.startRule||!config.doneRule){show('配置尚未完成','请完成应用名单、学习中页面和今日全部完成页面的采集。识别规则不完整时不会启用拦截，避免无法正常解锁。');return false;}
    try{Core.createEngine(config);}catch(error){show('规则无效','请重新采集两个页面，至少各有2个不同的稳定文字。');return false;}
    return true;
}
function summary(){
    var state=store.get(config.dryRun?'previewState':'state',{}), a=active();
    return '学习软件：'+(config.studyName||'未设置')+'\n娱乐名单：'+(config.blockedNames.join('、')||'未设置')+
        '\n微信/QQ：放行\n学习中规则：'+(config.startRule?'已设置':'未设置')+
        '\n今日完成规则：'+(config.doneRule?'已设置':'未设置')+
        '\n模式：'+(config.dryRun?'试运行（仅提示，不拦截）':'正式拦截')+
        '\n守护进程：'+(a?'运行中':'未运行')+'\n学习状态：'+labelForPhase(state.phase);
}
function setMode(){
    if(!ensureNoWorker())return;
    var mode=dialogs.select('选择运行模式',['试运行：仅提示，便于检查识别是否正确','正式拦截：未完成时把指定娱乐应用退回桌面']);
    if(mode<0)return;
    if(mode===1){
        if(!ready())return;
        if(!store.get('previewCompleted',false)){show('先完成一次试运行','必须先在试运行中走通“开始学习→识别今日全部完成”，再启用正式拦截。');return;}
        if(!dialogs.confirm('启用正式拦截','你已确认试运行没有提前解锁，并且识别到了真实的今日全部完成？\n学习状态不会因退出扇贝、重启脚本或跨午夜而自动解除；无障碍被系统关闭时拦截会停止。'))return;
    }
    config.dryRun=mode===0;saveConfig();
}
function exportSnapshot(){
    var sample=collectAfterDelay('打开要诊断的扇贝页面。信息只保存到本地，可能包含当前单词或学习进度，分享前请自行检查。');
    if(!sample)return;
    var source=String(engines.myEngine().source), directory=files.dirname(source);
    var path=files.join(directory,'shanbay_snapshot.json');
    files.write(path,JSON.stringify(sample,null,2));
    show('页面信息已保存',path+'\n可能含昵称、当前单词和进度等可见信息，分享前请检查。不会自动上传。若需要适配规则，可手动提供该文件。');
}
function runGuard(){
    if(active()){show('已在运行','不要重复启动守护。可用查看状态检查，或停止后重新运行。');return;}
    if(!ready())return;
    needAccessibility();
    var stateKey=config.dryRun?'previewState':'state';
    var engine=Core.createEngine(config,store.get(stateKey,null));
    var lastPersist='',lastToast=-10000,lastLog=-10000;
    store.put('stopRequested',false);
    store.put(ACTIVE_KEY,{token:TOKEN,heartbeat:nowMs()});
    toast('单词守门启动：'+(config.dryRun?'试运行，仅提示':'正式拦截')+'。请进入扇贝开始学习。');
    try{
        while(!store.get('stopRequested',false)){
            var owner=store.get(ACTIVE_KEY,null);
            if(owner&&owner.token!==TOKEN)break;
            var now=nowMs();store.put(ACTIVE_KEY,{token:TOKEN,heartbeat:now});
            var sample=takeSnapshot();
            if(sample.truncated)sample.nodes=[];
            var result=engine.step(sample,now,today());
            var state=engine.exportState(), serialized=JSON.stringify(state);
            if(serialized!==lastPersist){store.put(stateKey,state);lastPersist=serialized;}
            if(result.transition==='TO_LOCKED'){
                if(config.dryRun)store.put('previewSawLock',true);
                toast('已识别开始学习：'+(config.dryRun?'进入试运行锁定状态':'四个娱乐应用暂时受限'));
            }
            if(result.transition==='TO_COMPLETED'){
                if(config.dryRun&&store.get('previewSawLock',false))store.put('previewCompleted',true);
                toast('已识别今日全部任务完成：娱乐应用恢复使用。');
            }
            if(result.block){
                if(!config.dryRun){
                    // Re-check the live root package immediately before taking a global action.
                    var verify=takeSnapshot();
                    if(verify.screenOn&&verify.packageName===sample.packageName&&EXEMPT.indexOf(verify.packageName)<0){
                        var moved=auto.service&&auto.service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME);
                        if(!moved&&now-lastLog>5000){console.warn('系统未接受返回桌面动作，请检查无障碍。');lastLog=now;}
                    }
                }
                if(now-lastToast>4000){toast(config.dryRun?'试运行：这里会拦截娱乐应用。':'请先完成今日扇贝学习任务。');lastToast=now;}
            }
            if(!auto.service&&now-lastLog>15000){console.warn('无障碍服务不可用，当前无法执行拦截。');lastLog=now;}
            sleep(sample.screenOn?300:1200);
        }
    } finally {
        store.put(stateKey,engine.exportState());
        var finalOwner=store.get(ACTIVE_KEY,null);
        if(finalOwner&&finalOwner.token===TOKEN)store.remove(ACTIVE_KEY);
    }
}

var launchArgs=engines.myEngine().execArgv||{};
var menu=launchArgs.autoStartGuard?0:dialogs.select('单词守门 · 扇贝专用',[
    '开始守护（'+(config.dryRun?'试运行':'正式拦截')+'）',
    '配置学习软件和四个娱乐应用',
    '采集学习中页面',
    '采集今日目标全部完成页面',
    '切换试运行/正式拦截',
    '查看配置和状态',
    '导出扇贝页面信息（适配诊断）',
    '停止本脚本（保留未完成状态）'
]);
switch(menu){
    case 0:runGuard();break;
    case 1:setupApps();break;
    case 2:captureRule(false);break;
    case 3:captureRule(true);break;
    case 4:setMode();break;
    case 5:show('当前状态',summary());break;
    case 6:exportSnapshot();break;
    case 7:store.put('stopRequested',true);show('已请求停止','拦截会停止，但未完成的学习状态会保留。下次正式运行会恢复该状态。');break;
}
