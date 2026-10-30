'use strict';

// 纯 ES5 核心状态机，无运行时依赖。AutoJs6 外层脚本通过 module.exports 使用。
// 只依赖传入的 snapshot / nowMs / dayKey，不读设备、不存任何内部持久化。

var PHASE_IDLE = 0;
var PHASE_LOCKED = 1;
var PHASE_COMPLETED = 2;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function normalizeAnchors(rule) {
  var anchors = (rule && rule.anchors) ? rule.anchors : null;
  if (!anchors || typeof anchors.length !== 'number') return null;
  var out = [];
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    if (!a || typeof a !== 'object') return null;
    var kind = a.kind;
    if (kind !== 'text' && kind !== 'desc') return null;
    if (!isNonEmptyString(a.value) || !a.value.trim()) return null;
    out.push({ kind: kind, value: a.value });
  }
  if (out.length < 2) return null;
  // 两个锚点必须是不同文字，不能用同一文字的 text/desc 充数。
  for (var m = 0; m < out.length; m++) {
    for (var n = m + 1; n < out.length; n++) {
      if (out[m].value === out[n].value) return null;
    }
  }
  return out;
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') return null;
  if (!isNonEmptyString(config.studyPackage)) return null;
  var startAnchors = normalizeAnchors(config.startRule);
  var doneAnchors = normalizeAnchors(config.doneRule);
  if (!startAnchors || !doneAnchors) return null;

  var blockedPackages = [];
  if (config.blockedPackages && typeof config.blockedPackages.length === 'number') {
    for (var i = 0; i < config.blockedPackages.length; i++) {
      if (isNonEmptyString(config.blockedPackages[i])) blockedPackages.push(config.blockedPackages[i]);
    }
  }
  var exemptPackages = [];
  if (config.exemptPackages && typeof config.exemptPackages.length === 'number') {
    for (var j = 0; j < config.exemptPackages.length; j++) {
      if (isNonEmptyString(config.exemptPackages[j])) exemptPackages.push(config.exemptPackages[j]);
    }
  }

  var stableMs = (typeof config.stableMs === 'number' && config.stableMs >= 0) ? config.stableMs : 1200;
  var minSamples = (typeof config.minSamples === 'number' && config.minSamples >= 1) ? Math.floor(config.minSamples) : 3;
  var maxSampleGapMs = (typeof config.maxSampleGapMs === 'number' && config.maxSampleGapMs > 0) ? config.maxSampleGapMs : 1000;

  return {
    studyPackage: config.studyPackage,
    startActivity: typeof config.startRule.activity === 'string' ? config.startRule.activity : '',
    doneActivity: typeof config.doneRule.activity === 'string' ? config.doneRule.activity : '',
    startAnchors: startAnchors,
    doneAnchors: doneAnchors,
    blockedPackages: blockedPackages,
    exemptPackages: exemptPackages,
    stableMs: stableMs,
    minSamples: minSamples,
    maxSampleGapMs: maxSampleGapMs
  };
}

function nodesContainAnchors(nodes, anchors) {
  if (!nodes || typeof nodes.length !== 'number') return false;
  for (var i = 0; i < anchors.length; i++) {
    var kind = anchors[i].kind;
    var value = anchors[i].value;
    var found = false;
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      if (!node || typeof node !== 'object') continue;
      var field = (kind === 'text') ? node.text : node.desc;
      if (typeof field === 'string' && field === value) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function matchesRule(snapshot, rule) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (!rule || typeof rule !== 'object') return false;
  if (rule.activity && snapshot.activity !== rule.activity) return false;
  var anchors = normalizeAnchors(rule);
  if (!anchors || anchors.length === 0) return false;
  if (!snapshot.nodes || typeof snapshot.nodes.length !== 'number') return false;
  return nodesContainAnchors(snapshot.nodes, anchors);
}

function inList(list, value) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

function phaseToName(phase) {
  if (phase === PHASE_LOCKED) return 'LOCKED';
  if (phase === PHASE_COMPLETED) return 'COMPLETED';
  return 'IDLE';
}

function nameToPhase(name) {
  if (name === 'LOCKED') return PHASE_LOCKED;
  if (name === 'COMPLETED') return PHASE_COMPLETED;
  return PHASE_IDLE;
}

function createEngine(config, persisted) {
  var cfg = validateConfig(config);
  if (!cfg) {
    throw new Error('invalid config');
  }

  var phase = PHASE_IDLE;
  var completedDate = null;
  var persistDayKey = null;

  if (persisted && typeof persisted === 'object') {
    if (typeof persisted.phase === 'string') {
      phase = nameToPhase(persisted.phase);
    }
    if (isNonEmptyString(persisted.completedDate)) {
      completedDate = persisted.completedDate;
    } else {
      completedDate = null;
    }
    if (isNonEmptyString(persisted.dayKey)) {
      persistDayKey = persisted.dayKey;
    }
  }

  // 候选状态只存在于内存，不持久化，重启后从零开始积累。
  var startCandidate = null; // {sinceMs, samples, lastMs}
  var doneCandidate = null;
  var lastDayKey = persistDayKey;

  function resetCandidates() {
    startCandidate = null;
    doneCandidate = null;
  }

  function tickCandidate(candidate, nowMs) {
    // 返回更新后的候选；若样本间隔过大则返回全新候选。
    if (candidate === null) {
      return { sinceMs: nowMs, samples: 1, lastMs: nowMs };
    }
    if (nowMs < candidate.lastMs || nowMs - candidate.lastMs > cfg.maxSampleGapMs) {
      return { sinceMs: nowMs, samples: 1, lastMs: nowMs };
    }
    return {
      sinceMs: candidate.sinceMs,
      samples: candidate.samples + 1,
      lastMs: nowMs
    };
  }

  function candidateSatisfied(candidate, nowMs) {
    if (!candidate) return false;
    if (candidate.samples < cfg.minSamples) return false;
    if (nowMs - candidate.sinceMs < cfg.stableMs) return false;
    return true;
  }

  function handleDayChange(dayKey) {
    if (lastDayKey === dayKey) return;
    lastDayKey = dayKey;
    // 日期变更：清除候选与采样；completedDate 仅同日有效。
    resetCandidates();
    if (completedDate !== null && completedDate !== dayKey) {
      completedDate = null;
    }
    // LOCKED 不因跨日自动解锁；COMPLETED 若跨日则回到 IDLE（当日未完成）。
    if (phase === PHASE_COMPLETED) {
      phase = PHASE_IDLE;
    }
  }

  function step(snapshot, nowMs, dayKey) {
    if (typeof dayKey !== 'string' || dayKey.length === 0) {
      // dayKey 缺失时不推进日期状态，仅做安全返回。
      return { phase: phaseToName(phase), block: false, transition: 'NONE' };
    }
    var prevPhase = phase;
    handleDayChange(dayKey);
    var transition = 'NONE';

    var sourceOk = !!(snapshot && typeof snapshot === 'object' &&
      snapshot.packageName === cfg.studyPackage &&
      snapshot.screenOn !== false && typeof nowMs === 'number' && isFinite(nowMs));

    var startMatch = false;
    var doneMatch = false;

    if (sourceOk) {
      // 只允许同一 snapshot 内部全包含，不经任何跨屏累积。
      startMatch = matchesRule(snapshot, { activity: cfg.startActivity, anchors: cfg.startAnchors });
      doneMatch = matchesRule(snapshot, { activity: cfg.doneActivity, anchors: cfg.doneAnchors });
    }

    if (startMatch && doneMatch) {
      // 同时匹配：不做状态变更并清空候选。
      resetCandidates();
    } else if (doneMatch) {
      // 完成候选优先，可用于从 IDLE 或 LOCKED 达到 COMPLETED。
      startCandidate = null;
      doneCandidate = tickCandidate(doneCandidate, nowMs);
      if (phase !== PHASE_COMPLETED && candidateSatisfied(doneCandidate, nowMs)) {
        phase = PHASE_COMPLETED;
        completedDate = dayKey;
        resetCandidates();
        transition = 'TO_COMPLETED';
      }
    } else if (startMatch) {
      doneCandidate = null;
      startCandidate = tickCandidate(startCandidate, nowMs);
      if (phase === PHASE_IDLE && completedDate !== dayKey && candidateSatisfied(startCandidate, nowMs)) {
        phase = PHASE_LOCKED;
        resetCandidates();
        transition = 'TO_LOCKED';
      }
    } else {
      // 任何不匹配（含非目标包、离屏、空快照、screenOff）都重置候选。
      resetCandidates();
    }

    // 若日期变更导致 phase 由 COMPLETED 回到 IDLE，记录为日期滚动。
    if (transition === 'NONE' && prevPhase !== phase) {
      transition = 'DAY_ROLLOVER';
    }

    var pkg = (snapshot && typeof snapshot === 'object') ? snapshot.packageName : null;
    var block = false;
    if (phase === PHASE_LOCKED) {
      if (snapshot && snapshot.screenOn !== false && isNonEmptyString(pkg)) {
        if (pkg !== cfg.studyPackage &&
            inList(cfg.blockedPackages, pkg) &&
            !inList(cfg.exemptPackages, pkg)) {
          block = true;
        }
      }
    }

    return { phase: phaseToName(phase), block: block, transition: transition };
  }

  function exportState() {
    return {
      phase: phaseToName(phase),
      completedDate: completedDate,
      dayKey: lastDayKey
    };
  }

  return { step: step, exportState: exportState };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createEngine: createEngine, matchesRule: matchesRule };
}
