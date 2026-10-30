// Optional entry for AutoJs6 scheduled/startup tasks, after calibration.
var directory=files.dirname(String(engines.myEngine().source));
engines.execScriptFile(files.join(directory,'WordGate.js'),{
    path:directory,
    arguments:{autoStartGuard:true}
});
